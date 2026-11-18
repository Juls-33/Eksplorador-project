// Node 24+. Appends SW-07 Rust test module to database.rs ONLY.
// No SQLite connections, no hardware calls, no production DB references.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? '.');
const src = path.join(root, 'apps', 'desktop', 'src-tauri', 'src', 'database.rs');
const here = path.dirname(fileURLToPath(import.meta.url));
const addition = fs.readFileSync(path.join(here, 'sw07_step4_test.rs.txt'), 'utf8');
assert.ok(fs.existsSync(src), `Missing Rust source: ${src}`);
const original = fs.readFileSync(src, 'utf8');
assert.ok(original.includes('pub(crate) fn v6_compat_migration()'), 'V6 hook missing; first verify earlier patch');
assert.ok(original.includes('pub fn ensure_schema('), 'Rust ensure_schema missing');
assert.ok(!original.includes('mod sw07_actual_migration_persistence_tests'), 'Step 4 test already installed; no changes made');
assert.ok(addition.includes('mod sw07_actual_migration_persistence_tests'), 'Test module is incomplete');
const backup = path.join(here, 'database.rs.before_sw07_step4.bak');
assert.ok(!fs.existsSync(backup), `Backup already exists: ${backup}; no changes made`);
fs.writeFileSync(backup, original, { flag: 'wx' });
fs.writeFileSync(src, `${original.trimEnd()}\n\n${addition}`, 'utf8');
console.log('PASS: Appended isolated SQLite regression test to database.rs');
console.log('Backup:', backup);
console.log('No databases opened or edited by installer.');
console.log('Run: cd apps/desktop/src-tauri; cargo test --lib sw07_fresh_migrations_and_finalized_sample_survive_sqlite_reopen -- --nocapture');
