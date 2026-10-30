# Reliable mission upload (V2)

The desktop application and **both ESP32 endpoints must be updated together**.
Arduino Mega firmware is unchanged. No firmware is flashed by the test scripts.

Active sources:

- Ground station: `embedded/LoRa RX_All/RX_Board_code_w_movement.ino`.
- Rover: `embedded/ArduinoUnoESP32 serial test/oct21ESP32SerialTest/oct21ESP32SerialTest.ino`.
- Shared parser, CRC, duplicate decisions and airtime budget: `embedded/shared/MissionProtocol.h`.

The older `RX_to_TX_mode.ino`, `RX_Board_code.ino` and placeholder PlatformIO
projects are not the coordinated V2 endpoints. Keep the shared header alongside
the repository sources when building. Verify the board and wiring for the actual
hardware; the checks below use the classic ESP32 target matching these sources.
The ground-station LoRa DIO0 connection on GPIO2 must be present: V2 uses its
TX-done interrupt. Missing TX-done evidence fails the upload instead of guessing
that a packet finished. The rover also requires writable NVS for its journal.

## Wire format and compatibility

The dynamically generated sequence and its meters/degrees values are unchanged.
Only its transport envelope changes:

```text
USB serial: MISSION:M2:<16 uppercase hex ID>:<8 uppercase hex CRC32>:<sequence>|<submission>
LoRa:       M2:<ID>:<CRC32>:<sequence>
Rover ACK:  ACK2:<ID>:<CRC32>
Rover NACK: NACK2:<ID>:<CRC32>:<reason>
Mega UART: RCV:<original sequence>\n
```

CRC32 is IEEE/ISO-HDLC (polynomial 0xEDB88320, initial/final XOR 0xFFFFFFFF),
over the exact ASCII sequence bytes. The submission counter correlates ground
station completion logs; it increases across automatic and manual retries.
The mission ID and sequence CRC stay the same across all recovery retries.

The existing RX, TX, STATUS and legacy MISSION/RCV/ACK formats remain available.
Legacy raw missions are single-shot and do not have V2 duplicate guarantees.
The guided desktop uploader requires `[MISSION PROTOCOL] V2` from the ground
station and never accepts an old generic or payload-echo ACK as a V2 receipt.
An old rover cannot produce a valid ACK2; update it before using this workflow.

V2 uses one LoRa packet. Its 29-byte header leaves **226 ASCII bytes** for the
original sequence in a 255-byte radio packet. Oversized missions are rejected
whole before sending; they are never truncated, rescaled or silently split.

## Retry and cancellation state

`MAX_ATTEMPTS` in `mission_deployment.rs` defaults to 8. `ACK_TIMEOUT_MS` starts
at 1500 ms. The ground station starts each packet asynchronously, rejects
overlap, returns to RF receive after its real TX-done interrupt, and emits:

```text
[MISSION SUBMITTED] <ID>:<CRC32>:<submission>
[MISSION TX_DONE] <ID>:<CRC32>:<submission>:<ACK window milliseconds>
```

Only the matching TX-done log starts the ACK deadline. The window is the greater
of the desktop base and the ground station budget (ACK airtime, 9600-baud UART
handoff, flash/turnaround and USB margins). At the existing explicit SF7,
125 kHz, CR4/5, 8-symbol-preamble profile this remains 1500 ms. The airtime
calculation follows the [Semtech SX1276 time-on-air implementation](https://github.com/Lora-net/LoRaMac-node/blob/master/src/radio/sx1276/sx1276.c).
Both ESP32 sources explicitly retain that same profile, frequency, sync word and
CRC configuration. If changing the radio profile, change both endpoints and
recheck the 22-second host TX-completion bound and 10-second ACK-budget bound.

An ACK timeout schedules the next attempt with a 200 ms cancellable pause.
Desktop logical TX/upload mode is retained across all attempts. No completion
log means no overlapping retransmission: the operation fails and recovers RX.
Local submission, real packet completion and rover receipt are separate fields.

Cancel atomically removes unsent attempts in the serial-owner mutex. The ground
station can abort a local in-flight packet on RX. No timer/task in the dialog
continues transmitting after cancellation. An already received packet cannot be
recalled. Late ACKs are accepted only for the same active upload after a known
packet completion; duplicate/old/terminal/cancelled ACKs cannot restart it.

After eight missing ACKs, desktop RX is restored and the operation fails.
Retry Mission is enabled only with connected USB and confirmed desktop RX. It
keeps the same mission ID and requires HOLD/DISARM/RX reconfirmation before a new
operator-authorized attempt cycle. A new mission is blocked while an earlier
unacknowledged submission remains unresolved; explicit Cancel ends that upload
without claiming it was undelivered. Disconnect never replays queued commands.

## Duplicate protection and evidence limits

The rover saves one atomic NVS journal record **before** starting the UART
handoff. It records the greatest mission ID, checksum, original sequence and
handoff stage. A duplicate ID with identical bytes is re-ACKed without another
`RCV:`. Lower IDs are rejected as stale, and an ID with different bytes is
rejected as a conflict. This survives reboot without a finite cache eviction
window. The desktop uses monotonic-within-process UTC microsecond IDs; if its
clock moves behind the rover's saved ID, the rover rejects the older ID safely.
Restore the desktop clock rather than erasing duplicate history during recovery.

If power fails after journal reservation but before the UART handoff is marked
queued, the same ID is rejected with `HANDOFF_OUTCOME_UNKNOWN`. It is never
forwarded again automatically. Unavailable, invalid or failed NVS also fails
closed. Inspect rover/Mega state under HOLD and DISARM before explicitly
cancelling or preparing a different mission. Do not erase NVS merely to make a
retry succeed: that discards the duplicate guarantee.

The UART handoff is chunked while sensors and RC commands continue to be read.
Other outbound UART lines cannot be inserted inside `RCV:`; the latest real IMU
report is queued immediately afterward. Mega motor, obstacle and tilt-safety
routines and their thresholds are unchanged.

The journal guarantees **at most one UART handoff per V2 mission ID**, not
exactly-once Mega storage or execution. A radio ACK proves rover reception and
duplicate handling, not Mega persistence. Existing Mega status messages are
uncorrelated and not returned over this radio protocol. The app consequently
reports Mega storage and execution as unverified. Fresh telemetry is required
after desktop RX restoration, and arming/SEMI_AUTO remain manual operations.

## Repeatable checks

```powershell
# From apps/desktop
node --test tests/loraStatus.test.js
npm run build

# From apps/desktop/src-tauri
cargo check --locked
cargo test --locked --lib

# From repository root, with the existing ESP32 core and LoRa/TinyGPSPlus libraries installed
./embedded/tests/CheckMissionFirmware.ps1 -ArduinoCli arduino-cli

# Host C++ compiler on PATH; output goes to the ignored check directory
g++ -std=c++11 -Wall -Wextra -pedantic embedded/tests/mission_protocol_test.cpp -o .pio/mission-checks/mission_protocol_test
```

Run the resulting host executable. On Windows with MinGW, its compiler bin
directory must also be on PATH for compiler/runtime DLLs. The Rust mock transport
is in `mission_mock.rs` behind `cfg(test)`; it cannot supply application status
or emit hardware events. It covers all requested retry, loss, cancellation,
disconnect, identity and telemetry scenarios. Host C++ tests exercise the actual
shared firmware parser/journal decisions, including reset/stale/conflict cases.
Compilation and mocks do not replace bench validation of USB removal, SD mode
correction, RF loss and an ACK-lost retry with the rover secured and disarmed.

## Validation performed

- Frontend production build passed; the existing bundle-size warning remains.
- Frontend status/recovery tests: 21 passed.
- Rust check passed; 29 unit tests passed, including the separated mock transport
  and existing database tests. Existing unused `Read`/`State` import warnings remain.
- Shared C++ protocol assertions compiled and ran successfully with MinGW G++.
- Both real ESP32 sketches compiled using Arduino CLI, ESP32 core 3.3.11 and
  `esp32:esp32:esp32`, through `CheckMissionFirmware.ps1`.
- Rust formatting and Git diff whitespace checks passed. Changes were reviewed
  for scope; Mega, waypoint generation, database and sensor calculations were not edited.
- No firmware was flashed, no real mission was transmitted, and no bench or
  browser visual test was performed. No commit or push was made.

## Files changed in this update

Desktop backend:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/mission_deployment.rs`
- `apps/desktop/src-tauri/src/mission_protocol.rs` (new)
- `apps/desktop/src-tauri/src/mission_mock.rs` (new, test-only)

Operator UI and its tests:

- `apps/desktop/src/components/MissionDeploymentWizard.jsx`
- `apps/desktop/src/components/MissionDeploymentWizard.css`
- `apps/desktop/src/utils/loraStatus.js`
- `apps/desktop/tests/loraStatus.test.js`

Coordinated firmware and checks:

- `embedded/LoRa RX_All/RX_Board_code_w_movement.ino`
- `embedded/ArduinoUnoESP32 serial test/oct21ESP32SerialTest/oct21ESP32SerialTest.ino`
- `embedded/shared/MissionProtocol.h` (new)
- `embedded/tests/mission_protocol_test.cpp` (new)
- `embedded/tests/CheckMissionFirmware.ps1` (new)
- `docs/mission-upload-v2.md` (this document)

Other existing working-tree changes belong to the earlier deployment/status UI
work and were preserved. Generated firmware wrappers/builds are under ignored
`.pio/mission-checks/`.
