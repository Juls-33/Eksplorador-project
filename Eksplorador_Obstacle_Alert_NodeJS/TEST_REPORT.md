# Node.js installer hotfix — regression report

- Environment: Node.js, built-in `node:test`, no third-party dependencies
- `node --check apply_obstacle_alert.js` — PASS
- `node --test tests/test_node_installer.js` — **6/6 PASS**
- Root cause: TX loop anchor included an exact sequence of blank lines after `serviceTx();` absent in the selected rover source.
- Fixed: Find a single, standalone `serviceTx();` call in `void loop()` regardless of trailing blank-line count, inject alert priority just before it.
- Tests: non-writing dry run; install and idempotence/backups; preflight failure without modifications; multiple rover candidates; custom component conflict; three TX-loop formatting variants; actual TX-loop integration; preserved Mega and RX board contents.
- The hotfix changes only the Node installer and its tests/documentation, not firmware alert payloads or motor control.
- Not run: compile against user's exact ESP32 toolchain, native Tauri build, physical LoRa end-to-end test. Run those locally before declaring production success.
