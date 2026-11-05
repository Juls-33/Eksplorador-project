# Coordinate missions and onboard feedback navigation (N1 / 3.1.0)

The main Field Map workflow is select ordered pins, Send Mission, observe delivery
and staging, then authorize movement with the physical RC controls. The desktop
sends coordinates; the Mega calculates and updates short movement targets using
the actual portable C++ estimator/controller. No live GPS, heading, calibration
or firmware checkbox gates coordinate transmission. Readiness gates powered
navigation on the rover. These are source changes and software simulations;
no board was flashed, RF mission sent or physical motion validated.

The subsequent [Mega RC failsafe audit](mega-rc-failsafe-audit.md) documents
retained channel/edge evidence, rearm corrections, lightweight timing diagnostics
and additional regression/hardware checks. RC acceptance and timeout policies
remain unchanged; this does not establish hardware validation.

## Operator workflow

1. Select pins in order and inspect the coordinate list and byte count. Send
   Mission opens the uploader and starts preparation/transmission automatically.
   Keep CH6 HOLD, CH5 DISARM and rover CH8 RX during upload. The desktop switches
   its radio mode using the existing confirmed handoff.
2. Read separate evidence: local/radio submission, matching ACK2 (UART queue
   delivery only), and matching Mega STAGED. After desktop RX returns, set rover
   CH8 TX to restore feedback. Closing/cancelling the uploader cannot recall a
   delivered mission and is not a rover stop command.
3. Inspect Rover navigation. It shows reported state/reason, current target,
   GPS and target coordinates, remaining distance, estimated position/heading
   uncertainty, encoder travel and correction attempts. Missing/stale reports
   remain unconfirmed. Developer Tools shows actual reported firmware versions,
   stored calibration coefficients, raw diagnostics and export controls.
4. Before motion, the Mega requires a measured stored calibration, initial
   true-north heading, fresh GPS/gyro/tilt data, clear sonar, functioning safety
   interlocks and RC authorization. Set the measured heading in Developer Tools
   for the next mission (one-use, five-minute expiry), or use the disarmed Mega
   USB console after staging: NAV HEADING <degrees>. Keep the rover stationary;
   staged encoder motion or integrated turn invalidates the heading reference.
5. With the area clear, authorize RC using the existing neutral/disarm/arm
   sequence, then deliberately move physical CH6 from HOLD to SEMI_AUTO. Arming
   while CH6 is already SEMI_AUTO cannot start navigation. An unsuccessful edge
   is consumed; readiness recovery cannot start motion without a new HOLD edge.
6. Observe GPS track versus planned targets and onboard pose. STEP_DONE reports
   only a bounded encoder segment. Only matching PIN_CHECKED/GPS_WITHIN_5M
   establishes this waypoint's reported GPS verification. COMPLETE does not fill
   in missing waypoint events. Use physical HOLD/DISARM to stop.
7. Holds/cancellations clear the active route and never auto-resume after GPS,
   RC or obstacle recovery. Inspect the cause and stage a new mission. Automatic
   probe deployment and blind obstacle detours remain disabled.

## Payload and coordinated versions

All three boards report compiled version 30100 (3.1.0). Existing folder names
Receiver_A3_0, Rover_A3_0 and Mega_A3_0 are retained. This is a coordinated N1
firmware change; the older A3.0 checkpoint executor is not payload-compatible.
The N1 prefix prevents silently reinterpreting old F/L/R/W missions.

Example payload: N1,H90,W104609000.300989000,W104609100.300989100

H is optional, explicitly measured initial true-north heading. Each W is now a
navigation TARGET, not an immediate checkpoint instruction. Coordinate integers
remain round((latitude+90)*1000000) and round((longitude+180)*1000000); the period
separates two integers. The parser supports 1-10 targets and at most 226 ASCII
payload bytes inside the existing 255-byte Mission V2 frame. The current compact
format fits ten valid targets plus its optional heading; both bounds are still
validated independently and oversized input is rejected whole. No pin is omitted,
truncated or implicitly batched. A 49.5 m + 32.8 m route sends two coordinates,
not 55 precomputed forward segments; onboard range/travel/time limits still apply.

Mission ID, exact CRC32 bytes, ACK correlation, eight-attempt retry behavior,
protected UART delivery and the rover's persistent at-most-once journal remain.
A duplicate payload does not rerun navigation. ACK2 does not establish Mega
staging, readiness, movement or arrival. The native preparation boundary validates
N1 only and accepts coordinates without a GPS/calibration client attestation.

## Actual controller and estimator

WaypointNavigation.h is used directly by Mega and host simulation. The
historical JavaScript relative-command/sampling model is an isolated research
simulator in Developer Tools, not the production controller or field evidence.

The controller integrates calibrated left/right encoder travel and gyro bias,
scale and direction, combines encoder/gyro turn increments, and updates local
meter coordinates around the starting GPS fix. Unique fresh GPS observations
correct position with a bounded innovation gate. GPS course only refines an
already initialized heading after a sufficiently long straight baseline; it
never initializes heading or substitutes for a compass reference. Position and
heading uncertainty are conservative heuristic model bounds, not calibrated
statistical confidence or a measured accuracy guarantee.

Movement uses existing encoder CPR, electrical polarity, manual PWM calibration
and hardware output interlocks. Primitives are at most 0.5 m or 30 degrees;
steering is bounded. Checks stop on encoder disagreement/noise/stall/overshoot,
gyro disagreement or staleness, tilt/faults, RC loss/manual takeover and unknown
or blocked forward sonar. A brief GPS interruption permits bounded calibrated
dead reckoning: at most five seconds since the last fresh fix and 1.5 m encoder
travel, with position uncertainty at most 5 m and heading uncertainty at most
20 degrees. Safety policies also bound a primitive to 15 seconds, waypoint to
600 seconds, mission to 1200 seconds, travel to 200 m, and a waypoint to 32
turn-correction attempts / 256 segments. Each target must be within 200 m of the
starting fix; latitudes beyond 85 degrees are refused by this local projection.

GPS qualification requires explicit valid data, age <=3000 ms, >=5 satellites
and HDOP*100 <=300. Coordinates alone do not qualify. Arrival stops for two
independent fresh GPS fixes with both observed and estimated distance plus
modeled uncertainty within 5 m. A two-second stopped dwell follows each verified
pin. COMPLETE/GPS_ROUTE_VERIFIED records onboard completion; missing individual
PIN_CHECKED revisions remain visibly unverified at the desktop.

## Sensor/status path

The working 19-field DATA packet and existing soil/GPS/IMU/encoder/fusion display,
database, reports, heatmap and manual actuator paths remain. DATA still supplies
no invented GPS validity fields. Existing FUS GPS is used for desktop raw-track
comparison, not as a client upload prerequisite or motor authorization.

Rover sends NG1 unique GPS fix sequence, explicit validity, signed microdegrees,
satellites, HDOP and source age; NI1 sends sequenced gyro rate/validity/age.
These whole sensor lines defer behind a protected mission UART frame. Duplicate
or older active-session samples cannot refresh freshness; age arithmetic
saturates. Inactive sources can recover a rebooted counter after silence.

Mega emits bounded NT1 integer telemetry for versions, persistent boot epoch,
sequence, mission ID, target pin, state/reason, validity flags, raw GPS and
estimated pose, uncertainty, heading, remaining/travel distance, corrections and
calibration revision/bias. Rover stamps its own compiled version; receiver emits
its own version in navigation JSON. Each board reports its actual compiled
version, rather than guessing another board's version. NC1/navigationCalibration
reports stored measured coefficients. Readiness is onboard telemetry, not a
checkbox. Native parsing isolates these messages from DATA/ENC/FUS and adds
receipt time. Boot epoch + monotonic sequence reject duplicate/late NT1 without
refreshing age; new boot epochs recover source sequence. USB reconnect clears
observation cache. Ten-second UI freshness is an observation warning, not a
motor-control timeout. Radio transit age is not measured by USB receipt time.

The same shared MS parser at both ESP32 hops accepts reason digits, including
GPS_WITHIN_5M, with complete-line consumption. Receiver JSON is exercised directly
in host tests and replayed through the production Rust classifier into UI
waypoint evidence. N1 step means one-based WAYPOINT index, excluding N1/H;
STAGED uses 0 and STEP_DONE is a subsegment at the current waypoint. Legacy
relative simulation/log helpers retain their historical token indexing only.
The rover queues up to eight status revisions, prioritized over diagnostic radio
packets; native status gaps/duplicates/reconnection handling remain. Status
transport is still best effort; queue overflow or packet loss cannot be
reconstructed or treated as proof of arrival.

Mega telemetry UART is chunked without interleaving soil/encoder/status frames.
Critical RC/mode/fault output aborts a partial diagnostic line. Radio optional
telemetry is scheduled one frame per slot, preserving DATA ACK/retry handling.
A persistent dual-slot CRC boot counter distinguishes rebooted Mega streams;
failed boot-counter readback prevents autonomous output.

## Measured loaded calibration

No physical distance, turn or gyro calibration was invented. New firmware starts
without a valid navigation calibration on blank EEPROM. Original manual RC motor
and encoder calibration/polarity constants are preserved. Connect Mega USB at
115200 baud. Setup commands require disarmed output; they only record observations
and never command movement. Keep probe retracted and use controlled manual RC:

1. Loaded rover stationary: CAL ZERO; wait >=3 seconds; CAL END 0. At least 30
   stable gyro samples are required. Wheel motion/unstable gyro rejects zero.
2. CAL BEGIN STRAIGHT; drive manually, measure actual ground travel, return
   HOLD/DISARM; CAL END <measured meters>. Perform at least two trials.
3. CAL BEGIN LEFT and CAL BEGIN RIGHT; perform manually measured 30-180 degree
   turns, return HOLD/DISARM; CAL END <measured degrees>. At least two each.
4. CAL SAVE requires correct direction, valid encoders/gyro and consistent
   repeated measurements (15% bound). It derives separate loaded meters/rev,
   effective turn width and gyro scale/sign/bias. Inspect CAL STATUS, reboot,
   and compare reported coefficients/revision before motion.

EEPROM stores versioned CRC profiles in alternate slots with destination
invalidation, payload write, magic-last commit and readback. Invalid/incomplete
profiles remain unusable; the previous valid slot survives interrupted writes.
Software tests cover CRC corruption and inconsistent measurements, not physical
power-loss behavior, EEPROM endurance or loaded traction. CAL ZERO restarts the
trial series. Never copy simulation fixture constants into the real rover.

## Recording and export

Recording begins on Send Mission and continues across pages. Developer Tools
exports JSON using the native save dialog: frozen target coordinates, native
mission ID, raw DATA/ENC/FUS, navigation/calibration snapshots, pose, mission
reports, receipt times and comparison distances. The main view plots planned
order, valid observed FUS GPS and matching onboard pose tracks. The illustrative
3 m desktop comparison radius never overrides Mega's GPS arrival evidence.

Schema: eksplorador-feedback-navigation-v1. A new run archives the previous run
instead of blocking Send. Session memory bounds: 10000 raw records/run, 2000
points/track, five archived runs, with explicit dropped-record/track/archive
counts. Export before app exit. Stop recording only stops capture; Clear current
and archived recordings deletes session logs only. Neither stops the rover or
changes the database. This is not a persistent flight recorder.

## Verification and reproduction

Run from repository root:

    powershell -NoProfile -ExecutionPolicy Bypass -File embedded/tests/CheckNavigation.ps1

This compiles/runs the shared production C++ controller/receiver tests and builds
all three firmware targets. It never flashes. Arduino CLI, AVR/ESP32 cores and
LoRa/TinyGPSPlus dependencies must be installed. The local
embedded/libraries/EksploradorNavigation wrappers expose canonical shared headers
to Arduino's staged builder; compile with --libraries embedded/libraries.

From apps/desktop: npm test; npm run build.
From apps/desktop/src-tauri: cargo check --locked --offline;
cargo test --locked --offline.

Final checks passed:

| Check | Result |
| --- | --- |
| npm test | 145 passed, none failed/skipped |
| npm run build | Passed; existing >500 kB bundle warning |
| cargo check --locked --offline | Passed |
| cargo test --locked --offline | 55 passed; binary/doc targets passed |
| Shared C++ production controller/receiver host tests | Passed (also run by npm integration) |
| Mega, arduino:avr:mega (AVR 1.8.8) | Passed; 59926 B flash, 4609 B static RAM |
| Rover, esp32:esp32:esp32 (core 3.3.11) | Passed; 349520 B flash, 25324 B static RAM |
| Receiver, esp32:esp32:esp32 (core 3.3.11) | Passed; 317316 B flash, 22796 B static RAM |
| Changed Rust modules/examples formatting; git diff --check | Passed |

Builds used LoRa 0.8.0 and TinyGPSPlus 1.0.3, installed locally. Existing Rust
unused Read/State imports, isolated GPS diagnostic dead-code and replay-example
dead-code warnings remain. Tests compile/run using MSVC locally; the script also
supports G++. These counts do not imply physical validation.

Fixtures are synthetic source-format traces, never labelled physical captures.
Tests cover coordinate
payload delivery separately from execution, two/three/four pin turns, the long
two-leg example, position drift, brief/extended GPS loss, heading error, encoder
disagreement, obstacle/sonar, tilt, RC loss/manual takeover, start-edge gating,
measured calibration, corrupt storage, numeric reasons through both relays,
actual receiver JSON through Rust/UI, retries/CRC/identity, status loss/duplicates
and existing database/soil/encoder/fusion/help regressions.

## Staged physical testing procedure

1. Review wiring/pin allocation, board models and power isolation. Compile and
   deliberately install the coordinated images using the team's normal flashing
   procedure. Verify all three reported versions. Keep drive power isolated;
   exercise disarm, HOLD, manual/auto selection and transmitter-off failsafe.
   A receiver that holds valid PWM on RF loss cannot be detected as lost RC by
   Mega; configure no-pulse/disarmed failsafe and verify it physically.
2. With restrained/elevated drive and probe safe, verify existing manual motor
   polarity, encoder signs/counts, gyro axis/sign, sonar clear/blocked/unknown,
   tilt and actuator interlocks. Stage coordinates without GPS and confirm no
   output. Arming while CH6 is already SEMI_AUTO must produce no auto motion.
3. Perform the measured loaded-ground calibration above in a controlled area.
   Verify save/reboot/readback and exported coefficients. Repeatability depends
   on load, surface, track slip and IMU mounting; remeasure when these change.
4. Mark a short two-pin course in open sky with spotter and immediate physical
   stop access. Measure true heading, verify fresh GPS/IMU/sonar/readiness,
   stage, authorize RC, then deliberately transition HOLD to SEMI_AUTO. Start
   at conservative power with a physically limited area; compare actual stops,
   encoders and GPS tracks. A simulator pass does not establish stopping distance.
5. Exercise obstacle hold, manual takeover, disarm and RF failsafe individually.
   Confirm motor stop and no automatic resume. Test GPS interruption only in a
   controlled short run; confirm DR uncertainty/time/travel hold. Do not test
   radio/USB loss by assuming the desktop can stop the rover.
6. Only after short trials pass, test three/four pins and turns. Export every
   run, check individual arrival evidence and missing events, compare measured
   physical distances/angles and raw sensor tracks. Tune policies using evidence;
   never label navigation accuracy or probe deployment validated by software.

Unresolved physical limitations: loaded meters/rev/turn coefficients and gyro
bias under temperature, IMU mount orientation, skid/traction effects, GPS multipath
and modeled uncertainty accuracy, actual stopping distance/PWM response, sonar
coverage, RF scheduling/delivery and USB/WebView/save-dialog behavior. N1 requires
all coordinated images; older firmware cannot execute its target semantics.
Reliable complete event history would require stronger status delivery/storage.
No automatic soil probing or obstacle avoidance is implemented.

## Modified-file inventory

This inventory includes the coordinated update and the earlier desktop work
already present in the working tree. Existing user removal of A2.9 source
folders is not part of this implementation. Paths are repository-relative:

* Shared production firmware: embedded/shared/WaypointProtocol.h,
  WaypointNavigation.h, NavigationCalibration.h.
* Arduino package: embedded/libraries/EksploradorNavigation/library.properties;
  src/MissionProtocol.h, src/WaypointProtocol.h, src/WaypointNavigation.h,
  src/NavigationCalibration.h (under that package).
* Firmware under embedded/1 Final Microcontroller Firmwares (unuploaded)/:
  desktop/Receiver_A3_0/Receiver_A3_0.ino, desktop/Receiver_A3_0/NavigationReceiver.h;
  rover/Rover_A3_0/Rover_A3_0.ino; mega/Mega_A3_0/Mega_A3_0.ino,
  mega/Mega_A3_0/NavigationMega.h; shared/MissionProtocol.h,
  shared/WaypointProtocol.h, shared/WaypointNavigation.h,
  shared/NavigationCalibration.h.
* Embedded tests: embedded/tests/navigation_test.cpp,
  embedded/tests/CheckNavigation.ps1.
* Native under apps/desktop/src-tauri/: src/encoder_telemetry.rs, src/lib.rs,
  src/mission_protocol.rs, src/mission_deployment.rs, src/mission_status.rs,
  src/mission_gps.rs, src/mission_mock.rs; examples/validate_mission.rs,
  examples/replay_telemetry.rs; capabilities/default.json.
* App under apps/desktop/src/: App.jsx; components/OperatorNavGuide.jsx,
  MissionDeploymentWizard.jsx, MissionStatusReport.jsx, NavigationFeedback.jsx,
  MissionExperimentPanel.jsx, MissionPrerequisites.jsx, MissionSimulationPanel.jsx;
  views/FieldMapView.jsx, DeveloperToolsView.jsx, UserManualView.jsx,
  FieldMapGuide.jsx; utils/waypointMission.js, missionPlanning.js,
  missionStatus.js, supervisedMissionSimulation.js, missionSimulation.js,
  helpNavigation.js; hooks/useMissionExperiment.js;
  services/missionExperimentRecorder.js; assets/user-manual/field-map/
  movement-sequence.svg, mission-handoff.svg. Legacy relative prerequisites/model
  are research helpers only; the main send path does not use them.
* Desktop tests under apps/desktop/tests/: waypointMission.test.js,
  embeddedNavigationIntegration.test.js, a30FirmwareCompatibility.test.js,
  missionPlanning.test.js, missionProtocolIntegration.test.js,
  missionStatus.test.js, missionExperimentRecorder.test.js,
  supervisedMissionSimulation.test.js; fixtures/a30-receiver.jsonl,
  fixtures/a30-status.jsonl, fixtures/n1-navigation.jsonl.
* apps/desktop/package.json; docs/mission-a3.0-desktop.md;
  docs/mission-upload-v2.md.
