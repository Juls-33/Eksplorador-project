# Field Map guide verification

This is documentation and UI work only. The Field Map, radio, telemetry,
database and firmware source files are unchanged.

## Content checked against the current source

- `src/views/FieldMapView.jsx`: Add Field, mission form, Mission Directory,
  saved-boundary reuse, pin reuse/modify/new choices, draft pin editing,
  Launch Mission, mission selection, logging controls, sample insertion rules,
  Show pins and mission status/history controls.
- `src/components/HeatmapMap.jsx`: drag/zoom, place search, downloaded-area
  selection, follow control, waypoint markers, recorded-sample markers and
  heatmap rendering. The Field Map currently passes an initial rover position;
  a marker alone does not establish a fresh GPS fix.
- `src/components/OperatorNavGuide.jsx`: target progress, Reached, full-pin-list
  movement generation, L/R degrees, F meters and Send Mission opening the
  assistant. Reached is not a sample save, navigation command or route filter.
- `src/components/MissionDeploymentWizard.jsx` and `src/utils/loraStatus.js`:
  desktop TX preparation, operator checklist/confirmation, staged communication
  evidence, matching radio ACK, desktop RX recovery, rover TX instruction, fresh
  telemetry gate, retry restrictions and cancellation limits.
- `src/utils/pinProgress.js`: the 5 m recorded-sample matching radius is a UI
  progress rule; it is not GPS accuracy or an arrival guarantee.
- `src/utils/layerBands.js` and `src/utils/geo.js`: per-layer legends and
  interpolated heatmap colors. No synthetic measurements are used in the guide.

## Important distinctions preserved

- Launch Mission saves a plan and starts its logging state. Send Mission opens
  the upload assistant; the confirmation inside it transmits the mission.
- Desktop LoRa connected, local submission, ground-station acceptance and local
  radio transmission do not establish rover receipt.
- A matching rover ESP32 ACK does not independently verify Mega mission
  storage, execution or waypoint arrival.
- During upload: HOLD, DISARM, rover RX. After confirmed desktop RX restoration:
  rover TX, HOLD and DISARM until fresh telemetry is received. ARM then SEMI_AUTO
  only when the system and actual surroundings are safe.
- Pause Logging, Reached, Mark Finished and switching pages are not physical
  rover stop commands. Resume Mission reopens logging, not rover movement.
- The generated upload uses the full waypoint list, not only pending targets.
- Placing pins inside a boundary is not obstacle avoidance or a guarantee that
  every connecting route segment stays inside an irregular field.

## Screenshots and physical limits

The screenshots come from the real running Tauri app and its existing saved
mission. See `src/assets/user-manual/field-map/README.md` for provenance. Capture
did not send a mission, alter records or inject telemetry. The two SVG diagrams
are explicitly process illustrations, not fabricated screens.

Code review verifies current desktop behavior. Live radio delivery, hardware
switch response, fresh physical GPS/heading, Mega storage/execution and outdoor
waypoint accuracy were not physically verified for this documentation task.
No successful deployment screenshot or colored sample heatmap was fabricated.

## Validation

- `node --test tests/*.test.js`: all 21 existing frontend tests passed.
- `npm run build`: passed; Vite still reports a JavaScript chunk over 500 kB.
- Development and production previews: all 9 topics and all 6 visual assets
  loaded at 1366×768, 1024×768 and 800×600. Checked topic selection, heading
  focus, previous/next navigation, scrolling, preserved image proportions,
  lightbox zoom/reset, Escape and focus restoration. Other manual destinations
  remained available. No unexpected browser exceptions were observed.
- Browser validation used an isolated mocked Tauri bridge. Those validation
  screenshots are temporary and are not the source screenshots in the guide.
- Reviewed the diff against the pre-task manual: the existing view only adds
  the Field Map guide import and branch; its Rover content and CSS are unchanged.
