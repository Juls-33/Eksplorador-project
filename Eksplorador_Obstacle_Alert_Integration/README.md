# Eksplorador: Obstacle → Desktop Popup → Manual Intervention

**Keep the working Arduino Mega sketch unchanged.** The 28-second commanded / ~30-second observed motion and brief hiccups are not changed by this package. Do not attempt further rover motor tests on a nearly depleted battery.

## What changes

| Layer | Change | Flash needed? |
|---|---|---|
| Arduino Mega | **None**; uses existing `MISSION_STATUS:A31_PAUSED:SONAR:<remaining_ms>` | **NO** |
| Rover ESP32 | Sends 4 bounded-priority `ALRT1:<id>:<remaining_ms>` LoRa packets when Mega reports confirmed sonar pause | **YES**, when charged |
| Desktop RX_BOARD ESP32 | **None**: current firmware already prints arbitrary LoRa payloads as `[RAW RX]: ...` | **NO** |
| Tauri Rust | Parses `[RAW RX]: ALRT1:...` and emits `rover-obstacle` event | Rebuild desktop app |
| React | Displays one deduplicated persistent popup with operator steps | Rebuild desktop app |

**Delivery limitation:** Current RX_BOARD sends no alert-specific acknowledgment. The Rover ESP32 therefore transmits four same-ID copies (~300 ms apart), and the desktop deduplicates them. They can all be lost; this is *notification*, not safety-critical movement control. The Mega remains the sole stopping authority and must remain stopped on its own. A delivery-ACK protocol would require a receiver firmware change and additional testing; this version deliberately avoids that risk and extra flash.

## Installation

Extract this ZIP. Open PowerShell, then:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
python "C:\path\to\Eksplorador_Obstacle_Alert_Integration\apply_obstacle_alert.py" . --dry-run
python "C:\path\to\Eksplorador_Obstacle_Alert_Integration\apply_obstacle_alert.py" .
```

Replace `C:\path\to\...` with where you extracted this package. The patcher searches `embedded/` for the rover ESP32 source using specific function signatures, so the directory name is not hardcoded. It verifies all patch anchors first; on a mismatch it stops without modifying the project. Existing modified files are backed up as `*.before-obstacle-alert.bak`. Re-running the script is idempotent.

If your `embedded/` folder contains archived firmware copies and the script reports **multiple candidates**, explicitly select the **currently flashed rover ESP32 source**, for example:

```powershell
python "C:\path\to\Eksplorador_Obstacle_Alert_Integration\apply_obstacle_alert.py" . --rover "embedded\YOUR_CURRENT_ROVER_FOLDER\your_rover_sketch.ino" --dry-run
python "C:\path\to\Eksplorador_Obstacle_Alert_Integration\apply_obstacle_alert.py" . --rover "embedded\YOUR_CURRENT_ROVER_FOLDER\your_rover_sketch.ino"
```

Do not select the Mega or desktop receiver. The script checks function markers and refuses mismatched files.

This is designed for the rover ESP32 version that contains `void processMegaLine(const char *s)`, `void serviceTx()`, and `void serviceMissionForward()` (the previously shared Nov 2026 source). If the latest code differs, the script may refuse to apply; **don't force it or overwrite another board's `.ino`.**

From `apps/desktop/`:

```powershell
npm run build
npm run tauri dev
```

From `apps/desktop/src-tauri/`:

```powershell
cargo test obstacle_alert --lib
cargo check
```

These commands are for *your* local environment. This package cannot substitute for verifying the rover ESP32 in Arduino IDE with the real `../../shared/MissionProtocol.h`, LoRa library, and the correct board target. When you have recharged, Verify and flash the **rover ESP32 only**. Do **not** flash the Mega or desktop RX_BOARD.

## Test popup with no rover or battery

1. Run `npm run tauri dev` and open DevTools for the desktop application.
2. In the DevTools console, enter:

```js
window.dispatchEvent(new Event('eksplorador-obstacle-demo'))
```

A **DEMO** obstacle popup should appear with sample remaining time; dismiss it with *Acknowledge notification*. This tests React presentation, **not** radio reception or the Mega safety stop.

The Tauri parser has a Rust unit test using `[RAW RX]: ALRT1:4294967295:31898`. It can be run without rover hardware. This tests the parser, not actual serial delivery.

## Radio end-to-end test (later, after charging)

1. Start desktop receiver in RX, rover CH8=TX, Mega with working sketch.
2. Send and start a short fresh timed mission following the existing assistant.
3. Produce a *confirmed* sonar obstruction. The Mega should stop and remain stopped independently of radio reception.
4. Rover ESP32 Serial Monitor should show `[OBSTACLE ALERT QUEUED] ALRT1:...` and `[OBSTACLE ALERT TX]` attempts.
5. Desktop RX_BOARD USB should show `[RAW RX]: ALRT1:<id>:<remaining_ms>`.
6. Desktop modal appears **once**, even if repeated frames arrive.
7. Manually select CH6 MANUAL to abandon the timed mission, drive around, then disarm, replan from the new position, upload a **new** command. The popup does not itself restart or cancel any motor commands.

No radio packet can guarantee delivery without a confirmed end-to-end acknowledgment. If no popup appears during a confirmed Mega sonar stop, use USB logs to isolate the failed link.

## Safety / future work

This is **not** autonomous avoidance. The existing bench sonar firmware can treat missing echoes as clear; 10 cm has not been established as a safe ground stopping distance. Do not use this bench build for autonomous ground travel. A near-empty 4S LiPo should be recharged safely and checked before further powered testing. No new autonomous moves are triggered anywhere in this package.
