# SW-07 V6 compatibility patch (Node.js v3)

This revision fixes earlier installers' false assumption that `database.rs` contains two `M::up` registrations. In the actual project these are two **unit-test** direct SQL calls. The script patches the one `M::up` registration in `lib.rs`, adjusts those two tests, and replaces V6 SQL copy with a schema-aware Rust `up_with_hook`.

## How to run

Extract folder `sw07_v6_node_patch_v3` under `apps/desktop/tests/` in the **main** project.

From `D:\UST Capstone\Eksplorador-project`:

```powershell
node .\apps\desktop\tests\sw07_v6_node_patch_v3\apply_v6_compat_fix.mjs .
cd .\apps\desktop\src-tauri
cargo fmt --check
cargo check
cargo test --lib
```

If formatting differs, `cargo fmt` can be used (it may format other Rust files; review `git diff`). No production database is opened by the installer. Source backups go in `apps/desktop/tests/sw07_v6_source_backup_*`.

**Important limitations:** The patch is based on code snippets shared in chat, and has not been compiled against the actual Windows project. The unit tests or Rust API may need follow-up adjustments. Never start the native application to test migration behavior until disposable database tests pass. Migration metadata on databases already at version V6 is not changed by this hook; it runs only when applying V6 anew.
