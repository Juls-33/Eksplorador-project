# Eksplorador — Point A → Point B GPS Consistency Fix

**Scope:** Desktop application only. No changes to the Arduino Mega, rover ESP32, desktop LoRa receiver, battery, soil sensor collection, Tauri/Rust backend, or SQLite database.

## Why Point A said “no GPS fix” while Field Map showed GPS

The project code routes `sensor-data` (GPS latitude, longitude, positive `satsLocked`) into Field Map's `roverPos` state, but the Point A planner receives only `receiverStatus.planning_gps.current`, which represents the separate FUS navigation channel. `freshFusionStart()` previously *rejected all non-FUS GPS sources*. Thus a healthy GPS on Live Monitoring and Field Map could still appear unavailable in Point A if FUS was missing, invalid, or stale.

This fix **prefers fresh validated FUS when available**. Otherwise it passes the same valid, recent, positive-satellite-count DATA GPS telemetry already used by Field Map. Its UI source label explicitly says **“Live rover GPS telemetry (not fused)”**. A fallback is not claimed to be differential/RTK/precision GPS.

The fix does not silently reuse stale coordinates, zero latitude/longitude, missing satellites, or disconnected receiver state. Map-selected Point A continues to be labelled MANUAL.

## Installation — use Node.js, not Python

Copy the **whole `Eksplorador_GPS_Mission_Fix_NodeJS` directory** into the project root:

`D:\UST Capstone\Eksplorador-project\Eksplorador_GPS_Mission_Fix_NodeJS\`

From PowerShell:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
node .\Eksplorador_GPS_Mission_Fix_NodeJS\apply_gps_mission_fix.js . --dry-run
```

Expected: `WOULD PATCH` for exactly 3 files, then `Dry run complete; no files changed.`

```powershell
node .\Eksplorador_GPS_Mission_Fix_NodeJS\apply_gps_mission_fix.js .
```

Expected: `PATCH` for exactly 3 files. Backups are written into a timestamped `backups` subdirectory before changes. The installer validates all anchors before writing; a mismatch aborts without applying a partial patch.

Then run:

```powershell
cd apps\desktop
npm run build
npm run tauri dev
```

You can run the pure Node tests without the rover or npm installation:

```powershell
node .\Eksplorador_GPS_Mission_Fix_NodeJS\tests\regression.cjs
```

The installer is idempotent. Re-running it after success prints `ALREADY PATCHED` and does not repeat modifications.

## Modified files

- `apps/desktop/src/views/FieldMapView.jsx` — use a valid satellite-confirmed DATA GPS fix as fallback to the FUS planning fix, drawing on the existing `sensor-data` listener. Clear fallback on invalid sensor data and receiver disconnect.
- `apps/desktop/src/utils/pointToPointMission.js` — let the existing `freshFusionStart` validator accept explicitly tagged DATA telemetry with satellite-count and age checks, prefer valid FUS, check GPS provenance on submit. **Existing TF/60 s logic unchanged**.
- `apps/desktop/src/components/PointToPointMissionDialog.jsx` — distinguish FUS fixes from live sensor telemetry in the UI and show useful failure reasons.

## Real-field verification

When the battery and GPS are available:

1. Confirm positive `satsLocked` and valid changing GPS coordinates on Live Monitoring.
2. Open Field Map. The rover pin should reflect those same coordinates.
3. Open Point A → Point B. Point A should now offer **Use live GPS** even if FUS is unavailable, with source **Live rover GPS telemetry (not fused)**. If FUS works, it should be preferred and labelled FUS.
4. Check Point A coordinates against the live map. They should agree within the sampling interval and observed GPS drift.
5. Disconnect the desktop receiver or wait over 5 seconds without a new GPS packet; the planner should disable live GPS and offer map-selected Point A instead. It must NOT silently reuse stale data.
6. Verify that choosing Point A on the map still works and is tagged as operator-entered, not GPS.
7. Only plan / transmit timed movement when the rover is safely supervised; map estimates do not control steering or prove arrival.

**Note:** The frontend regression tests were run against known current mission-planning components and the relevant FieldMapView source excerpt. A full build against your local project and hardware was not executed here. Always use `--dry-run` first.
