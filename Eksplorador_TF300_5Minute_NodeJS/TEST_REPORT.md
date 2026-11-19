# TF300 five-minute upgrade — test report

## Relevant inspected source

- Provided latest `Eksplorador_Mega_Sonar_Transient_Guard_BENCH.ino`, built atop the encoder-sign-corrected Mega firmware, with `A31_MAX_STEP_MS = 60000` and `A31_MAX_LEG_MS = 120000`.
- Provided `Eksplorador_Desktop_TF60_4File_Update.zip`: 60-second bounds in `pointToPointMission.js`, `PointToPointMissionDialog.jsx`, `MissionDeploymentWizard.jsx`, and Rust `mission_protocol.rs`.
- GPS fallback installer design: updated helper and dialogue remain compatible with the 300-second patch because GPS source validation is not edited.

## Host-side regression

Run: `node --test tests/regression.cjs`.

**16 / 16 PASS** using Node.js 22.16.0, covering source-only Mega constant edit, exact 300-second acceptance, over-300-second rejection, GPS checks and endpoint validation, server-side Rust contract update, deployment UI instructions, explicit extended-leg warning, dry-run no-op, five-file installation, idempotence, incompatible source preflight, and ambiguous Mega selection handling.

**Not yet tested:** full Rust compilation (no toolchain installed), full Vite build against user's local project, Arduino Mega AVR compilation (Arduino toolchain not installed), ESP32 current-flashed revision matching, or physical five-minute mission/safety response.

**Safety note:** The `BENCH` firmware's `BENCH_NO_ECHO_IS_CLEAR` setting is not suitable for autonomous ground travel, especially as the permitted mission duration increases. Real field travel requires verified strict ultrasonic handling and sensible obstacle stopping distances, independently of this limit update.
