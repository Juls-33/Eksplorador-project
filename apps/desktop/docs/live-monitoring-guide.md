# Live Monitoring guide verification

This task adds documentation and presentation only. It does not change the
dashboard, telemetry parsing, serial discovery, radio behavior, saving,
assessment calculations, firmware, or existing guide content/styles.

## Source review

- `src/App.jsx`: Live Monitoring Board, receiver/radio/GPS/probe badges, four
  soil cards, map layers, Live Sampling Queue, session-based recent samples,
  historical grouping/assessment, Crop Suitability and data transfer controls.
- `src/App.css`: dashboard layout, badges, cards, map GPS warning and historical
  controls. `UserManualView.css` supplies the existing guide layout unchanged.
- `src/components/LoRaConnectionStatus.jsx`, `src/utils/loraStatus.js`,
  `src/hooks/useLoRaConnection.js` and `src/services/loraConnectionStore.js`:
  USB receiver discovery/status and detected mode are separate from telemetry.
- `src-tauri/src/lib.rs`: serial discovery/read-error recovery, JSON emission,
  soil-valid/location saving gates and buffered database writes. Review was
  read-only. Missing saved numeric soil fields use `unwrap_or(0.0)`.
- Existing README, mission-upload protocol notes and manual maintenance notes
  supplied context. No firmware-only field was promoted into a dashboard feature.

## Facts and current presentation limits

- Displayed measurements: moisture (%), pH, EC (uS/cm), N/P/K (mg/kg).
  Temperature and salinity are not shown here. The page has no speed, pitch,
  roll, yaw/heading or tilt-alert panel, and no manual COM-port or TX/RX toggle.
- Fresh dashboard data is event-driven. No fixed telemetry transmission rate
  is promised. The >15 s stale timeout is checked every 2 s; saved records are
  polled every 10 s and can lag behind live cards due to buffered saving.
- USB discovery retries automatically after missing receivers or read errors;
  it does not guarantee wireless recovery or set the rover's SD switch.
- GPS Fix needs recent packets, a positive integer locked-satellite count and
  usable coordinates. Lat/Lng in the table is saved-record location, not a
  separate live position readout. A default/saved base map is not a valid fix.
- `soilOk` checks the last packet's `soilValid === 1`, without the freshness
  check used for GPS. Soil cards/probe labels and radio values can remain stale.
- The queue's “received just now” text is not an aging clock. Crop Suitability
  can also keep a last-packet summary while telemetry is waiting.
- “Within range”, “Optimal” and “Balanced” use the soil-valid flag, not separate
  agronomic range checks. The guide does not offer fertilizer recommendations.
- Missing packet fields do not all receive individual missing-data labels.
  A displayed/saved zero cannot be certified as a physical measurement by this
  screen alone; saved missing numeric fields may have been replaced by zero.
- Historical selection chooses an anchor and automatically groups up to 20
  records within 100 m and ±2 h. At least 10 enable assessment. These are app
  selection rules, not accuracy claims or a sensor validation procedure.
- Export backs up the full database, Import replaces it, and Merge combines
  backup data. None is a telemetry refresh or a radio recovery command.

## Screenshot provenance and hardware verification

Screenshots were captured from the real running native app, without injected
sensor data or database changes. Crops retain the original UI content. See
`src/assets/user-manual/live-monitoring/README.md` for the asset inventory.

Physical sensor calibration, actual EC output units/conversion, valid zero
measurements, sensor contact, wireless reception, USB reconnection on hardware
and outdoor GPS behavior remain unverified by this documentation task. The
dashboard's uS/cm label must not be assumed to match another page's EC scale.
No successful hardware connection or sensor-reading screenshot was fabricated.

## Validation

- `node --test tests/*.test.js`: all 21 existing frontend tests passed.
- `npm run build`: passed; the existing JavaScript chunk-size warning remains.
- Development and production browser previews: all 7 topics and all 7 genuine
  screenshot assets loaded at 1366×768, 1024×768 and 800×600. Checked image
  proportions, overflow, scrolling, compact topic selection, heading focus,
  previous/next navigation, lightbox zoom/reset, Escape and focus restoration.
- Rover and Field Map guides remained available; Crop Assessment and Reports
  retained their placeholders. No documentation action prepared or sent a
  mission. No unexpected browser exceptions were observed.
- Browser validation used an isolated mocked Tauri bridge, not the real radio
  or database. Its temporary screenshots were not used as guide assets.
- Diff review confirmed that the parent view only imports/renders the new
  guide; existing guide content, FieldMapGuide.jsx and shared CSS are unchanged.
