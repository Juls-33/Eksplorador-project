# Eksplorador obstacle notification — Node.js installer

This replaces the previous Python installer. **Node.js only, no `pip` or `npm install` required for patching.** It applies the same Rover ESP32 → LoRa → Tauri → React popup integration. **It does not modify the Arduino Mega or desktop RX_BOARD firmware.**

## November 19 hotfix — rover TX loop anchor

The first Node installer expected this exact source formatting:

```cpp
serviceTx();

if (!awaitingAck)
```

Your updated rover sketch does not use that exact whitespace, so `--dry-run` stopped safely at
`Rover ESP32: TX loop priority`. The corrected installer now inserts its alert
check directly before the standalone `serviceTx();` statement inside `loop()`.
It rejects unsupported inline statements instead of risking an unsafe edit.

**If you already copied the earlier `Eksplorador_Obstacle_Alert_NodeJS` folder into
your project, replace that entire folder with the version in this ZIP**, or replace
its `apply_obstacle_alert.js` with the corrected script.

Use the exact rover target found by your previous dry run:

```powershell
node .\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js . --dry-run --rover "embedded\1 V3 semi auto firmware test (updated)\rover\Rover_A2_7\Rover_A2_7.ino"
```

If that preview succeeds, remove `--dry-run` to apply the patch. Nothing gets
written during a dry run. No Mega firmware is edited.

## Recommended PowerShell commands

1. Unzip the package anywhere convenient.
2. Open PowerShell and navigate to your Eksplorador project root:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
```

3. Run a safe preview (edit the quoted installer path to where you unzipped it):

```powershell
node "C:\path\to\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js" . --dry-run
```

4. If the preview identifies the intended **rover** ESP32 sketch, apply the changes:

```powershell
node "C:\path\to\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js" .
```

**Easy option:** Copy the whole `Eksplorador_Obstacle_Alert_NodeJS` folder into your project root first. From that root, use:

```powershell
node .\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js . --dry-run
node .\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js .
```

If more than one rover ESP32 sketch matches (e.g., old firmware archives), the installer **stops and lists choices**. Choose the source you're actually using; for example:

```powershell
node .\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js . --rover "embedded\your-rover-folder\rover.ino" --dry-run
node .\Eksplorador_Obstacle_Alert_NodeJS\apply_obstacle_alert.js . --rover "embedded\your-rover-folder\rover.ino"
```

Do not use the Mega or the RX_BOARD receiver as the rover source.

## Install safeguards

- Verifies all expected anchors and checks existing generated files **before writing**.
- Creates one-time `*.before-obstacle-alert.bak` backups of modified files.
- Safe to run again: reports `Already installed` without changing files.
- `--dry-run` shows intended changes with zero writes.
- No modification to your Mega's motor, encoder, ultrasonic, RC, or timed mission control.

## Node regression tests (no hardware)

```powershell
node --test .\Eksplorador_Obstacle_Alert_NodeJS\tests\test_node_installer.js
```

Six tests cover dry-run, applying changes, rerun/idempotence, backups, source mismatch, ambiguous rover firmware selection, preservation of Mega/receiver, and refusal to overwrite custom files.

## After installation

```powershell
cd apps\desktop
npm run build
npm run tauri dev
```

To test the UI **without powering the rover**, open the Tauri application's DevTools console (development mode) and paste:

```javascript
window.dispatchEvent(new Event('eksplorador-obstacle-demo'))
```

This renders a DEMO popup only; it does not prove real LoRa delivery.

Optional Rust-specific tests (from `apps/desktop/src-tauri`):

```powershell
cargo test obstacle_alert --lib
cargo check
```

The **rover ESP32** firmware will need to be verified and flashed with the correct ESP32 board and libraries when you're ready. Do **not** reflash the Mega or desktop RX_BOARD. The four repeated `ALRT1:<id>:<remaining_ms>` packets are unacknowledged, so an alert may be lost during radio failure. Motor stopping is controlled exclusively by the unchanged Mega regardless of popup delivery.

## How it works

- Mega's existing confirmed sonar pause reports `MISSION_STATUS:A31_PAUSED:SONAR:<remaining_ms>` over Serial2.
- Rover ESP32 sees that exact prefix and queues a bounded repeated LoRa `ALRT1:<id>:<remaining_ms>` notification when CH8 enables LoRa TX.
- Existing desktop receiver prints `[RAW RX]: ALRT1:<id>:<remaining_ms>` to USB serial.
- Tauri recognizes that frame and emits `rover-obstacle`.
- React shows a once-per-ID modal directing the operator to use manual RC control and send a newly planned mission from the rover's new position.

**Safety**: This is a supervised bench-only alert feature. The existing bench sonar code may treat missing echoes as clear, and the 10 cm obstacle threshold has not been field-validated. Do not use for ground-contacting autonomous operation without additional hardware validation. Recharge/check the depleted 4S battery before further powered tests.
