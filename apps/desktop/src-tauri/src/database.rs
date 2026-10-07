//! Shared SQLite access, full snapshots, and atomic restoration.
//! Imported files contain data only. Their schema SQL is never executed.

use rusqlite::{
    params,
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
    OptionalExtension,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub type DbResult<T> = std::result::Result<T, String>;

pub const NOW_PH: &str =
    "strftime('%Y-%m-%dT%H:%M:%f+08:00','now','+8 hours')";

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub required: bool,
    pub primary_key: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ForeignKey {
    pub column: String,
    pub table: String,
    pub target: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Table {
    pub columns: Vec<Column>,
    pub foreign_keys: Vec<ForeignKey>,
    pub rows: Vec<Map<String, Value>>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Snapshot {
    pub format: String,
    pub version: u32,
    pub timezone: String,
    pub exported_at: String,
    pub source_id: String,
    pub revision: i64,
    pub tables: BTreeMap<String, Table>,

    #[serde(default)]
    pub sequences: BTreeMap<String, i64>,

    #[serde(default)]
    pub origins: Vec<Value>,
}

pub fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn project_legacy_row(
    row: Map<String, Value>,
    columns: &[Column],
) -> (Map<String, Value>, Vec<String>) {
    let supported: BTreeSet<&str> =
        columns.iter().map(|column| column.name.as_str()).collect();

    let ignored = row
        .keys()
        .filter(|name| !supported.contains(name.as_str()))
        .cloned()
        .collect();

    let projected = columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                row.get(&column.name)
                    .cloned()
                    .unwrap_or(Value::Null),
            )
        })
        .collect();

    (projected, ignored)
}

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn select(
    conn: &Connection,
    sql: &str,
    values: &[Value],
) -> DbResult<Vec<Map<String, Value>>> {
    let args = values
        .iter()
        .map(to_sql)
        .collect::<DbResult<Vec<_>>>()?;

    let mut statement = conn.prepare(sql).map_err(error)?;

    if !statement.readonly() {
        return Err(
            "The select command accepts read-only SQL only.".into()
        );
    }

    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|v| v.to_string())
        .collect();

    let rows = statement
        .query_map(params_from_iter(args), |row| {
            let mut result = Map::new();

            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(v) => {
                        Value::String(
                            String::from_utf8_lossy(v).into_owned()
                        )
                    }
                    ValueRef::Blob(v) => {
                        json!({ "$sqlite_blob": v })
                    }
                };

                result.insert(name.clone(), value);
            }

            Ok(result)
        })
        .map_err(error)?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)
}

pub fn to_sql(value: &Value) -> DbResult<SqlValue> {
    Ok(match value {
        Value::Null => SqlValue::Null,

        Value::Bool(v) => SqlValue::Integer(i64::from(*v)),

        Value::Number(v) => {
            if let Some(n) = v.as_i64() {
                SqlValue::Integer(n)
            } else if v.is_f64() {
                SqlValue::Real(
                    v.as_f64().ok_or("Invalid number")?
                )
            } else {
                return Err(
                    "Integer is outside SQLite's signed 64-bit range."
                        .into(),
                );
            }
        }

        Value::String(v) => SqlValue::Text(v.clone()),

        Value::Object(v)
            if v.len() == 1 && v.contains_key("$sqlite_blob") =>
        {
            let bytes: Vec<u8> =
                serde_json::from_value(v["$sqlite_blob"].clone())
                    .map_err(error)?;

            SqlValue::Blob(bytes)
        }

        _ => {
            return Err(
                "A database cell must be a scalar or a SQLite blob."
                    .into(),
            );
        }
    })
}

pub fn tables(conn: &Connection) -> DbResult<Vec<String>> {
    let mut statement = conn
        .prepare(
            "SELECT name
             FROM sqlite_master
             WHERE type = 'table'
               AND name NOT LIKE 'sqlite_%'
               AND substr(name, 1, 1) != '_'
             ORDER BY name",
        )
        .map_err(error)?;

    let rows = statement
        .query_map([], |row| row.get(0))
        .map_err(error)?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)
}

pub fn preserve_additional_columns(
    target: &mut Connection,
    source: &Connection,
) -> DbResult<()> {
    let tx = target.transaction().map_err(error)?;
    let target_tables: BTreeSet<_> =
        tables(&tx)?.into_iter().collect();

    for table in tables(source)? {
        if !target_tables.contains(&table) {
            return Err(format!(
                "The older database contains an unsupported table: {}. \
                 It has been left intact.",
                table
            ));
        }

        let source_columns = select(
            source,
            &format!("PRAGMA table_info({})", quote(&table)),
            &[],
        )?;

        let target_columns = select(
            &tx,
            &format!("PRAGMA table_info({})", quote(&table)),
            &[],
        )?;

        for column in source_columns {
            let Some(name) = column["name"].as_str() else {
                continue;
            };

            if !target_columns.iter().any(|existing| {
                existing["name"]
                    .as_str()
                    .map(|existing_name| {
                        existing_name.eq_ignore_ascii_case(name)
                    })
                    .unwrap_or(false)
            }) {
                tx.execute_batch(&format!(
                    "ALTER TABLE {} ADD COLUMN {}",
                    quote(&table),
                    quote(name)
                ))
                .map_err(error)?;

                tx.execute_batch(&format!(
                    "DROP TRIGGER IF EXISTS {}",
                    quote(&format!("_app_update_{}", table))
                ))
                .map_err(error)?;
            }
        }
    }

    tx.commit().map_err(error)
}

pub fn meta(
    conn: &Connection,
    key: &str,
) -> DbResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM _app_meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(error)
}

pub fn set_meta(
    conn: &Connection,
    key: &str,
    value: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO _app_meta(key, value)
         VALUES(?1, ?2)
         ON CONFLICT(key)
         DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(error)?;

    Ok(())
}

pub fn revision(conn: &Connection) -> DbResult<i64> {
    Ok(
        meta(conn, "revision")?
            .unwrap_or_default()
            .parse()
            .unwrap_or(0),
    )
}

pub fn ensure_schema(conn: &mut Connection) -> DbResult<()> {
    let tx = conn.transaction().map_err(error)?;

    tx.execute_batch(
        include_str!("../migrations/database_support.sql"),
    )
    .map_err(error)?;

    let existing = select(
        &tx,
        "PRAGMA table_info(telemetry)",
        &[],
    )?;

    for (name, definition) in [
        ("plot", "TEXT"),
        ("overall", "REAL"),
    ] {
        if !existing.iter().any(|column| column["name"] == name) {
            tx.execute_batch(
                &format!(
                    "ALTER TABLE telemetry ADD COLUMN {} {}",
                    quote(name),
                    definition
                ),
            )
            .map_err(error)?;
        }
    }

    // Existing audit values are left untouched.
    // Only future normal writes receive UTC+8 timestamps.
    for table in tables(&tx)? {
        let info = select(
            &tx,
            &format!("PRAGMA table_info({})", quote(&table)),
            &[],
        )?;

        for name in ["created_at", "updated_at"] {
            if !info.iter().any(|column| column["name"] == name) {
                tx.execute_batch(
                    &format!(
                        "ALTER TABLE {} ADD COLUMN {} TEXT DEFAULT NULL",
                        quote(&table),
                        name
                    ),
                )
                .map_err(error)?;
            }
        }

        let business_columns: Vec<String> = info
            .iter()
            .filter_map(|column| column["name"].as_str())
            .filter(|name| {
                *name != "created_at" && *name != "updated_at"
            })
            .map(quote)
            .collect();

        let q = quote(&table);

        let enabled =
            "COALESCE(
                (SELECT value FROM _app_meta WHERE key='transferring'),
                '0'
             )='0'";

        tx.execute_batch(
            &format!(
                "CREATE TRIGGER IF NOT EXISTS {insert_trigger}
                 AFTER INSERT ON {q}
                 WHEN {enabled}
                 BEGIN
                    UPDATE {q}
                    SET created_at={now}, updated_at={now}
                    WHERE rowid=NEW.rowid;

                    UPDATE _app_meta
                    SET value=CAST(value AS INTEGER)+1
                    WHERE key='revision';
                 END;

                 CREATE TRIGGER IF NOT EXISTS {update_trigger}
                 AFTER UPDATE OF {cols} ON {q}
                 WHEN {enabled}
                 BEGIN
                    UPDATE {q}
                    SET created_at=OLD.created_at, updated_at={now}
                    WHERE rowid=NEW.rowid;

                    UPDATE _app_meta
                    SET value=CAST(value AS INTEGER)+1
                    WHERE key='revision';
                 END;

                 CREATE TRIGGER IF NOT EXISTS {delete_trigger}
                 AFTER DELETE ON {q}
                 WHEN {enabled}
                 BEGIN
                    UPDATE _app_meta
                    SET value=CAST(value AS INTEGER)+1
                    WHERE key='revision';
                 END;",
                insert_trigger =
                    quote(&format!("_app_insert_{}", table)),
                update_trigger =
                    quote(&format!("_app_update_{}", table)),
                delete_trigger =
                    quote(&format!("_app_delete_{}", table)),
                now = NOW_PH,
                cols = business_columns.join(","),
            ),
        )
        .map_err(error)?;
    }

    tx.commit().map_err(error)
}

pub fn snapshot(conn: &Connection) -> DbResult<Snapshot> {
    let mut result = BTreeMap::new();

    for name in tables(conn)? {
        let info = select(
            conn,
            &format!("PRAGMA table_info({})", quote(&name)),
            &[],
        )?;

        let columns = info
            .iter()
            .map(|column| Column {
                name: column["name"]
                    .as_str()
                    .unwrap_or_default()
                    .into(),

                data_type: column["type"]
                    .as_str()
                    .unwrap_or_default()
                    .into(),

                required:
                    column["notnull"].as_i64().unwrap_or(0) != 0,

                primary_key:
                    column["pk"].as_i64().unwrap_or(0) != 0,
            })
            .collect();

        let foreign_key_rows = select(
            conn,
            &format!(
                "PRAGMA foreign_key_list({})",
                quote(&name)
            ),
            &[],
        )?;

        let mut foreign_keys: Vec<ForeignKey> =
            foreign_key_rows
                .iter()
                .map(|foreign_key| ForeignKey {
                    column: foreign_key["from"]
                        .as_str()
                        .unwrap_or_default()
                        .into(),

                    table: foreign_key["table"]
                        .as_str()
                        .unwrap_or_default()
                        .into(),

                    target: foreign_key["to"]
                        .as_str()
                        .unwrap_or("id")
                        .into(),
                })
                .collect();

        // The older telemetry schema did not declare this FK.
        // Include it in the package so merges can remap mission IDs.
        if name == "telemetry"
            && !foreign_keys
                .iter()
                .any(|foreign_key| foreign_key.column == "mission_id")
        {
            foreign_keys.push(ForeignKey {
                column: "mission_id".into(),
                table: "missions".into(),
                target: "id".into(),
            });
        }

        let rows = select(
            conn,
            &format!("SELECT * FROM {}", quote(&name)),
            &[],
        )?;

        result.insert(
            name,
            Table {
                columns,
                foreign_keys,
                rows,
            },
        );
    }

    let mut sequences = BTreeMap::new();

    for row in select(
        conn,
        "SELECT name, seq FROM sqlite_sequence",
        &[],
    )? {
        if let (Some(name), Some(seq)) =
            (row["name"].as_str(), row["seq"].as_i64())
        {
            if result.contains_key(name) {
                sequences.insert(name.into(), seq);
            }
        }
    }

    Ok(Snapshot {
        format: "eksplorador.database".into(),
        version: 2,
        timezone: "Asia/Manila (+08:00)".into(),

        exported_at: conn
            .query_row(
                &format!("SELECT {}", NOW_PH),
                [],
                |row| row.get(0),
            )
            .map_err(error)?,

        source_id: meta(conn, "source_id")?
            .ok_or("Missing database identity")?,

        revision: revision(conn)?,
        tables: result,
        sequences,

        origins: serde_json::from_str(
            &meta(conn, "origins")?
                .unwrap_or_else(|| "[]".into()),
        )
        .map_err(error)?,
    })
}

pub fn parse_snapshot(content: &str) -> DbResult<Snapshot> {
    let value: Value =
        serde_json::from_str(content).map_err(error)?;

    if value.get("format").and_then(Value::as_str)
        != Some("eksplorador.database")
    {
        return Err(
            "This is not a full Eksplorador database backup. \
             Older telemetry-only files cannot replace a whole database; \
             export a new full backup from the updated app."
                .into(),
        );
    }

    let data: Snapshot =
        serde_json::from_value(value).map_err(error)?;

    if data.version != 2 {
        return Err(
            "Unsupported backup version. \
             Update the app before importing this file."
                .into(),
        );
    }

    if data.source_id.is_empty() {
        return Err("The backup has no database identity.".into());
    }

    Ok(data)
}

pub fn dependency_order(
    data: &Snapshot,
) -> DbResult<Vec<String>> {
    let mut pending: BTreeSet<String> =
        data.tables.keys().cloned().collect();

    let mut done = Vec::new();

    while !pending.is_empty() {
        let next = pending
            .iter()
            .find(|name| {
                data.tables[*name]
                    .foreign_keys
                    .iter()
                    .all(|foreign_key| {
                        done.contains(&foreign_key.table)
                    })
            })
            .cloned();

        match next {
            Some(name) => {
                pending.remove(&name);
                done.push(name);
            }

            None => {
                return Err(
                    "Unsupported cyclic or missing database table relationship."
                        .into(),
                );
            }
        }
    }

    Ok(done)
}

pub fn validate(
    conn: &Connection,
    data: &Snapshot,
) -> DbResult<Vec<String>> {
    if data.format != "eksplorador.database"
        || data.version != 2
        || data.source_id.is_empty()
    {
        return Err("Invalid database backup header.".into());
    }

    let live = snapshot(conn)?;

    if live.tables.keys().collect::<Vec<_>>()
        != data.tables.keys().collect::<Vec<_>>()
    {
        return Err(
            "The backup must contain every application table \
             and match this app's schema. No data has been changed."
                .into(),
        );
    }

    let mut references:
        BTreeMap<(String, String), BTreeSet<String>> =
        BTreeMap::new();

    for table in data.tables.values() {
        for foreign_key in &table.foreign_keys {
            if let Some(parent) =
                data.tables.get(&foreign_key.table)
            {
                references
                    .entry((
                        foreign_key.table.clone(),
                        foreign_key.target.clone(),
                    ))
                    .or_insert_with(|| {
                        parent
                            .rows
                            .iter()
                            .filter_map(|row| {
                                row.get(&foreign_key.target)
                            })
                            .map(key_string)
                            .collect()
                    });
            }
        }
    }

    for (name, table) in &data.tables {
        let expected = &live.tables[name];

        let names: BTreeSet<_> = expected
            .columns
            .iter()
            .map(|column| &column.name)
            .collect();

        if serde_json::to_value(&table.columns).map_err(error)?
            != serde_json::to_value(&expected.columns)
                .map_err(error)?
            || serde_json::to_value(&table.foreign_keys)
                .map_err(error)?
                != serde_json::to_value(&expected.foreign_keys)
                    .map_err(error)?
        {
            return Err(format!(
                "Schema mismatch in {}. \
                 Use a backup made with the same app schema.",
                name
            ));
        }

        let primary_keys: Vec<_> = expected
            .columns
            .iter()
            .filter(|column| column.primary_key)
            .collect();

        if primary_keys.len() != 1 {
            return Err(format!(
                "Table {} must have one primary key.",
                name
            ));
        }

        let mut ids = BTreeSet::new();

        for row in &table.rows {
            if row.keys().collect::<BTreeSet<_>>() != names {
                return Err(format!(
                    "A {} record has missing or unknown columns.",
                    name
                ));
            }

            for column in &expected.columns {
                let value = &row[&column.name];

                to_sql(value)?;

                if value
                    .as_i64()
                    .map(|number| {
                        number < -9_007_199_254_740_991
                            || number > 9_007_199_254_740_991
                    })
                    .unwrap_or(false)
                {
                    return Err(format!(
                        "{}.{} exceeds the exact integer range \
                         supported by the desktop UI",
                        name, column.name
                    ));
                }

                if (column.required || column.primary_key)
                    && value.is_null()
                {
                    return Err(format!(
                        "{}.{} cannot be null",
                        name, column.name
                    ));
                }
            }

            let id = &row[&primary_keys[0].name];

            if !id.is_string() && id.as_i64().is_none() {
                return Err(format!(
                    "Invalid {} primary key",
                    name
                ));
            }

            if !ids.insert(id.to_string()) {
                return Err(format!(
                    "Duplicate {} primary key",
                    name
                ));
            }

            for foreign_key in &expected.foreign_keys {
                let key = &row[&foreign_key.column];

                if key.is_null() {
                    continue;
                }

                // Historical descriptive labels such as UNASSIGNED
                // or MSN-001 were not numeric relational IDs.
                if name == "telemetry"
                    && foreign_key.column == "mission_id"
                    && key
                        .as_str()
                        .map(|value| value.parse::<i64>().is_err())
                        .unwrap_or(false)
                {
                    continue;
                }

                let keys = references
                    .get(&(
                        foreign_key.table.clone(),
                        foreign_key.target.clone(),
                    ))
                    .ok_or("Missing referenced table")?;

                if !keys.contains(&key_string(key)) {
                    return Err(format!(
                        "{}.{} refers to a missing {} record ({})",
                        name,
                        foreign_key.column,
                        foreign_key.table,
                        key
                    ));
                }
            }
        }
    }

    for (name, sequence) in &data.sequences {
        if !data.tables.contains_key(name) || *sequence < 0 {
            return Err("Invalid autoincrement sequence".into());
        }
    }

    dependency_order(data)
}

fn key_string(value: &Value) -> String {
    match value {
        Value::String(value) => value
            .parse::<i64>()
            .map(|number| number.to_string())
            .unwrap_or_else(|_| value.clone()),

        _ => value.to_string(),
    }
}

pub fn restore(
    conn: &mut Connection,
    data: &Snapshot,
    expected_revision: Option<i64>,
    consolidate_legacy: bool,
) -> DbResult<()> {
    let tx = conn
        .transaction_with_behavior(
            rusqlite::TransactionBehavior::Immediate,
        )
        .map_err(error)?;

    if let Some(expected) = expected_revision {
        if revision(&tx)? != expected {
            return Err("DATABASE_CHANGED".into());
        }
    }

    let order = validate(&tx, data)?;
    let next_revision = revision(&tx)? + 1;

    // Imported audit values must bypass normal insert/update triggers.
    set_meta(&tx, "transferring", "1")?;

    for name in order.iter().rev() {
        tx.execute(
            &format!("DELETE FROM {}", quote(name)),
            [],
        )
        .map_err(error)?;

        tx.execute(
            "DELETE FROM sqlite_sequence WHERE name = ?1",
            [name],
        )
        .map_err(error)?;
    }

    for name in &order {
        let table = &data.tables[name];

        let columns: Vec<_> = table
            .columns
            .iter()
            .map(|column| quote(&column.name))
            .collect();

        let placeholders =
            vec!["?"; columns.len()].join(",");

        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            quote(name),
            columns.join(","),
            placeholders
        );

        let mut statement = tx.prepare(&sql).map_err(error)?;

        for row in &table.rows {
            let values = table
                .columns
                .iter()
                .map(|column| to_sql(&row[&column.name]))
                .collect::<DbResult<Vec<_>>>()?;

            statement
                .execute(params_from_iter(values))
                .map_err(|e| {
                    format!("{} import failed: {}", name, e)
                })?;
        }

        if let Some(sequence) = data.sequences.get(name) {
            tx.execute(
                "UPDATE sqlite_sequence
                 SET seq = MAX(seq, ?1)
                 WHERE name = ?2",
                params![sequence, name],
            )
            .map_err(error)?;

            tx.execute(
                "INSERT INTO sqlite_sequence(name, seq)
                 SELECT ?1, ?2
                 WHERE NOT EXISTS(
                    SELECT 1 FROM sqlite_sequence WHERE name = ?1
                 )",
                params![name, sequence],
            )
            .map_err(error)?;
        }
    }

    if !select(&tx, "PRAGMA foreign_key_check", &[])?
        .is_empty()
    {
        return Err(
            "The backup contains broken database relationships."
                .into(),
        );
    }

    set_meta(&tx, "source_id", &data.source_id)?;

    set_meta(
        &tx,
        "origins",
        &serde_json::to_string(&data.origins).map_err(error)?,
    )?;

    if !consolidate_legacy {
        set_meta(&tx, "crop_defaults_seeded", "1")?;
    }

    set_meta(
        &tx,
        "revision",
        &next_revision.to_string(),
    )?;

    if consolidate_legacy {
        set_meta(&tx, "legacy_consolidated", "1")?;
    }

    set_meta(&tx, "transferring", "0")?;

    // Any error before this point drops and rolls back the transaction.
    tx.commit().map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pre_v6_db() -> Connection {
        let mut conn =
            Connection::open_in_memory().unwrap();

        conn.execute_batch(include_str!(
            "../migrations/V1__create_telemetry_table.sql"
        ))
        .unwrap();

        conn.execute_batch(include_str!(
            "../migrations/V2__add_npk_columns.sql"
        ))
        .unwrap();

        conn.execute_batch(include_str!(
            "../migrations/V4__add_mission_and_audit_timestamps.sql"
        ))
        .unwrap();

        conn.execute_batch(include_str!(
            "../migrations/V5__create_additional_tables.sql"
        ))
        .unwrap();

        ensure_schema(&mut conn).unwrap();

        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .unwrap();

        conn
    }

    fn db() -> Connection {
        let mut conn = pre_v6_db();

        conn.execute_batch(include_str!(
            "../migrations/V6__rebuild_telemetry_schema.sql"
        ))
        .unwrap();

        ensure_schema(&mut conn).unwrap();

        conn
    }

    #[test]
    fn legacy_row_projection_keeps_supported_values_and_reports_extra_columns() {
        let row = serde_json::from_value(serde_json::json!({
            "id": 7,
            "timestamp": "2026-10-01T08:00:00",
            "legacy_note": "kept in original database"
        }))
        .unwrap();

        let columns = vec![
            Column {
                name: "id".into(),
                data_type: "INTEGER".into(),
                required: false,
                primary_key: true,
            },
            Column {
                name: "timestamp".into(),
                data_type: "TEXT".into(),
                required: false,
                primary_key: false,
            },
            Column {
                name: "plot".into(),
                data_type: "TEXT".into(),
                required: false,
                primary_key: false,
            },
        ];

        let (projected, ignored) = project_legacy_row(row, &columns);

        assert_eq!(projected["id"], 7);
        assert_eq!(projected["timestamp"], "2026-10-01T08:00:00");
        assert_eq!(projected["plot"], Value::Null);
        assert_eq!(ignored, vec!["legacy_note"]);
    }

    #[test]
    fn v6_migration_preserves_plot_and_overall_values() {
        let mut conn = pre_v6_db();

        conn.execute(
            "INSERT INTO telemetry(plot, overall, ph)
             VALUES('Legacy plot', 72.5, 6.4)",
            [],
        )
        .unwrap();

        conn.execute_batch(include_str!(
            "../migrations/V6__rebuild_telemetry_schema.sql"
        ))
        .unwrap();

        ensure_schema(&mut conn).unwrap();

        let values: (String, f64) = conn
            .query_row(
                "SELECT plot, overall FROM telemetry",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(values, ("Legacy plot".into(), 72.5));
    }

    fn seed(conn: &Connection, label: &str) {
        conn.execute(
            "INSERT INTO crops(name) VALUES(?1)",
            [label],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO fields(name) VALUES(?1)",
            [label],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO missions(field_id,name)
             VALUES(1,?1)",
            [label],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO telemetry(mission_id,timestamp,ph)
             VALUES(1,'12:34:56',6.5)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO crop_profiles(id,name,category)
             VALUES('CRP-001',?1,'Cereal')",
            [label],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO field_amendments(field_id,date,treatment)
             VALUES(1,'2026-10-01','Lime')",
            [],
        )
        .unwrap();
    }

    fn data(conn: &Connection) -> Value {
        serde_json::to_value(
            snapshot(conn).unwrap().tables
        )
        .unwrap()
    }

    #[test]
    fn legacy_additional_columns_are_preserved_during_consolidation() {
        let source = db();

        source
            .execute_batch(
                "ALTER TABLE telemetry
                     ADD COLUMN legacy_note;
                 INSERT INTO telemetry(
                     timestamp,
                     legacy_note
                 )
                 VALUES('12:40:00', 'kept from legacy');",
            )
            .unwrap();

        let mut destination = db();

        preserve_additional_columns(
            &mut destination,
            &source,
        )
        .unwrap();

        ensure_schema(&mut destination).unwrap();

        let package = snapshot(&source).unwrap();

        restore(
            &mut destination,
            &package,
            None,
            true,
        )
        .unwrap();

        let row = select(
            &destination,
            "SELECT legacy_note FROM telemetry",
            &[],
        )
        .unwrap()
        .remove(0);

        assert_eq!(
            row["legacy_note"],
            "kept from legacy"
        );

        let previous_revision =
            revision(&destination).unwrap();

        destination
            .execute(
                "UPDATE telemetry
                 SET legacy_note='updated'
                 WHERE timestamp='12:40:00'",
                [],
            )
            .unwrap();

        assert_eq!(
            revision(&destination).unwrap(),
            previous_revision + 1
        );
    }

    #[test]
    fn replaces_every_table_and_preserves_audits_and_measurement_time() {
        let source = db();
        seed(&source, "Imported");

        source
            .execute(
                "UPDATE telemetry
                 SET created_at='2020-01-02 03:04:05',
                     updated_at=NULL",
                [],
            )
            .unwrap();

        let package = snapshot(&source).unwrap();

        let mut destination = db();
        seed(&destination, "Old record");

        destination
            .execute(
                "INSERT INTO fields(name)
                 VALUES('Must disappear')",
                [],
            )
            .unwrap();

        restore(
            &mut destination,
            &package,
            None,
            false,
        )
        .unwrap();

        assert_eq!(
            data(&source),
            data(&destination)
        );

        let row = select(
            &destination,
            "SELECT * FROM telemetry",
            &[],
        )
        .unwrap()
        .remove(0);

        assert_eq!(row["timestamp"], "12:34:56");

        assert_eq!(
            row["created_at"],
            "2020-01-02 03:04:05"
        );

        assert_eq!(row["updated_at"], Value::Null);

        assert_eq!(
            meta(&destination, "transferring")
                .unwrap()
                .as_deref(),
            Some("0")
        );
    }

    #[test]
    fn constraint_failure_rolls_back_all_tables_and_metadata() {
        let source = db();
        seed(&source, "Imported");

        let mut package = snapshot(&source).unwrap();
        let mut duplicate =
            package.tables["crops"].rows[0].clone();

        // Different primary key but a conflicting UNIQUE name.
        duplicate.insert("id".into(), json!(2));

        package
            .tables
            .get_mut("crops")
            .unwrap()
            .rows
            .push(duplicate);

        let mut destination = db();
        seed(&destination, "Keep me");

        let before = data(&destination);
        let rev = revision(&destination).unwrap();

        assert!(
            restore(
                &mut destination,
                &package,
                None,
                false
            )
            .is_err()
        );

        assert_eq!(data(&destination), before);

        assert_eq!(
            revision(&destination).unwrap(),
            rev
        );

        assert_eq!(
            meta(&destination, "transferring")
                .unwrap()
                .as_deref(),
            Some("0")
        );
    }

    #[test]
    fn invalid_schema_or_missing_reference_never_deletes_current_data() {
        let source = db();
        seed(&source, "Imported");

        let mut package = snapshot(&source).unwrap();

        let mut destination = db();
        seed(&destination, "Keep me");

        let before = data(&destination);

        package
            .tables
            .get_mut("missions")
            .unwrap()
            .rows[0]
            .insert("field_id".into(), json!(999));

        assert!(
            restore(
                &mut destination,
                &package,
                None,
                false
            )
            .is_err()
        );

        assert_eq!(data(&destination), before);

        package.tables.remove("fields");

        assert!(
            restore(
                &mut destination,
                &package,
                None,
                false
            )
            .is_err()
        );

        assert_eq!(data(&destination), before);
    }

    #[test]
    fn concurrent_write_invalidates_merge_plan() {
        let mut destination = db();
        seed(&destination, "Keep me");

        let package = snapshot(&destination).unwrap();

        destination
            .execute(
                "INSERT INTO telemetry(timestamp,ph)
                 VALUES('12:35:00',7)",
                [],
            )
            .unwrap();

        assert_eq!(
            restore(
                &mut destination,
                &package,
                Some(package.revision),
                false
            )
            .unwrap_err(),
            "DATABASE_CHANGED"
        );

        assert_eq!(
            snapshot(&destination)
                .unwrap()
                .tables["telemetry"]
                .rows
                .len(),
            2
        );
    }

    #[test]
    fn empty_backup_replaces_all_rows_and_retains_sequence() {
        let source = db();

        source
            .execute(
                "INSERT INTO telemetry(id) VALUES(100)",
                [],
            )
            .unwrap();

        source
            .execute("DELETE FROM telemetry", [])
            .unwrap();

        let package = snapshot(&source).unwrap();

        let mut destination = db();
        seed(&destination, "Old");

        restore(
            &mut destination,
            &package,
            None,
            false,
        )
        .unwrap();

        assert!(
            snapshot(&destination)
                .unwrap()
                .tables
                .values()
                .all(|table| table.rows.is_empty())
        );

        destination
            .execute(
                "INSERT INTO telemetry(ph) VALUES(6)",
                [],
            )
            .unwrap();

        assert_eq!(
            destination.last_insert_rowid(),
            101
        );

        assert_eq!(
            meta(&destination, "crop_defaults_seeded")
                .unwrap()
                .as_deref(),
            Some("1")
        );
    }

    #[test]
    fn edit_retains_creation_time_and_assigns_utc8_modification() {
        let conn = db();
        seed(&conn, "North");

        conn.execute(
            "UPDATE fields
             SET created_at='original creation',
                 updated_at='old edit'",
            [],
        )
        .unwrap();

        conn.execute(
            "UPDATE fields
             SET name='South',
                 created_at='do not keep'
             WHERE id=1",
            [],
        )
        .unwrap();

        let row = select(
            &conn,
            "SELECT created_at,updated_at FROM fields",
            &[],
        )
        .unwrap()
        .remove(0);

        assert_eq!(
            row["created_at"],
            "original creation"
        );

        assert!(
            row["updated_at"]
                .as_str()
                .unwrap()
                .ends_with("+08:00")
        );
    }
}