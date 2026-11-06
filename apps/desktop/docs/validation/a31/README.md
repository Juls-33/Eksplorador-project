# A3.1 desktop mission validation

Validated on November 6, 2026 against restored baseline `d4853ef` (`e292857` content). Changes are confined to the desktop mission workflow and its instructions/tests. No firmware, protocol headers, Rust source, migrations, database services, CSS, App navigation, reports, encoder monitoring or Live Monitoring source changed.

## Result

The existing Operator RC Movement Guide now prepares one sampling pin at a time. The operator selects fresh GPS or an estimated map position, confirms actual heading and probe clearance, and can preview calibrated, duration-bounded instructions. Calibration inputs start empty; provisional observations are explanatory text only. A pivot that exceeds its bound ends the leg before forward movement. Preview data has no transmission serializer.

**Send Mission is disabled.** The preserved Mission Deployment Wizard and Mission V2 implementation are not fed timing previews. Their CRC32, acknowledgments, retry and duplicate-protection code is unchanged. Firmware command grammar, definitive safety limits, verified execution events and electronic physical-fault recovery remain integration work. No powered mission was uploaded or run.

Manual RC repositioning invalidates the starting position and heading. Stopped-rover inspection requires a new location selection; arrival may be accepted outside five meters or rejected for a corrected leg. With Logging enabled, the existing RS485-validity report and sample-save function record the soil measurement once per insertion. Failed saves remain retryable; concurrent telemetry cannot duplicate a pending save. A saved sample, finished-sampling confirmation and full probe-retraction confirmation are required before separately authorizing the next leg. Mark Finished stays gated until every selected pin completes. Cancellation saves the existing `cancelled` mission status and never sends a stop command.

Radio delivery evidence cannot authorize or complete movement. No timer, GPS proximity, automatic actuator action or unattended next leg advances the workflow. Receiver loss during an active operation creates a workflow hold; reconnecting cannot resume it. Disconnected planning and timing previews do not become physical faults. Local reports, operator-confirmed physical conditions and verified firmware faults have distinct sources and recovery rules (see the hold correction below). Existing firmware RC controls and IMU tilt protection remain authoritative; the operator must use physical HOLD/DISARM.

## HELD-state correction

The original displayed combination of `HELD`, “Operator reported an obstacle, RC loss or physical safety fault” and “Verified firmware fault clearance is not yet available” had one producer: the **Report obstacle / RC loss / safety hold** button dispatched `FAULT`. `handleSupervisionAction` copied its reason into module-level `operatorReportedMissionFault`; the reducer set `physicalFault` and retained it on `RESET`. The page initializer also restored that global string after navigation. Cancel retained it, and the UI offered no recovery. A local, unverified button report was therefore treated as an indefinitely latched physical fault requiring a nonexistent firmware-clearance protocol. Receiver connection could not clear it. The separate receiver `INTERRUPT` event could not produce this operator-specific reason. No historical event log exists to establish when the button was clicked.

The correction removes that global string and introduces explicit hold metadata (`source`, `trigger`, `reason`) and separate local-report/firmware-fault state:

| Source | Entry and recovery |
| --- | --- |
| Workflow interruption | Actual receiver loss/status failure during manual movement, inspection or sampling. The exact receiver reason is shown. Reconnect cannot resume movement; Prepare again after inspection returns to planning. No GPS, missing calibration, incomplete planning, disconnected planning/preview and rejected arrival do not create safety faults. |
| Local operator report | Report button creates an unverified report for the selected mission. Review local safety report requires a review result plus physical DISARM/HOLD, stationary rover, absent/resolved condition, safe surroundings and retracted-probe confirmations. Applying the review only returns to planning; position/heading must be reconfirmed. Reports survive reopening their own mission, do not follow unrelated missions, and close on cancellation. |
| Operator-confirmed physical condition | Confirm reported physical condition is present retains the condition across cancellation/new missions. It cannot be dismissed as an accidental report. Physically resolve the condition, then complete the same safety review with Physically resolved. |
| Firmware-confirmed fault | Only an internal verified firmware event can establish it. It survives cancellation/new missions and cannot be cleared by any operator action. Only a verified clearance matching its fault ID removes it; inspection/replanning is still required. These are tested internal reducer events; no future telemetry fields, event listener, LoRa messages or clearance protocol have been implemented. |

New missions start in PLANNING unless an operator-confirmed physical condition or verified firmware fault is active. The field-map action handler accepts only operator actions; the UI cannot dispatch firmware confirmation/clearance events. Cancellation always ends the current workflow and never transmits a stop or claims a physical fault was cleared.

Files modified for this correction: `src/utils/supervisedMission.js`, `src/components/OperatorNavGuide.jsx`, `src/views/FieldMapView.jsx`, `tests/supervisedMission.test.js`, `tests/missionBrowser.mjs`, and this report. No Field Map CSS, sidebar, map controls, firmware or LoRa protocol was changed. The existing screenshots below document the initial A3.1 layout; the hold correction adds controls only inside the existing guide card.

## Position and persistence limits

- `GPS_MEASURED` requires valid nonzero coordinates, a positive satellite count and a telemetry receipt no older than 15 seconds. Receipt freshness cannot independently establish the age of the satellite solution; no new receiver fields are assumed.
- `OPERATOR_ESTIMATED` positions appear as E markers, with a tooltip identifying them as estimates. They never populate the rover GPS marker or measured-coordinate fields.
- Without fresh GPS, mission soil values use the existing nullable coordinate columns. No intended pin or estimate is substituted. Such records remain valid soil records but cannot create located heatmap points. When fresh GPS is available, the measured sample location is retained even away from the intended pin.
- Estimates, accepted-pin associations and probe/heading confirmations are session state. The existing schema has no provenance or explicit pin-completion columns. Reopening the page requires new confirmations rather than reconstructing acceptance from proximity. Saved soil samples and mission status persist normally.
- Physical RC fault/completion signals are not available in a defined desktop contract. Local operator reports use explicit physical inspection/confirmation; firmware-confirmed faults cannot use that local recovery. Powered authorization and electronic firmware fault recovery stay disabled pending integration.

## Files changed

| File, relative to `apps/desktop` | Reason |
| --- | --- |
| `src/utils/supervisedMission.js` | Position provenance/freshness, local bounded timing planner, explicit operator workflow and gates. |
| `src/components/OperatorNavGuide.jsx` | Minimal mission inputs, timing preview and stage-specific confirmations in the existing card. |
| `src/views/FieldMapView.jsx` | Map selection, mission-state integration, accepted-arrival sampling, pending-save guard, continuation/cancel/finish gates. |
| `src/components/HeatmapMap.jsx` | Optional marker title so an estimate is never described as a historical GPS sample. Existing map styles/controls stay intact. |
| `src/views/UserManualView.jsx` | Update only mission-operation instructions in the existing manual formatting. |
| `src/views/FieldMapGuide.jsx` | Update mission planning/progression/sample help and identify legacy deployment instructions as disabled integration references. |
| `tests/supervisedMission.test.js` | 21 unit tests for GPS fallback, timing conversion/limits, operator workflow, hold sources, guarded report correction, genuine physical conditions, protected firmware faults, cancellation and fresh missions. |
| `tests/missionBrowser.mjs` | Browser integration and screenshot capture with isolated Tauri IPC/database fixtures. No real receiver/database access. |
| `docs/validation/a31/README.md` | This implementation, validation and limitation report. |
| `docs/validation/a31/visual-comparison.json` | Asserted before/after bounds at four viewports. |
| `docs/validation/a31/before/layout.json`, `after/layout.json` | Captured baseline/current layout measurements. |
| `docs/validation/a31/before/monitoring-1440.png`, `monitoring-1024.png`, `monitoring-800.png`, `monitoring-800-600.png` | Baseline Live Monitoring captures. |
| `docs/validation/a31/before/field-map-1440.png`, `field-map-1024.png`, `field-map-800.png`, `field-map-800-600.png` | Baseline Field Map captures. |
| `docs/validation/a31/after/monitoring-1440.png`, `monitoring-1024.png`, `monitoring-800.png`, `monitoring-800-600.png` | Corresponding current Live Monitoring captures. |
| `docs/validation/a31/after/field-map-1440.png`, `field-map-1024.png`, `field-map-800.png`, `field-map-800-600.png` | Corresponding current Field Map captures. |
| `docs/validation/a31/after/leg-preview-1440.png`, `mission-completed-1440.png` | Timing preview/estimated marker and completed supervised sampling captures. |

## Checks

| Check | Result |
| --- | --- |
| `node --test tests/*.test.js` | **83 passed**, including existing help/manual, radio, encoder/fusion and real serial replay regression tests. |
| `cargo test --locked` in `src-tauri` | **41 passed**, including database preservation/migration/rollback, Mission V2 CRC/retry/deduplication, serial framing and encoder tests. Two pre-existing unused-import warnings remain. |
| `npm run build` | Passed. Existing large-chunk warning remains; no build restructuring was introduced. |
| `MISSION_BROWSER_CAPTURE=0 node tests/missionBrowser.mjs held-fix` against Vite and headless Chrome | Passed: the existing supervised sampling integration plus disconnected planning/preview, receiver loss/reconnect workflow hold, exact hold sources, guarded false-report correction, report persistence within its mission, persisted cancellation, actual new-mission creation without an unsupported fault, genuine physical-condition persistence/resolution, and no reappearing corrected report after page navigation. No movement-upload invocations. Live Monitoring, Reports and User Manual navigation smoke passed. |
| JS syntax checks and `git diff --check` | Passed. No frontend formatter/linter configuration is present. |
| `cargo fmt --all -- --check` | Fails on existing formatting in unchanged `database.rs`, `lib.rs` and other baseline Rust files. No Rust file was reformatted. |
| Before/after visual comparison | Sidebar pixels identical in both views at all four sizes. Sidebar/header/directory/map bounds identical; detail-column position/width identical. At narrow sizes only the mission-content height grows for the required controls. Online tile contents/loading indicators can vary between captures. |

Initial before-change captures were taken before implementation. Baseline captures were subsequently refreshed using a read-only Vite loader serving the five original tracked JSX files from `git show HEAD`, to collect consistent layout measurements and include the default 800×600 window. No checkout or baseline source rewrite was needed.

Viewports: 1440×900, 1024×768, 800×900 and default 800×600. **Inherited limitation:** baseline Leaflet content reports zero height at the narrow responsive layouts (1024 and 800 pixels). This is unchanged in the comparison; maximize the app to use map position selection. Correcting that existing layout defect would change the explicitly protected responsive behavior, so no CSS fix is included.

Browser tests use fixtures rather than physical rover hardware. RC switch behavior, actuator protection, measured calibration, satellite-solution age, real soil-probe acquisition and radio/execution behavior still require hardware validation after the firmware contract is supplied.

Representative artifacts: [before Field Map](before/field-map-1440.png), [after Field Map](after/field-map-1440.png), [local leg preview](after/leg-preview-1440.png), [completed sampling](after/mission-completed-1440.png), [layout comparison](visual-comparison.json).
