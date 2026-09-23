use serde_json::Value;
use std::io::{BufRead, BufReader, ErrorKind};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use rusqlite::{params, Connection, Result};
use rusqlite_migration::{Migrations, M};
use serde::Serialize;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
// use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
pub struct TelemetryRow {
    pub id: i64,
    pub timestamp: String,
    pub latitude: f64,
    pub longitude: f64,
    pub ph: f64,
    pub moisture: f64,
    pub ec: f64,
    pub nitrogen: Option<f64>,
    pub phosphorus: Option<f64>,
    pub potassium: Option<f64>,
}
#[derive(Deserialize)]
struct TelemetryImportRecord {
    id: Option<i64>,
    timestamp: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    ph: Option<f64>,
    moisture: Option<f64>,
    ec: Option<f64>,
    nitrogen: Option<f64>,
    phosphorus: Option<f64>,
    potassium: Option<f64>,
}

#[tauri::command]
fn import_telemetry_json(file_content: String) -> Result<usize, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let parsed: serde_json::Value = serde_json::from_str(&file_content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let telemetry_array = parsed
        .get("telemetry")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing 'telemetry' array in JSON".to_string())?;

    let mut count = 0;

    for item in telemetry_array {
        let rec: TelemetryImportRecord = match serde_json::from_value(item.clone()) {
            Ok(r) => r,
            Err(_) => continue,
        };

       conn.execute(
    "INSERT INTO telemetry (
        timestamp, latitude, longitude, ph, moisture, ec,
        nitrogen, phosphorus, potassium
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    params![
        rec.timestamp,
        rec.latitude.unwrap_or(0.0),
        rec.longitude.unwrap_or(0.0),
        rec.ph,
        rec.moisture,
        rec.ec,
        rec.nitrogen,
        rec.phosphorus,
        rec.potassium,
    ],
).map_err(|e| format!("Failed to insert record: {}", e))?;

        count += 1;
    }

    Ok(count)
}


#[tauri::command]
fn export_telemetry_to_project() -> Result<String, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium FROM telemetry")
        .map_err(|e| e.to_string())?;

    let records_iter = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, Option<i64>>(0)?,
                "timestamp": row.get::<_, Option<String>>(1)?,
                "latitude": row.get::<_, Option<f64>>(2)?,
                "longitude": row.get::<_, Option<f64>>(3)?,
                "ph": row.get::<_, Option<f64>>(4)?,
                "moisture": row.get::<_, Option<f64>>(5)?,
                "ec": row.get::<_, Option<f64>>(6)?,
                "nitrogen": row.get::<_, Option<f64>>(7)?,
                "phosphorus": row.get::<_, Option<f64>>(8)?,
                "potassium": row.get::<_, Option<f64>>(9)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    for rec in records_iter {
        if let Ok(r) = rec {
            records.push(r);
        }
    }

    let timestamp_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let payload = serde_json::json!({
        "app_version": "1.0",
        "exported_at": timestamp_secs,
        "record_count": records.len(),
        "telemetry": records
    });

    let target_dir = PathBuf::from("../data/exports");
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| format!("Failed to create exports directory: {}", e))?;
    }

    let file_path = target_dir.join(format!("telemetry_export_{}.json", timestamp_secs));

    let json_string = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(&file_path, json_string).map_err(|e| format!("Failed to write export file: {}", e))?;

    Ok(file_path.to_string_lossy().into_owned())
}

fn get_connection() -> Result<Connection> {
    let mut conn = Connection::open("eksplorador.db")?;

    let migrations = Migrations::new(vec![
        M::up(include_str!("../migrations/V1__create_telemetry_table.sql")),
        M::up(include_str!("../migrations/V2__add_npk_columns.sql")),
        // M::up(include_str!("../migrations/V3_seed_telemetry.sql")),
    ]);

    migrations.to_latest(&mut conn).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;

    Ok(conn)
}

// One validated live reading, held in the buffer until it's time to
// average and insert. Only readings with a valid soil probe response and
// a real GPS fix are buffered — this is the "computed, not raw" filter
// discussed with the team, so the DB doesn't fill up with every single
// transmission (including invalid/no-fix ones).
#[derive(Clone)]
struct BufferedReading {
    latitude: f64,
    longitude: f64,
    ph: f64,
    moisture: f64,
    ec: f64,
    nitrogen: f64,
    phosphorus: f64,
    potassium: f64,
}

// How long to accumulate readings before averaging and writing one row,
// and a count-based cap so a burst of readings doesn't wait the full
// duration before committing.
const INSERT_WINDOW: Duration = Duration::from_secs(30);
const INSERT_MAX_BUFFER: usize = 5;

// Formats the current wall-clock time as HH:MM:SS, matching the existing
// timestamp column format, without pulling in a full date/time crate.
// Philippines is UTC+8 with no daylight saving — fixed offset is safe here.
const PH_UTC_OFFSET_SECS: u64 = 8 * 3600;

fn current_time_hms() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let local_secs = now + PH_UTC_OFFSET_SECS;
    let secs_of_day = local_secs % 86400;
    format!(
        "{:02}:{:02}:{:02}",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

// Averages every reading in the buffer and inserts one row into the
// telemetry table. Uses the most recent reading's GPS position rather
// than averaging coordinates, since averaging lat/lng across a curved
// path the rover drove during the window would produce a meaningless
// midpoint rather than a real location.
fn flush_buffer_to_db(buffer: &[BufferedReading]) {
    if buffer.is_empty() {
        return;
    }

    let n = buffer.len() as f64;
    let avg_ph = buffer.iter().map(|r| r.ph).sum::<f64>() / n;
    let avg_moisture = buffer.iter().map(|r| r.moisture).sum::<f64>() / n;
    let avg_ec = buffer.iter().map(|r| r.ec).sum::<f64>() / n;
    let avg_n = buffer.iter().map(|r| r.nitrogen).sum::<f64>() / n;
    let avg_p = buffer.iter().map(|r| r.phosphorus).sum::<f64>() / n;
    let avg_k = buffer.iter().map(|r| r.potassium).sum::<f64>() / n;

    let latest = buffer.last().unwrap();

    let conn = match get_connection() {
        Ok(c) => c,
        Err(e) => {
            println!("[db] failed to open connection for insert: {}", e);
            return;
        }
    };

    let result = conn.execute(
        "INSERT INTO telemetry (timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            current_time_hms(),
            latest.latitude,
            latest.longitude,
            avg_ph,
            avg_moisture,
            avg_ec,
            avg_n,
            avg_p,
            avg_k
        ],
    );

    match result {
        Ok(_) => println!(
            "[db] inserted averaged row from {} reading(s): ph={:.2} moisture={:.1} ec={:.2}",
            buffer.len(),
            avg_ph,
            avg_moisture,
            avg_ec
        ),
        Err(e) => println!("[db] insert failed: {}", e),
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn init_db() -> Result<(), String> {
    // Just ensures the connection opens and migrations run, creating the
    // telemetry table if it doesn't exist yet. No seed/demo rows are
    // inserted — the table starts empty and only fills with real readings
    // once the rover actually reports valid data.
    get_connection().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_recent_telemetry() -> Result<Vec<TelemetryRow>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium FROM telemetry ORDER BY id DESC LIMIT 200")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TelemetryRow {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                latitude: row.get(2)?,
                longitude: row.get(3)?,
                ph: row.get(4)?,
                moisture: row.get(5)?,
                ec: row.get(6)?,
                nitrogen: row.get(7)?,
                phosphorus: row.get(8)?,
                potassium: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| e.to_string())?);
    }

    Ok(records)
}

const BAUD_RATE: u32 = 115200;

// Remembers the last port that worked, so a reconnect can try it directly
// instead of re-scanning every port on the system.
static LAST_KNOWN_PORT: Mutex<Option<String>> = Mutex::new(None);

// Deasserts DTR and RTS so the board's auto-reset circuit (common on ESP32
// dev boards) doesn't hold the chip in reset for as long as the port stays
// open. Arduino's Serial Monitor manages these lines automatically; the
// serialport crate does not, so we do it ourselves here.
fn release_reset_lines(port: &mut Box<dyn serialport::SerialPort>) {
    let _ = port.write_data_terminal_ready(false);
    let _ = port.write_request_to_send(false);
}

// Tries a single port for a few seconds, looking for a line that parses as
// JSON and contains a "seq" key — this is specific enough to the receiver's
// payload shape that it won't false-match some other device on the same bus.
fn probe_port(port_name: &str) -> bool {
    let mut port = match serialport::new(port_name, BAUD_RATE)
        .timeout(Duration::from_millis(500))
        .open()
    {
        Ok(p) => p,
        Err(_) => return false,
    };

    release_reset_lines(&mut port);
    // Give the board a moment to finish booting (if it did reset) before
    // we start reading — ESP32 boot + LoRa/sensor init can take a second or two.
    thread::sleep(Duration::from_millis(1000));

    let mut reader = BufReader::new(port);
    let deadline = Instant::now() + Duration::from_millis(3500);

    while Instant::now() < deadline {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => continue, // no data yet within this read attempt
            Ok(_) => {
                let trimmed = line.trim();
                if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                    if json.get("seq").is_some() {
                        return true;
                    }
                }
            }
            Err(e) if e.kind() == ErrorKind::TimedOut => continue,
            Err(_) => return false,
        }
    }
    false
}

// Scans all available serial ports and returns the first one that responds
// with a recognizable JSON payload from the receiver.
fn scan_all_ports() -> Option<String> {
    let ports = serialport::available_ports().ok()?;
    println!(
        "[serial] scanning {} available port(s): {:?}",
        ports.len(),
        ports.iter().map(|p| p.port_name.clone()).collect::<Vec<_>>()
    );

    for p in ports {
        println!("[serial] probing {}...", p.port_name);
        if probe_port(&p.port_name) {
            println!("[serial] found receiver on {}", p.port_name);
            return Some(p.port_name);
        }
    }
    None
}

// Tries the last known-good port first (fast path). Only falls back to a
// full scan of every port if that one no longer responds — e.g. the
// receiver was moved to a different USB slot.
fn find_receiver_port() -> Option<String> {
    let cached = LAST_KNOWN_PORT.lock().unwrap().clone();

    if let Some(port_name) = cached {
        println!("[serial] trying last known port {} first...", port_name);
        if probe_port(&port_name) {
            println!("[serial] confirmed receiver still on {}", port_name);
            return Some(port_name);
        }
        println!("[serial] {} no longer responding, falling back to full scan", port_name);
    }

    let found = scan_all_ports();
    if let Some(ref port_name) = found {
        *LAST_KNOWN_PORT.lock().unwrap() = Some(port_name.clone());
    }
    found
}

fn start_serial_listener(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        loop {
            let port_name = match find_receiver_port() {
                Some(p) => p,
                None => {
                    println!("[serial] no receiver found on any port. Retrying in 3s...");
                    thread::sleep(Duration::from_secs(3));
                    continue;
                }
            };

            match serialport::new(&port_name, BAUD_RATE)
                .timeout(Duration::from_millis(10000))
                .open()
            {
                Ok(mut port) => {
                    release_reset_lines(&mut port);
                    thread::sleep(Duration::from_millis(1000));

                    println!("[serial] Connected to receiver on {}", port_name);
                    let reader = BufReader::new(port);

                    let mut reading_buffer: Vec<BufferedReading> = Vec::new();
                    let mut last_flush = Instant::now();

                    for line in reader.lines() {
                        match line {
                            Ok(text) => {
                                let trimmed = text.trim();
                                if trimmed.is_empty() {
                                    continue;
                                }

                                println!("[serial] raw: {}", trimmed);

                                match serde_json::from_str::<Value>(trimmed) {
                                    Ok(json) => {
                                        // Buffer this reading for DB insertion if it's a
                                        // genuinely valid, geo-tagged soil reading — same
                                        // validity filter the frontend uses for its own
                                        // live display.
                                        let soil_valid =
                                            json.get("soilValid").and_then(|v| v.as_i64()) == Some(1);
                                        let lat = json.get("lat").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                        let lng = json.get("lng").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                        let has_fix = lat != 0.0 || lng != 0.0;

                                        if soil_valid && has_fix {
                                            reading_buffer.push(BufferedReading {
                                                latitude: lat,
                                                longitude: lng,
                                                ph: json.get("ph").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                                moisture: json
                                                    .get("moisture")
                                                    .and_then(|v| v.as_f64())
                                                    .unwrap_or(0.0),
                                                ec: json.get("ec").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                                nitrogen: json
                                                    .get("nitrogen")
                                                    .and_then(|v| v.as_f64())
                                                    .unwrap_or(0.0),
                                                phosphorus: json
                                                    .get("phosphorus")
                                                    .and_then(|v| v.as_f64())
                                                    .unwrap_or(0.0),
                                                potassium: json
                                                    .get("potassium")
                                                    .and_then(|v| v.as_f64())
                                                    .unwrap_or(0.0),
                                            });
                                        }

                                        let _ = app_handle.emit("sensor-data", json);
                                    }
                                    Err(e) => {
                                        // Not valid JSON — likely a boot message or debug line
                                        println!("[serial] skipped non-JSON line ({})", e);
                                    }
                                }

                                // Flush whenever the window elapses or the buffer fills,
                                // whichever comes first.
                                if !reading_buffer.is_empty()
                                    && (last_flush.elapsed() >= INSERT_WINDOW
                                        || reading_buffer.len() >= INSERT_MAX_BUFFER)
                                {
                                    flush_buffer_to_db(&reading_buffer);
                                    reading_buffer.clear();
                                    last_flush = Instant::now();
                                }
                            }
                            Err(e) => {
                                if e.kind() == ErrorKind::TimedOut {
                                    // Normal — just means no new line arrived within the
                                    // timeout window (e.g. sender polls every 2s). Keep
                                    // listening instead of tearing down the connection.
                                    continue;
                                }
                                println!("[serial] read error: {}. Reconnecting...", e);
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    println!(
                        "[serial] Could not reopen {} after probing succeeded: {}. Retrying in 3s...",
                        port_name, e
                    );
                }
            }

            thread::sleep(Duration::from_secs(3));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            start_serial_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![init_db, get_recent_telemetry, import_telemetry_json, export_telemetry_to_project])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}