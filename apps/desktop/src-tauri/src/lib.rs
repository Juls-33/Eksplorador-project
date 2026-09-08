use rusqlite::{Connection, Result};
use rusqlite_migration::{Migrations, M};
use serde::Serialize;


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

fn get_connection() -> Result<Connection>{
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
fn init_db() -> Result<(),String>{
    let conn = get_connection().map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM telemetry", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if count == 0 {
        conn.execute(
            "INSERT INTO telemetry (timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium) VALUES
            ('14:32:05', 14.6095, 120.9890, 6.4, 42.5, 1.25, 1.2, 38.0, 55.0),
            ('14:35:10', 14.6098, 120.9894, 6.2, 38.0, 1.10, 1.1, 36.5, 52.0),
            ('14:40:22', 14.6102, 120.9899, 6.5, 45.2, 1.30, 1.4, 40.0, 58.0)",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_recent_telemetry() -> Result<Vec<TelemetryRow>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, latitude, longitude, ph, moisture, ec, nitrogen, phosphorus, potassium FROM telemetry ORDER BY id DESC LIMIT 5")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![init_db, get_recent_telemetry])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}