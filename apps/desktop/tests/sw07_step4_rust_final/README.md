# SW-07 Step 4: actual Rust migrations + file persistence

Run from **D:\UST Capstone\Eksplorador-project**:

```powershell
node .\apps\desktop\tests\sw07_step4_rust_final\install_sw07_step4_test.mjs .
cd .\apps\desktop\src-tauri
cargo test --lib sw07_fresh_migrations_and_finalized_sample_survive_sqlite_reopen -- --nocapture
cargo test --lib
```

The installer appends ONE test module to `database.rs` after saving its original contents in `database.rs.before_sw07_step4.bak`. Existing source logic is unchanged. The test calls the same migration SQL order as `lib.rs`, the patched V6 hook, and the actual `ensure_schema()`. It uses a uniquely named file under the Windows temp folder. It closes that file and reopens it before checking persisted field/mission/sample data, JSON, NPK, coordinates, session ID, and `PRAGMA` integrity/foreign key checks. It removes the temp file automatically. 

**Scope:** Real Rust migration + SQLite durability; **not** a native Tauri process restart, and no real telemetry/LoRa hardware. If the test fails, copy the full output for diagnosis before making another change. The original Step 4 Node-only migration test is obsolete for the new Rust hook.
