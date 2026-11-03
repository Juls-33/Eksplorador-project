# A2.9 desktop mission integration and safety audit

Audit date: 2026-11-03 (Asia/Manila). Source: the current desktop working tree and
`embedded/(NEW) Eksplorador_A2_9_PreField_Integration.zip`, including its audit,
three firmware sources, shared protocol and design-only workflow. The supplied
firmware archive is unchanged; no firmware was flashed or copied over older sketches.

## Result and communication evidence

The desktop separates transport upload recovery from Mega observations. The
transport's internal `COMPLETE` enum still means ACK plus RX/telemetry recovery;
it never means waypoint execution, soil sampling or mission completion. Keeping
that enum preserves the existing retry/recovery state machine.

| Evidence | Meaning |
| --- | --- |
| Local submission | Serial mission command was written; delivery remains unknown |
| Ground-station submission | Receiver accepted the command |
| Matching TX_DONE | Radio transmission finished; starts the ACK retry budget |
| Matching ACK2 with immutable V2 ID and checksum | Rover queued the mission for UART delivery |
| Matching missionStatus STAGED | Mega accepted staging, with no physical execution |
| Matching missionStatus REJECTED | Mega rejected the mission; radio ACK may still be true |
| Fresh DATA after confirmed RX | Telemetry recovered, independently of staging |
| Future explicit execution/pause/fault/completion report | Last reported Mega state only; no desktop movement command |

The UI shows: **Mission accepted for staging. Autonomous navigation remains
disabled pending calibration.** The assistant, persistent Field Map report,
manual, Field Map guide and handoff diagram no longer instruct arming or
SEMI_AUTO after upload. Manual RC instructions remain available separately.
The staging checklist requires operator verification that all three boards run
the A2.9 safety firmware. The V2 banner does not prove that firmware version.
The legacy `send_movement_sequence` command now returns an error, closing a
single-shot upload path that bypassed the V2 assistant.

## Parsing, identity and reconnection

- Only plain receiver JSON with `type: missionStatus` enters the separate native
  status branch. DATA/ENC/FUS transport mismatches and diagnostic echoes cannot
  enter it. Malformed status JSON cannot fall through into sensor events or
  SQLite soil buffers, even if it contains sensor-looking fields.
- Validation requires the documented fields and types, a nonzero 16-character
  uppercase hexadecimal ID, positive uint32 sequence, step 0–50, constrained
  uppercase state/reason lengths, finite SNR and bounded RSSI/SNR. Extra fields
  fail closed. New uppercase state names are displayed literally until given
  an explicit UI description; unknown states do not imply completion.
- Reports match the canonical hexadecimal ID generated from the immutable V2
  deployment ID. A report for an unsent, older or unrelated mission is ignored.
  The status wire frame contains no payload checksum, so it cannot independently
  authenticate the original sequence; ACK2 correlation retains its ID+CRC check.
- Status sequence is a high-water mark per deployment. Older revisions and
  conflicting same-revision contents are ignored. Identical repetitions are
  deduplicated, including repetitions with changed radio metrics. A repeated
  identical report can confirm observation after USB reconnection.
- USB loss preserves the last report and sequence history, marks it historical,
  and retains the existing transport failure/recovery behavior. Reconnection
  cannot clear sequence history or replay mission commands. Shared revision-
  ordered LoRa snapshots expose the same report to every view, including after
  closing the assistant. Status receipt cannot set ACK or transport completion.
- Reports are last observations, not proof of continuous execution or radio
  liveness. A2.9 reports are best effort and may arrive only after desktop RX /
  rover TX is restored; absence of a report means staging remains unknown.

## Planning audit and future route contract

The legacy generator is intentionally retained for V2 staging compatibility.
It computes a bearing and distance from the assumed start pose, advances its
virtual pose to each pin, and emits turns exceeding 5 degrees and movements
exceeding 0.5 m. Degrees and meters are rounded. It assumes every prior move
succeeded; it cannot correct slip, heading drift, overshoot or positioning error.
It is not waypoint navigation and does not authorize actuation.

The map no longer invents a starting rover coordinate or heading. Invalid GPS,
USB loss and five seconds without a received position suppress the planning
pose. Legacy DATA lacks calibrated accuracy/age metadata: this display timeout
does not qualify GPS for autonomous navigation. With no absolute heading in
DATA, the operator can explicitly supply a planning reference bearing. Gyro-Z
rate is never substituted for heading. A2.7 FUS stays a diagnostic observer.

The separate frozen simulation plan (`version: 3`, `simulationOnly: true`) has:

| Per-waypoint field | Purpose |
| --- | --- |
| id | Stable waypoint identifier |
| coordinates | Actual latitude/longitude copied from the planned pin |
| arrivalToleranceM | Configurable arrival radius |
| requiredConfidence | Minimum localization confidence |
| maxUncertaintyM | Maximum accepted location error bound |
| samplingRequestId | Unique request scoped to mission and waypoint |

Runtime progress tracks arrival, sampling and completion independently of the
immutable route. Field Map exposes a collapsed simulator with configurable
planning criteria, editable synthetic JSON observations, explicit authorization,
pause, recovery, abort and manual override. Changing map pins never mutates an
already staged simulation. Simulations never use the live transport, save soil
samples, replace real coordinates, or send this future schema to A2.9 firmware.
There is no deployed coordinate-based wire protocol or SQLite migration in this
phase. A future implementation needs version negotiation, durable mission/waypoint
and sampling-request persistence, and matching firmware support before upload.

## Non-actuating sampling supervisor

The pure JavaScript model implements:

```text
MISSION_STAGED → NAVIGATING → ARRIVAL_CONFIRMED → DRIVE_STOPPED
→ PROBE_EXTENDING → SOIL_SAMPLING → PROBE_RETRACTING
→ RETRACTION_CONFIRMED → NEXT_WAYPOINT → MISSION_STAGED / MISSION_COMPLETE
```

Every returned physical drive/extend/retract output is permanently false. The
phase describes a simulated decision only. Synthetic examples deliberately
provide observations for inspection; they are not hardware measurements.

- Calibration validation plus deliberate operator authorization is required to
  leave staging, including at the next waypoint. Receipt alone cannot progress.
- Arrival uses geographic distance plus uncertainty within the waypoint's
  tolerance. Localization is checked again before extension in case the stop
  moves the rover outside its arrival bound.
- A fresh stop confirmation and fresh finite safe IMU tilt are mandatory for
  extension, sampling and retraction. Unsafe tilt, missing/stale IMU or lost
  drive-stop confirmation causes a latched safety hold. Tilt alone never implies
  probe contact, force, travel position or clearance.
- Extension requires fresh contact confirmation. Sampling accepts only a fresh,
  valid reading for the current unique request, observed after entering sampling,
  with finite required soil values and basic domain bounds. Invalid/mismatched
  readings cannot complete a request; extension/sampling/retraction have timeouts.
- Extension invalidates old clearance. Retraction requires a fresh validated
  position/endstop mechanism or an explicit supervised operator clearance after
  retraction began. Elapsed time and safe IMU do not prove full retraction.
- Pause and holds never recover automatically. Recovery requires valid
  localization, safe IMU, stopped drive, fresh clearance and explicit operator
  approval. A valid completed sampling request is retained through recovery so
  clearance recovery cannot duplicate it. Abort/manual override are terminal in
  that run and issue no automatic retract or movement command.

GPS dropout is recoverable: fresh, sufficiently confident GPS is preferred;
otherwise only an explicitly calibrated encoder+IMU DR estimate qualifies. DR
must include actual coordinates, fresh valid encoder/IMU observations, bounded
uncertainty, confidence, age, distance since its anchor and anchor duration.
Uncalibrated A2.7 fusion never qualifies. Without either valid source the model
enters `HOLD_LOCALIZATION` and waits for valid data plus operator recovery and
renewed authorization. Demonstration limits are not field calibration.

## Regression and build validation

- `node --test tests/*.test.js`: 103 passed, including 35 simulation cases,
  6 mission-status/UI cases, existing shared connection, help navigation,
  drivetrain and native-to-frontend telemetry replay tests.
- `cargo test --offline --locked --all-targets`: 46 library tests and 14 replay
  example tests passed; binary target has no tests. Includes SQLite backup,
  migration and rollback tests, Mission V2 ACK/retry/cancel/disconnect tests,
  status validation/routing/correlation/order/reconnect tests and DATA/ENC/FUS
  regressions.
- `cargo check --offline --locked --all-targets`: passed.
- `npm run build`: passed. Vite reports the existing large-bundle warning.
- `cargo build --release --offline --locked`: passed.
- `cargo build --release --offline --locked --features tauri/custom-protocol`:
  passed, with the production frontend embedded. Executable:
  `apps/desktop/src-tauri/target/release/desktop.exe`.
- `npm run tauri -- build --no-bundle --ci -- --offline --locked`: blocked before
  compilation by the existing `com.gians_vrorowj.desktop` identifier, whose
  underscore is rejected by the current CLI. The identifier is unchanged because
  application data-directory continuity needs an explicit migration decision.
  No installer/package is produced by this task.

Existing native unused `State`/`Read` imports warn; the standalone replay example
also warns about its unused status payload and comparison helper. No new dependencies,
SQLite migrations, production database writes, firmware flashing or RC control
changes were needed. Automated rendering checks use actual Vite-transformed
components; interactive WebView and physical serial/radio testing remain required.

## Unresolved integration and hardware gates

1. Confirm/compile/flash the coordinated A2.9 sources on the actual three boards.
   This desktop does not query a trustworthy firmware version or remotely enforce
   the Mega lock; running older executable firmware remains unsafe for staging.
2. Mega status has no boot epoch or durable acceptance ledger. A lower sequence
   after Mega reset is intentionally ignored, even after USB reconnect. A safe
   future protocol needs boot/session identity and status query/acknowledgment;
   do not reset high-water marks merely to accept a delayed packet. Counter wrap
   is also fail-closed. Deployment tracking is process-local and is not restored
   across full desktop restarts; unmatched reports remain ignored.
3. Validate half-duplex status repetition, UART `RCV2` ID preservation, ACK loss,
   radio loss, USB reconnection, NVS journal recovery and Mega rejection on the
   bench. A missing STAGED report cannot be replaced by telemetry or ACK evidence.
4. Measure encoder scale, direction, displacement, missed/invalid counts, turning,
   wheel slip, gyro bias, heading alignment and motor interlocks before navigation.
5. Measure outdoor GPS age/accuracy/confidence. Implement and independently
   validate a bounded DR estimator with calibrated units and uncertainty before
   wiring localization into any physical navigator. DATA/FUS currently do not
   provide this contract.
6. Validate actuator geometry, extension clearance, tilt threshold, load/current
   protection, contact, full-retraction endstop/position sensing and supervised
   fallback. IMU is neither a force sensor nor a retraction sensor.
7. Validate fresh soil transactions, invalid readings, request deduplication and
   timeouts with the actual RS485 probe. Existing manual soil logging still uses
   `soilValid` insertion episodes; it is not the future request-correlated workflow.
8. Verify manual RC, emergency stop, loss-of-RC disarm/rearm, obstacles and actuator
   stops with the rover secured. Physical autonomy stays disabled until these
   gates and a supervised one-waypoint field calibration are satisfied.

## Modified files

- Native: `apps/desktop/src-tauri/src/mission_status.rs`, `mission_deployment.rs`,
  `encoder_telemetry.rs`, `mission_mock.rs`, `lib.rs`, and
  `apps/desktop/src-tauri/examples/replay_telemetry.rs`.
- Interface: `apps/desktop/src/components/MissionDeploymentWizard.jsx`,
  `MissionStatusReport.jsx`, `MissionSimulationPanel.jsx`, `OperatorNavGuide.jsx`;
  `apps/desktop/src/views/FieldMapView.jsx`, `FieldMapGuide.jsx`, `UserManualView.jsx`;
  `apps/desktop/src/assets/user-manual/field-map/mission-handoff.svg`.
- Logic/tests: `apps/desktop/src/utils/missionStatus.js`, `missionSimulation.js`;
  `apps/desktop/tests/missionStatus.test.js`, `missionSimulation.test.js`.
- Documentation: this audit and `docs/mission-upload-v2.md`.
