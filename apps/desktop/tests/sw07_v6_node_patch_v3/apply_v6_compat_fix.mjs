// SW07 V6 source-only patch, v3: actual lib registration + 2 direct-SQL tests.
// Runs with Node 24+, only touches three tracked SOURCE files; never opens a .db.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const base = path.join(root, 'apps', 'desktop', 'src-tauri');
const paths = {
  lib: path.join(base, 'src', 'lib.rs'),
  db: path.join(base, 'src', 'database.rs'),
  v6: path.join(base, 'migrations', 'V6__rebuild_telemetry_schema.sql'),
};
const original = Object.fromEntries(Object.entries(paths).map(([k, p]) => {
  assert.ok(fs.existsSync(p), `Required source missing: ${p}`);
  return [k, fs.readFileSync(p, 'utf8')];
}));
assert.ok(!original.db.includes('pub(crate) fn v6_compat_migration()'), 'Compatibility helper already exists; no edits made');
assert.ok(original.v6.includes('CREATE TABLE IF NOT EXISTS telemetry_rebuilt'), 'Unexpected V6 SQL; no edits made');
assert.ok(original.v6.includes('-- Copy existing data safely into the new table'), 'Unexpected V6 SQL marker; no edits made');
const from = original.v6.indexOf('-- Create target telemetry table');
const to = original.v6.indexOf('-- Copy existing data safely into the new table');
assert.ok(from >= 0 && to > from, 'Unexpected V6 SQL order; no edits made');
const nextV6 = `-- V6: create telemetry replacement table. The Rust V6 hook performs a\n-- schema-aware row copy and table swap in the same migration transaction.\n-- V3 legacy seed script remains intentionally disabled.\n${original.v6.slice(from,to).trim()}\n`;

// Find and replace exactly one M::up(include_str!("...V6...")) call.
// Do not search for registrations in database.rs: its two V6 references are tests.
function replaceLibMigration(source) {
  const regex = /\bM::up\s*\(\s*include_str!\s*\(\s*"\.\.\/migrations\/V6__rebuild_telemetry_schema\.sql"\s*\)\s*\)/g;
  const hits = [...source.matchAll(regex)];
  assert.equal(hits.length, 1, `Expected one V6 M::up registration in lib.rs, found ${hits.length}; no edits made`);
  return source.replace(regex, 'database::v6_compat_migration()');
}
const nextLib = replaceLibMigration(original.lib);

// Replace only direct SQL execution blocks within database.rs tests.
// These previous tests executed the V6 file manually; after adding the
// Rust hook, they must invoke a migration runner to perform the copy/swap.
function replaceTestCalls(source) {
  const regex = /conn\s*\.\s*execute_batch\s*\(\s*include_str!\s*\(\s*"\.\.\/migrations\/V6__rebuild_telemetry_schema\.sql"\s*\)\s*\)\s*\.\s*unwrap\s*\(\s*\)\s*;/g;
  const hits = [...source.matchAll(regex)];
  assert.equal(hits.length, 2, `Expected two direct V6 SQL test calls in database.rs, found ${hits.length}; no edits made`);
  return source.replace(regex, 'run_v6_compat_in_test(&mut conn);');
}
const nextDbTests = replaceTestCalls(original.db);

const helper = `
// V6 compatibility migration. It is used by normal initialization and by
// the old V6 regression tests, which now run the same Rust migration hook.
pub(crate) fn v6_compat_migration() -> rusqlite_migration::M<'static> {
    rusqlite_migration::M::up_with_hook(
        include_str!("../migrations/V6__rebuild_telemetry_schema.sql"),
        |tx: &rusqlite::Transaction<'_>| {
            let columns = {
                let mut stmt = tx.prepare("PRAGMA table_info(telemetry)")?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
                rows.collect::<rusqlite::Result<Vec<String>>>()?
            };
            let has_column = |name: &str| columns.iter().any(|column| column == name);
            let plot = if has_column("plot") { "plot" } else { "NULL" };
            let overall = if has_column("overall") { "overall" } else { "NULL" };

            // Every other source column exists after V1/V2/V4 migrations.
            // Keep original IDs, measurement values, GPS and mission links.
            let copy_sql = format!(
                r#"INSERT INTO telemetry_rebuilt (
                       id, timestamp, latitude, longitude, ph, moisture, ec,
                       nitrogen, phosphorus, potassium, mission_id, created_at,
                       updated_at, plot, overall
                   )
                   SELECT id, timestamp, latitude, longitude, ph, moisture, ec,
                          nitrogen, phosphorus, potassium, mission_id,
                          created_at, updated_at, {plot}, {overall}
                   FROM telemetry;
                   DROP TABLE telemetry;
                   ALTER TABLE telemetry_rebuilt RENAME TO telemetry;"#
            );
            tx.execute_batch(&copy_sql)?;
            Ok(())
        },
    )
}

#[cfg(test)]
fn run_v6_compat_in_test(conn: &mut rusqlite::Connection) {
    // Tests formerly called execute_batch(V6.sql), bypassing migration hooks.
    // Use the actual V6 migration here so the tests exercise copy + swap.
    rusqlite_migration::Migrations::new(vec![v6_compat_migration()])
        .to_latest(conn)
        .expect("V6 compatibility migration failed in test database");
}
`;
const nextDb = `${nextDbTests.trimEnd()}\n${helper}`;
const changes = { lib: nextLib, db: nextDb, v6: nextV6 };
// Do all source-structure checking before any writes.
console.log('All source markers validated: 1 production registration, 2 test calls.');
console.log('No databases are opened by this script.');
const backupRoot = path.join(root, 'apps', 'desktop', 'tests');
const backupDir = fs.mkdtempSync(path.join(backupRoot, 'sw07_v6_source_backup_'));
for (const [key, p] of Object.entries(paths)) {
  const backup = path.join(backupDir, path.relative(base, p));
  fs.mkdirSync(path.dirname(backup), {recursive:true});
  fs.writeFileSync(backup, original[key], 'utf8');
}
for (const [key, p] of Object.entries(paths)) fs.writeFileSync(p, changes[key], 'utf8');
console.log('PASS: Source-only V6 patch written.');
console.log('Backups:', backupDir);
console.log('Next: cargo fmt --check, cargo check, cargo test --lib. Do not start native Tauri until isolated migration tests pass.');
