# A2.7 drivetrain update investigation

## Confirmed evidence and diagnosis

The supplied rover capture includes `[ENC LoRa TX] seq=910` and `seq=911`, DATA
retries followed by `[ACK] 914`, and FUS transmissions. The supplied desktop
capture contains **two decoded sensor JSON packets, one decoded fusion JSON
packet, and zero standalone encoder JSON packets**. Its final `[RAW RX]: FUS:913`
is a diagnostic CSV echo with no corresponding decoded JSON in the supplied
excerpt. The exact desktop capture is saved in `tests/fixtures/actual-a27-receiver.log`.

The prior app intentionally ignored `type: "fusion"`. Consequently, when standalone
ENC stopped arriving, it had no permitted source for new RPM even though FUS
carried valid current RPM (`encoderValid:1`, `encoderAgeMs:237`). Its ENC stale
indicator was accurate for that absent source. This was an application support
gap, not evidence that valid ENC JSON was being overwritten by FUS or deduplicated
against fusionSeq.

An additional synthetic regression reproduced a parser compatibility gap: the
old parser accepted the initial bare ENC JSON but dropped later `ENC: {...}`
lines, producing only sequence `[170]` rather than `[170..176]`. This was verified
with a failing test before the parser change. **The actual supplied capture uses
bare JSON**, so prefix compatibility is a separate hardening fix, not the cause
established for that capture.

The logs cannot establish why standalone ENC is absent at the receiver. Radio
loss, RX-window/scheduling contention during DATA retries/ACKs, and receiver-side
handling remain possibilities. A rover TX diagnostic alone does not prove that
the desktop radio received and decoded that packet; DATA ACK 914 confirms DATA,
not ENC 910/911. There are no aligned timestamps, per-type RX counters, complete
capture window or updated A2.7 firmware sources here to isolate that link issue.
No firmware or wire protocol was changed.

## Complete pipeline after the fix

1. The existing single USB serial owner retains port discovery, 115200 baud,
   100 ms timeout, radio commands and Mission V2 ACK handling. `SerialLines`
   retains partial lines across timeouts, reads bounded chunks, and skips invalid
   UTF-8/oversized lines without losing subsequent messages or reconnecting.
2. The classifier recognizes bare JSON and anchored DATA:/ENC:/FUS: JSON. It
   never parses the JSON/CSV inside bracketed diagnostics. Malformed JSON and
   prefix/type mismatches receive explicit diagnostic rejection reasons.
3. Sensor JSON follows the existing sensor event/soil buffer pipeline unchanged.
   Its legacy fields and existing RSSI/SNR metadata are preserved. Fusion is
   never emitted as sensor data and cannot create soil rows, move GPS or unlock
   the mission assistant's sensor-telemetry gate.
4. Valid standalone encoder packets retain their own sequence filter and 10 Hz
   coalescing. Valid fusion packets use a **separate** sequence filter, validity
   checks and `fusion-data` event. Each source is timestamped at native receipt;
   duplicates/reordering do not extend its measurement freshness. Existing wrap
   and conservative reboot recovery behavior is retained independently per source.
5. The existing app-owned store subscribes once to each event stream, not once
   per view. Both views read the exact same cached snapshot. Source registration
   is independent so a failed fusion listener does not stop working ENC reception.
   Navigation opens no extra serial readers and does not re-register listeners.
6. The shared store maintains separate monotonic freshness clocks. Minimum ENC
   age uses ageAtTransmitMs; minimum fusion RPM age uses encoderAgeMs. Native-to-UI
   delay and desktop elapsed time are added to each. Unknown radio transit time
   is excluded. The default stale threshold is still **3000 ms**.

## RPM versus counter authority

| State | RPM display | Counter display |
| --- | --- | --- |
| Fresh ENC | ENC RPM; source `Standalone ENC` | ENC ticks/errors/sequence and own freshness |
| ENC stale/absent, fresh valid FUS | FUS RPM; source `Fusion fallback`, fusion sequence and RPM age | Last ENC counters explicitly Stale, or dashes/No Data before any ENC |
| FUS encoderValid=0 | FUS fallback disabled; fresh ENC remains usable | Unchanged ENC authority/freshness |
| Both RPM sources stale/absent | RPM and direction hidden; Stale/No Data/Unavailable | Last ENC readings keep their own status |
| USB disconnected | Live RPM unavailable, source state reset | Cleared; no replay on reconnect |

Fusion RPM never populates leftTicks, rightTicks, invalidL, invalidR or encoderSeq.
Fresh FUS cannot make stale counters appear current. RPM difference uses both
signed RPM fields from the **same selected packet**, applying absolute values as
before. Fresh ENC automatically regains priority. History stays bounded to 60
seconds/600 points, records only fresh selected RPM and breaks at source changes
and stale gaps. There are no added database writes.

## Temporary diagnostic logging

Diagnostics are opt-in to avoid blocking normal serial reception with console I/O.
For native raw/parse/classification/filter/emission logs, start a fresh dev process
from `apps/desktop`:

```powershell
$env:EKSPLORADOR_TELEMETRY_DEBUG = '1'
npm run tauri -- dev
```

Native stderr stages include `[telemetry:raw]`, `json_parsed`, `classified`
(encoder/fusion/sensor), `encoder_updated`, `encoder_emitted`, `fusion_updated`,
and `rejected`. Rejections distinguish invalid JSON/numbers, duplicate source
sequence, out-of-order sequence, prefix/type mismatch, invalid UTF-8, oversized
line and event delivery failures. Counter resets have a separate `sequence_reset`
trace. There is no unbounded in-app log buffer or log database.

In the app's DevTools console, enable frontend diagnostics:

```javascript
sessionStorage.setItem('eksplorador.telemetryDebug', '1');
```

Console output distinguishes `encoder_state_updated`, `fusion_rpm_updated`,
`rpm_source_selected`, and `rejected` with the offending field/lifecycle reason.
It includes source sequence, RPM, reported age and native receipt timestamp.

Disable frontend logging with `sessionStorage.removeItem('eksplorador.telemetryDebug')`.
Disable native logging with `Remove-Item Env:EKSPLORADOR_TELEMETRY_DEBUG` and restart
the app (the native switch is cached per process). Normal operation is quiet by
default; the temporary hooks can be removed after on-hardware diagnosis.

## Regression replay and checks

From `apps/desktop`:

```powershell
node --test tests/*.test.js
node scripts/check-drivetrain.mjs
npm run build
cd src-tauri
cargo test --all-targets --offline
cargo check --offline
cargo run --offline --example replay_telemetry -- ../tests/fixtures/actual-a27-receiver.log
```

The Node pipeline test runs the production Rust framing/classifier/filters via
the replay example, then feeds its serialized events into the real shared store
under an injected monotonic clock. It does not substitute a JavaScript parser.
It proves increasing `[170..176]` sequences and changing RPM under alternating
DATA/ENC/FUS traffic, fresh FUS fallback from the exact capture with missing ENC
counters, genuine staleness when both RPM streams stop while sensor data continues,
and live RPM with separately stale counters when only FUS continues. The replay
does not open serial ports, initialize the app or touch its database.

Chromium tests verify both views, actual-log fallback, stale-counter labels, ENC
priority, malformed/invalid-fusion isolation, GPS/soil independence, absence of
SQL writes, and stable listener registrations on navigation. Existing Mission V2
and SQLite regression tests remain included. No TypeScript/typecheck script
exists in this JS app; Vite and Cargo provide the applicable build/type checks.

Validation passed: **62 frontend tests**, **41 native library tests**, **12 replay
target tests**, production Vite build, Cargo check, and Chromium checks for both
views at 1366/1024/800 pixels. The existing large-bundle warning (about 711 kB)
and unused native `Read`/`State` imports remain. No new check errors remain.

## Files changed for this investigation

| File | Change |
| --- | --- |
| `src-tauri/src/lib.rs` | Bounded framing, separate fusion event routing/receipt stamping and emission diagnostics. |
| `src-tauri/src/encoder_telemetry.rs` | Independent DATA/ENC/FUS classification, separate fusion validation/sequence filter, explicit rejection logs and native regressions. |
| `src-tauri/src/serial_lines.rs` | New bounded, timeout-safe and corrupt-line-safe framer plus tests. |
| `src-tauri/examples/replay_telemetry.rs` | Hardware-free replay using the production pipeline modules. |
| `src/services/encoderTelemetryStore.js` | Shared RPM fallback selection, independent ENC counter freshness, one subscription per source, history source gaps and diagnostics. |
| `src/utils/encoderTelemetry.js` | Field-specific rejection reasons and a separate fusion RPM freshness monitor. |
| `src/utils/telemetryDiagnostics.js` | Opt-in frontend diagnostic output. |
| `src/components/DrivetrainTelemetry.jsx` | Visible RPM source/age/fusion sequence, distinct counter status/age, no fabricated missing values. |
| `src/components/DrivetrainTelemetry.css` | Counter status divider using existing design tokens. |
| `src/components/RpmHistoryChart.jsx` | Explain selected ENC/FUS RPM history and source-change gaps. |
| `tests/encoderTelemetry.test.js` | Rendering tests for fresh fusion versus stale/missing counters. |
| `tests/encoderTelemetryStore.test.js` | Fallback/priority/invalid-source and listener-isolation regressions. |
| `tests/serialTelemetryPipeline.test.js` | Rust-to-frontend replay and genuine absence regressions. |
| `tests/fixtures/mixed-fusion-stream.jsonl` | Synthetic interleaving regression fixture. |
| `tests/fixtures/actual-a27-receiver.log` | Exact supplied receiver capture (whitespace normalized). |
| `scripts/check-drivetrain.mjs` | Actual-log UI regression and listener-registration checks. |
| `docs/encoder-telemetry.md` | Updated integrated behavior and validation notes. |
| `docs/a27-drivetrain-investigation.md` | This diagnosis, diagnostic controls and handoff. |

## Remaining hardware investigation

Collect synchronized, timestamped rover TX and receiver RX logs for the same
window. Compare ENC/FUS/DATA counts and sequences, TX completion or failure,
receiver decode failures, radio modes and ACK-wait/retry intervals. This will
distinguish packets not transmitted, not received and received but not decoded.
Exercise ENC recovery and sequence resets on the real radios; repeat GPS/soil
acquisition, geotagged persistence and mission-control checks. The app fallback
cannot recover missing cumulative counts or prove a radio scheduling diagnosis.
