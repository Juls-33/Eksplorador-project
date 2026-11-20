# Eksplorador — Live Monitoring GPS Marker Continuity (desktop-only)

## What was fixed

The **Live Monitoring** panel (in `apps/desktop/src/App.jsx`) was still doing this:

```jsx
roverPos={!selectedHistoricalPos && hasGpsFix ? [liveData.lat, liveData.lng] : null}
```

Each DATA packet with `satsLocked = 0` made `hasGpsFix` false, so **the rover marker disappeared immediately**, even when other telemetry continued arriving. The *previous* 30-second display-continuity ZIP patched the **Field Map** but did **not** update this Live Monitoring marker.

The updated Live Monitoring panel now reuses the previously installed `useRoverDisplayPosition` hook and `HeatmapMap` appearance status:

- **Live GPS fix:** solid GPS rover marker, the existing GPS Fix status and telemetry remain unchanged.
- **Temporary loss (<30 s):** last known GPS position stays on the map, semi-transparent, with a **not live / not dead reckoning** warning including age.
- **Valid GPS returns:** solid rover marker updates to fresh coordinates.
- **Outage >30 s:** held marker disappears.
- **Receiver disconnected:** marker is cleared rather than showing a stale position. The existing packet timeout remains untouched.
- **Historical record selected:** live rover marker remains hidden as before.

This is a **last-known-position display**. It does not use the IMU/encoders to estimate motion. While GPS is invalid, the held location may differ from the rover's physical position, particularly if it continues moving.

## Scope — only ONE project file changes

**Will change:** `apps/desktop/src/App.jsx` (UI display only)

**Will NOT change:** Arduino Mega firmware, ESP32 firmware, receiver firmware, `src-tauri`/Rust, LoRa packets or parsing, battery, GPS validation, soil sampling/geotags, map/heatmap calculations, database, missions, motor control, obstacle alert, `FORWARD_MPS` (your `2.9 / 22` calibration), or the existing Field Map GPS continuity code.

The existing `HeatmapMap.jsx`, `useRoverDisplayPosition.js`, `roverPositionDisplay.js`, and `FieldMapView.jsx` must already be installed from your earlier **Eksplorador GPS Display Continuity** ZIP. The updater checks these prerequisites; if absent or incompatible, it exits **before editing anything**.

## Install — PowerShell (run from project root)

1. Extract the complete folder `Eksplorador_LiveMonitoring_GPS_Continuity_NodeJS` into your `D:\UST Capstone\Eksplorador-project` folder.
2. Use the dry-run first:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
node .\Eksplorador_LiveMonitoring_GPS_Continuity_NodeJS\apply_live_gps_fix.js . --dry-run
```

Expected output:

```
WOULD PATCH: apps/desktop/src/App.jsx
Dry run complete. Only App.jsx would be changed; no files changed.
```

If **ERROR** appears, **DO NOT manually force the edit**. The available App.jsx may differ from the version this package supports. Share the complete error message or App.jsx for a custom integration.

3. Apply:

```powershell
node .\Eksplorador_LiveMonitoring_GPS_Continuity_NodeJS\apply_live_gps_fix.js .
```

4. Run regression tests (Node.js only; no extra dependencies):

```powershell
node --test .\Eksplorador_LiveMonitoring_GPS_Continuity_NodeJS\tests\regression.cjs
```

5. Compile and launch **your actual desktop**:

```powershell
cd apps\desktop
npm run build
npm run tauri dev
```

Only after **`npm run build` succeeds** should you treat the integrated JSX as build-validated. The bundled Node regression tests are isolated source-fixture tests and cannot guarantee your local build.

## Rollback and repeated installation

- Every successful first install creates a timestamped **`backups/<timestamp>/App.jsx`** under the installer folder. To roll back, copy that backup over `apps/desktop/src/App.jsx` (with the app stopped).
- Rerunning the same installer should report `ALREADY PATCHED` and change nothing.
- Dry-run inspects dependencies and source anchors **without writing any files**.
- If a source anchor differs, the installer aborts before editing; it never guesses where to insert code.

## Hardware-free UI regression checklist

With **motors unpowered** and rover electronics / desktop LoRa receiver powered safely:

1. **Valid fix:** live marker and `GPS Fix` badge show current rover GPS coordinates.
2. **Short loss:** ensure receiver stays connected while `satsLocked` becomes `0`. The location remains at the last verified point, faded; warning says **not live**. The *badge* must still say `No Fix`, not claim a GPS lock.
3. **Recovered fix:** when new valid GPS packets arrive, marker becomes solid and updates to the live position.
4. **Continuous loss:** beyond 30 seconds since the last valid GPS packet, marker disappears.
5. **Disconnect:** disconnect desktop LoRa receiver and check the map clears rather than displaying indefinitely cached data (existing link-status updates may take a moment).
6. **Historical view:** selecting a historical record hides the live rover marker, and clearing selection returns to the appropriate live/held status.
7. **Soil sample:** with invalid GPS, the sampling workflow must still refuse a GPS-derived geotag and allow your existing manual geotag workflow. Last-known **map** coordinates must not automatically become a soil sample location.
8. **Regression:** obstacle notification, LoRa receive, battery, existing Field Map, 0.132 m/s timed mission estimate, upload controls, and soil logging all behave as before.

**Field safety:** The ground-autonomy ultrasonic configuration is a separate unresolved matter. This display-only patch does not make autonomous motion field-safe or change motor controls.
