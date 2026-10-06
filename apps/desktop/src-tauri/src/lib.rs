use rusqlite::{params, Connection, Result};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

mod database;

static DB_LOCK: Mutex<()> = Mutex::new(());

static DB_READY:
    OnceLock<std::result::Result<(), String>> =
    OnceLock::new();

static DB_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize)]
pub struct Crop {
    pub id: Option<i64>,
    pub name: String,
    pub target_ph_min: Option<f64>,
    pub target_ph_max: Option<f64>,
    pub target_moisture_min: Option<f64>,
    pub target_moisture_max: Option<f64>,
    pub ec_tolerance_max: Option<f64>,
    pub optimal_nitrogen: Option<f64>,
    pub optimal_phosphorus: Option<f64>,
    pub optimal_potassium: Option<f64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Field {
    pub id: Option<i64>,
    pub name: String,
    pub boundary_geojson: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Mission {
    pub id: Option<i64>,
    pub field_id: i64,
    pub name: String,
    pub mission_date: Option<String>,
    pub pins_geojson: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[tauri::command]
fn database_select(
    sql: String,
    values: Vec<Value>,
) -> database::DbResult<Vec<serde_json::Map<String, Value>>> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    database::select(&conn, &sql, &values)
}

#[tauri::command]
fn database_execute(
    sql: String,
    values: Vec<Value>,
) -> database::DbResult<Value> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    let args = values
        .iter()
        .map(database::to_sql)
        .collect::<database::DbResult<Vec<_>>>()?;

    let changed = conn
        .execute(
            &sql,
            rusqlite::params_from_iter(args),
        )
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "rowsAffected": changed,
        "lastInsertId": conn.last_insert_rowid()
    }))
}

#[tauri::command]
fn database_snapshot(
) -> database::DbResult<database::Snapshot> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let mut conn =
        get_connection().map_err(|e| e.to_string())?;

    let tx = conn
        .transaction()
        .map_err(|e| e.to_string())?;

    database::snapshot(&tx)
}

#[tauri::command]
fn database_status() -> database::DbResult<Value> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut total: i64 = 0;
    let mut counts = serde_json::Map::new();

    for table in database::tables(&conn)? {
        let count: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM {}",
                    database::quote(&table)
                ),
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        total += count;
        counts.insert(table, serde_json::json!(count));
    }

    Ok(serde_json::json!({
        "total": total,
        "tables": counts
    }))
}

#[tauri::command]
fn validate_database_backup(
    file_content: String,
) -> database::DbResult<database::Snapshot> {
    let data =
        database::parse_snapshot(&file_content)?;

    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    database::validate(&conn, &data)?;

    Ok(data)
}

#[tauri::command]
fn replace_database(
    data: database::Snapshot,
    expected_revision: Option<i64>,
    consolidate_legacy: Option<bool>,
) -> database::DbResult<Value> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;

    let mut conn =
        get_connection().map_err(|e| e.to_string())?;

    database::restore(
        &mut conn,
        &data,
        expected_revision,
        consolidate_legacy.unwrap_or(false),
    )?;

    DB_GENERATION.fetch_add(1, Ordering::SeqCst);

    let records = database::select(
        &conn,
        "SELECT * FROM telemetry ORDER BY id DESC LIMIT 200",
        &[],
    )?;

    let latest_id: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(id),0) FROM telemetry",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let total: usize = data
        .tables
        .values()
        .map(|table| table.rows.len())
        .sum();

    Ok(serde_json::json!({
        "records": records,
        "latestId": latest_id,
        "count": total,
        "generation": DB_GENERATION.load(Ordering::SeqCst)
    }))
}

// Read the old SQL-plugin database without changing it.
// Normalize its schema into a full package, then consolidate it
// using the same merge planner as normal database merges.
#[tauri::command]
fn legacy_database_snapshot(
    app: tauri::AppHandle,
) -> database::DbResult<Option<database::Snapshot>> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let mut conn = get_connection().map_err(|e| e.to_string())?;

    if database::meta(&conn, "legacy_consolidated")?
        .as_deref()
        == Some("1")
    {
        return Ok(None);
    }

    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("eksplorador.db");

    if !path.exists()
        || path.canonicalize().ok()
            == db_path().canonicalize().ok()
    {
        database::set_meta(
            &conn,
            "legacy_consolidated",
            "1",
        )?;

        return Ok(None);
    }

    let mut old = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;

    let tx = old
        .transaction()
        .map_err(|e| e.to_string())?;

    database::preserve_additional_columns(&mut conn, &tx)?;
    database::ensure_schema(&mut conn)?;

    let mut data = database::snapshot(&conn)?;

    for table in data.tables.values_mut() {
        table.rows.clear();
    }

    data.sequences.clear();
    data.origins.clear();

    data.source_id =
        format!("legacy:{}", path.to_string_lossy());

    for name in database::tables(&tx)? {
        let target = data
            .tables
            .get_mut(&name)
            .ok_or_else(|| {
                format!(
                    "The older database contains an unsupported table: {}. \
                     It has been left intact.",
                    name
                )
            })?;

        let rows = database::select(
            &tx,
            &format!(
                "SELECT * FROM {}",
                database::quote(&name)
            ),
            &[],
        )?;

        for row in rows {
            let mut normalized = serde_json::Map::new();

            for (key, value) in row {
                let column = target
                    .columns
                    .iter()
                    .find(|column| {
                        column.name.eq_ignore_ascii_case(&key)
                    })
                    .ok_or_else(|| {
                        format!(
                            "The older {} table has an unsupported column: {}. \
                             Consolidation stopped to preserve it.",
                            name, key
                        )
                    })?;

                normalized.insert(column.name.clone(), value);
            }

            let mut row = normalized;

            for column in &target.columns {
                row.entry(column.name.clone())
                    .or_insert(Value::Null);
            }

            target.rows.push(row);
        }
    }

    let has_sequence: i64 = tx
        .query_row(
            "SELECT COUNT(*)
             FROM sqlite_master
             WHERE name='sqlite_sequence'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if has_sequence > 0 {
        for row in database::select(
            &tx,
            "SELECT name,seq FROM sqlite_sequence",
            &[],
        )? {
            if let (Some(name), Some(sequence)) =
                (row["name"].as_str(), row["seq"].as_i64())
            {
                if data.tables.contains_key(name) {
                    data.sequences.insert(
                        name.into(),
                        sequence,
                    );
                }
            }
        }
    }

    if data
        .tables
        .values()
        .all(|table| table.rows.is_empty())
    {
        database::set_meta(
            &conn,
            "legacy_consolidated",
            "1",
        )?;

        return Ok(None);
    }

    database::validate(&conn, &data)?;

    Ok(Some(data))
}

#[tauri::command]
fn export_database(
    file_path: String,
    overwrite: bool,
) -> database::DbResult<String> {
    let payload = database_snapshot()?;

    if payload
        .tables
        .values()
        .all(|table| table.rows.is_empty())
    {
        return Err("The database is empty.".into());
    }

    let mut target_path = PathBuf::from(file_path);

    if !target_path.is_absolute() {
        return Err(
            "Please choose a full file path in Save As."
                .into(),
        );
    }

    if !target_path
        .to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(".json")
    {
        target_path.as_mut_os_string().push(".json");
    }

    let json_string =
        serde_json::to_string_pretty(&payload)
            .map_err(|e| e.to_string())?;

    if overwrite {
        // Write beside the destination and then rename.
        // A failed write must not truncate the previous backup.
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();

        let temporary = target_path
            .with_extension(
                format!("json.{}.tmp", nonce)
            );

        let result = (|| -> database::DbResult<()> {
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;

            std::io::Write::write_all(
                &mut output,
                json_string.as_bytes(),
            )
            .map_err(|e| e.to_string())?;

            output
                .sync_all()
                .map_err(|e| e.to_string())?;

            drop(output);

            fs::rename(
                &temporary,
                &target_path,
            )
            .map_err(|e| e.to_string())?;

            Ok(())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }

        result?;
    } else {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_path)
            .map_err(|e| {
                if e.kind() == ErrorKind::AlreadyExists {
                    "EXPORT_FILE_EXISTS".into()
                } else {
                    format!("Failed to create export: {}", e)
                }
            })?;

        let result = std::io::Write::write_all(
            &mut output,
            json_string.as_bytes(),
        )
        .and_then(|_| output.sync_all());

        drop(output);

        if let Err(error) = result {
            let _ = fs::remove_file(&target_path);
            return Err(error.to_string());
        }
    }

    Ok(target_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_crops(
) -> std::result::Result<Vec<Crop>, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT
                id,
                name,
                target_ph_min,
                target_ph_max,
                target_moisture_min,
                target_moisture_max,
                ec_tolerance_max,
                optimal_nitrogen,
                optimal_phosphorus,
                optimal_potassium,
                created_at,
                updated_at
             FROM crops
             ORDER BY name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Crop {
                id: row.get(0)?,
                name: row.get(1)?,
                target_ph_min: row.get(2)?,
                target_ph_max: row.get(3)?,
                target_moisture_min: row.get(4)?,
                target_moisture_max: row.get(5)?,
                ec_tolerance_max: row.get(6)?,
                optimal_nitrogen: row.get(7)?,
                optimal_phosphorus: row.get(8)?,
                optimal_potassium: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();

    for row in rows {
        records.push(
            row.map_err(|e| e.to_string())?
        );
    }

    Ok(records)
}

#[tauri::command]
fn create_field(
    name: String,
    boundary_geojson: Option<String>,
) -> std::result::Result<i64, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO fields (name, boundary_geojson)
         VALUES (?1, ?2)",
        params![name, boundary_geojson],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_fields(
) -> std::result::Result<Vec<Field>, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT
                id,
                name,
                boundary_geojson,
                created_at,
                updated_at
             FROM fields
             ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Field {
                id: row.get(0)?,
                name: row.get(1)?,
                boundary_geojson: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();

    for row in rows {
        records.push(
            row.map_err(|e| e.to_string())?
        );
    }

    Ok(records)
}

#[tauri::command]
fn create_mission(
    field_id: i64,
    name: String,
    pins_geojson: Option<String>,
) -> std::result::Result<i64, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO missions (
            field_id,
            name,
            pins_geojson,
            status,
            mission_date
         )
         VALUES (
            ?1,
            ?2,
            ?3,
            'planned',
            strftime('%Y-%m-%d','now','+8 hours')
         )",
        params![field_id, name, pins_geojson],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_missions(
) -> std::result::Result<Vec<Mission>, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT
                id,
                field_id,
                name,
                mission_date,
                pins_geojson,
                status,
                created_at,
                updated_at
             FROM missions
             ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Mission {
                id: row.get(0)?,
                field_id: row.get(1)?,
                name: row.get(2)?,
                mission_date: row.get(3)?,
                pins_geojson: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();

    for row in rows {
        records.push(
            row.map_err(|e| e.to_string())?
        );
    }

    Ok(records)
}

fn db_path() -> PathBuf {
    // Preserve the existing Rust database location.
    // Frontend queries now use this same database.
    let path = PathBuf::from(
        env!("CARGO_MANIFEST_DIR")
    )
    .join("eksplorador.db");

    eprintln!(
        "[db] using database at: {}",
        path.display()
    );

    path
}

fn get_connection() -> Result<Connection> {
    let ready = DB_READY.get_or_init(|| {
        let mut conn = Connection::open(db_path())
            .map_err(|e| e.to_string())?;

        conn.busy_timeout(Duration::from_secs(10))
            .map_err(|e| e.to_string())?;

        let migrations = Migrations::new(vec![
            M::up(include_str!(
                "../migrations/V1__create_telemetry_table.sql"
            )),
            M::up(include_str!(
                "../migrations/V2__add_npk_columns.sql"
            )),
            M::up(include_str!(
                "../migrations/V4__add_mission_and_audit_timestamps.sql"
            )),
            M::up(include_str!(
                "../migrations/V5__create_additional_tables.sql"
            )),
        ]);

        migrations
            .to_latest(&mut conn)
            .map_err(|e| e.to_string())?;

        database::ensure_schema(&mut conn)?;

        Ok(())
    });

    if let Err(message) = ready {
        return Err(
            rusqlite::Error::ToSqlConversionFailure(
                Box::new(std::io::Error::new(
                    ErrorKind::Other,
                    message.clone(),
                )),
            ),
        );
    }

    let conn = Connection::open(db_path())?;

    conn.busy_timeout(Duration::from_secs(10))?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    Ok(conn)
}

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

const INSERT_WINDOW: Duration =
    Duration::from_secs(30);

const INSERT_MAX_BUFFER: usize = 5;

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

fn flush_buffer_to_db(
    buffer: &[BufferedReading],
    generation: u64,
) {
    let _guard = match DB_LOCK.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    if generation
        != DB_GENERATION.load(Ordering::SeqCst)
    {
        return;
    }

    if buffer.is_empty() {
        return;
    }

    let n = buffer.len() as f64;

    let avg_ph =
        buffer.iter().map(|row| row.ph).sum::<f64>() / n;

    let avg_moisture = buffer
        .iter()
        .map(|row| row.moisture)
        .sum::<f64>()
        / n;

    let avg_ec =
        buffer.iter().map(|row| row.ec).sum::<f64>() / n;

    let avg_n = buffer
        .iter()
        .map(|row| row.nitrogen)
        .sum::<f64>()
        / n;

    let avg_p = buffer
        .iter()
        .map(|row| row.phosphorus)
        .sum::<f64>()
        / n;

    let avg_k = buffer
        .iter()
        .map(|row| row.potassium)
        .sum::<f64>()
        / n;

    let latest = buffer.last().unwrap();

    let conn = match get_connection() {
        Ok(connection) => connection,

        Err(error) => {
            println!(
                "[db] failed to open connection for insert: {}",
                error
            );
            return;
        }
    };

    let result = conn.execute(
        "INSERT INTO telemetry (
            timestamp,
            latitude,
            longitude,
            ph,
            moisture,
            ec,
            nitrogen,
            phosphorus,
            potassium
         )
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
            "[db] inserted averaged row from {} reading(s): \
             ph={:.2} moisture={:.1} ec={:.2}",
            buffer.len(),
            avg_ph,
            avg_moisture,
            avg_ec
        ),

        Err(error) => {
            println!("[db] insert failed: {}", error)
        }
    }
}

#[tauri::command]
fn init_db() -> std::result::Result<(), String> {
    get_connection().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_recent_telemetry() -> database::DbResult<Value> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let conn = get_connection().map_err(|e| e.to_string())?;

    let records = database::select(
        &conn,
        "SELECT *
         FROM telemetry
         ORDER BY id DESC
         LIMIT 200",
        &[],
    )?;

    Ok(serde_json::json!({
        "records": records,
        "generation": DB_GENERATION.load(Ordering::SeqCst)
    }))
}

const BAUD_RATE: u32 = 115200;

static LAST_KNOWN_PORT: Mutex<Option<String>> =
    Mutex::new(None);

fn release_reset_lines(
    port: &mut Box<dyn serialport::SerialPort>,
) {
    let _ = port.write_data_terminal_ready(false);
    let _ = port.write_request_to_send(false);
}

fn probe_port(port_name: &str) -> bool {
    let mut port =
        match serialport::new(port_name, BAUD_RATE)
            .timeout(Duration::from_millis(500))
            .open()
        {
            Ok(port) => port,
            Err(_) => return false,
        };

    release_reset_lines(&mut port);

    thread::sleep(Duration::from_millis(1000));

    let mut reader = BufReader::new(port);

    let deadline =
        Instant::now() + Duration::from_millis(3500);

    while Instant::now() < deadline {
        let mut line = String::new();

        match reader.read_line(&mut line) {
            Ok(0) => continue,

            Ok(_) => {
                let trimmed = line.trim();

                if let Ok(json) =
                    serde_json::from_str::<Value>(trimmed)
                {
                    if json.get("seq").is_some() {
                        return true;
                    }
                }
            }

            Err(error)
                if error.kind() == ErrorKind::TimedOut =>
            {
                continue;
            }

            Err(_) => return false,
        }
    }

    false
}

fn scan_all_ports() -> Option<String> {
    let ports = serialport::available_ports().ok()?;

    println!(
        "[serial] scanning {} available port(s): {:?}",
        ports.len(),
        ports
            .iter()
            .map(|port| port.port_name.clone())
            .collect::<Vec<String>>()
    );

    for port in ports {
        println!(
            "[serial] probing {}...",
            port.port_name
        );

        if probe_port(&port.port_name) {
            println!(
                "[serial] found receiver on {}",
                port.port_name
            );

            return Some(port.port_name);
        }
    }

    None
}

fn find_receiver_port() -> Option<String> {
    let cached =
        LAST_KNOWN_PORT.lock().unwrap().clone();

    if let Some(port_name) = cached {
        println!(
            "[serial] trying last known port {} first...",
            port_name
        );

        if probe_port(&port_name) {
            println!(
                "[serial] confirmed receiver still on {}",
                port_name
            );

            return Some(port_name);
        }

        println!(
            "[serial] {} no longer responding, \
             falling back to full scan",
            port_name
        );
    }

    let found = scan_all_ports();

    if let Some(ref port_name) = found {
        *LAST_KNOWN_PORT.lock().unwrap() =
            Some(port_name.clone());
    }

    found
}

fn start_serial_listener(
    app_handle: tauri::AppHandle,
) {
    thread::spawn(move || {
        loop {
            let port_name = match find_receiver_port() {
                Some(port) => port,

                None => {
                    println!(
                        "[serial] no receiver found on any port. \
                         Retrying in 3s..."
                    );

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

                    thread::sleep(
                        Duration::from_millis(1000)
                    );

                    println!(
                        "[serial] Connected to receiver on {}",
                        port_name
                    );

                    let reader = BufReader::new(port);

                    let mut reading_buffer:
                        Vec<BufferedReading> =
                        Vec::new();

                    let mut last_flush = Instant::now();

                    let mut buffer_generation =
                        DB_GENERATION.load(Ordering::SeqCst);

                    for line in reader.lines() {
                        match line {
                            Ok(text) => {
                                let current_generation =
                                    DB_GENERATION.load(
                                        Ordering::SeqCst
                                    );

                                if current_generation
                                    != buffer_generation
                                {
                                    reading_buffer.clear();

                                    buffer_generation =
                                        current_generation;

                                    last_flush = Instant::now();
                                }

                                let trimmed = text.trim();

                                if trimmed.is_empty() {
                                    continue;
                                }

                                println!(
                                    "[serial] raw: {}",
                                    trimmed
                                );

                                match serde_json::from_str::<Value>(
                                    trimmed
                                ) {
                                    Ok(json) => {
                                        let soil_valid = json
                                            .get("soilValid")
                                            .and_then(|value| {
                                                value.as_i64()
                                            })
                                            == Some(1);

                                        let lat = json
                                            .get("lat")
                                            .and_then(|value| {
                                                value.as_f64()
                                            })
                                            .unwrap_or(0.0);

                                        let lng = json
                                            .get("lng")
                                            .and_then(|value| {
                                                value.as_f64()
                                            })
                                            .unwrap_or(0.0);

                                        // Preserve the existing backend
                                        // saving condition.
                                        let has_fix =
                                            lat != 0.0 || lng != 0.0;

                                        if soil_valid && has_fix {
                                            reading_buffer.push(
                                                BufferedReading {
                                                    latitude: lat,
                                                    longitude: lng,

                                                    ph: json
                                                        .get("ph")
                                                        .and_then(|value| {
                                                            value.as_f64()
                                                        })
                                                        .unwrap_or(0.0),

                                                    moisture: json
                                                        .get("moisture")
                                                        .and_then(|value| {
                                                            value.as_f64()
                                                        })
                                                        .unwrap_or(0.0),

                                                    ec: json
                                                        .get("ec")
                                                        .and_then(|value| {
                                                            value.as_f64()
                                                        })
                                                        .unwrap_or(0.0),

                                                    nitrogen: json
                                                        .get("nitrogen")
                                                        .and_then(|value| {
                                                            value.as_f64()
                                                        })
                                                        .unwrap_or(0.0),

                                                    phosphorus: json
                                                        .get("phosphorus")
                                                        .and_then(|value| {
                                                            value.as_f64()
                                                        })
                                                        .unwrap_or(0.0),

                                                    potassium: json
                                                        .get("potassium")
                                                        .and_then(|value| {
                                                            value.as_f64()
                                                        })
                                                        .unwrap_or(0.0),
                                                },
                                            );
                                        }

                                        let _ = app_handle.emit(
                                            "sensor-data",
                                            json,
                                        );
                                    }

                                    Err(error) => {
                                        println!(
                                            "[serial] skipped non-JSON line ({})",
                                            error
                                        );
                                    }
                                }

                                if !reading_buffer.is_empty()
                                    && (
                                        last_flush.elapsed()
                                            >= INSERT_WINDOW
                                        || reading_buffer.len()
                                            >= INSERT_MAX_BUFFER
                                    )
                                {
                                    flush_buffer_to_db(
                                        &reading_buffer,
                                        buffer_generation,
                                    );

                                    reading_buffer.clear();
                                    last_flush = Instant::now();
                                }
                            }

                            Err(error) => {
                                if error.kind()
                                    == ErrorKind::TimedOut
                                {
                                    continue;
                                }

                                println!(
                                    "[serial] read error: {}. \
                                     Reconnecting...",
                                    error
                                );

                                break;
                            }
                        }
                    }
                }

                Err(error) => {
                    println!(
                        "[serial] Could not reopen {} after probing \
                         succeeded: {}. Retrying in 3s...",
                        port_name,
                        error
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            start_serial_listener(
                app.handle().clone()
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            get_recent_telemetry,
            database_select,
            database_execute,
            database_snapshot,
            database_status,
            validate_database_backup,
            replace_database,
            legacy_database_snapshot,
            export_database,
            get_crops,
            create_field,
            get_fields,
            create_mission,
            get_missions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}