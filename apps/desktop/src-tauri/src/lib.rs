use serde_json::Value;
use std::io::{BufRead, BufReader, ErrorKind};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;
use rusqlite::{params, Connection, Result};
use rusqlite_migration::{Migrations, M};
use serde::Serialize;

#[derive(Serialize)]
pub struct TelemetryRow {
    pub id: i64,
    pub mission_id: Option<String>,
    pub plot: Option<String>,
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

fn get_connection() -> Result<Connection> {
    let mut conn = Connection::open("eksplorador.db")?;

    let migrations = Migrations::new(vec![
        M::up(include_str!("../migrations/V1__create_telemetry_table.sql")),
        M::up(include_str!("../migrations/V2__add_npk_columns.sql")),
    ]);

    migrations.to_latest(&mut conn).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(e))
    })?;

    Ok(conn)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn init_db() -> Result<(), String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let _count: i64 = conn
        .query_row("SELECT COUNT(*) FROM telemetry", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_all_telemetry() -> Result<Vec<TelemetryRow>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, mission_id, plot, timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium FROM telemetry ORDER BY id DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TelemetryRow {
                id: row.get(0)?,
                mission_id: row.get(1)?,
                plot: row.get(2)?,
                timestamp: row.get(3)?,
                latitude: row.get(4)?,
                longitude: row.get(5)?,
                ph: row.get(6)?,
                moisture: row.get(7)?,
                ec: row.get(8)?,
                nitrogen: row.get(9)?,
                phosphorus: row.get(10)?,
                potassium: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| e.to_string())?);
    }

    Ok(records)
}

#[tauri::command]
fn get_recent_telemetry() -> Result<Vec<TelemetryRow>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, mission_id, plot, timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium FROM telemetry ORDER BY id DESC LIMIT 5")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TelemetryRow {
                id: row.get(0)?,
                mission_id: row.get(1)?,
                plot: row.get(2)?,
                timestamp: row.get(3)?,
                latitude: row.get(4)?,
                longitude: row.get(5)?,
                ph: row.get(6)?,
                moisture: row.get(7)?,
                ec: row.get(8)?,
                nitrogen: row.get(9)?,
                phosphorus: row.get(10)?,
                potassium: row.get(11)?,
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
                                        let _ = app_handle.emit("sensor-data", json);
                                    }
                                    Err(e) => {
                                        // Not valid JSON — likely a boot message or debug line
                                        println!("[serial] skipped non-JSON line ({})", e);
                                    }
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
        .setup(|app| {
            start_serial_listener(app.handle().clone());
            Ok(())
        })
        // Updated handler list to include all three database commands
        .invoke_handler(tauri::generate_handler![
            init_db,
            get_all_telemetry,
            get_recent_telemetry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}