# Desktop drivetrain telemetry (A2.6 / A2.7)

Live Monitoring shows **Drivetrain Monitoring** after the soil KPI cards and
before the GIS/sampling workspace, with a signed RPM history chart beside the
diagnostics. Field Map keeps **Drivetrain Telemetry** in its details column,
between Mission Overview and Live Rover Telemetry. Both consume the exact same
cached encoder snapshot and timeout from one app-owned store. At narrower window
sizes, the chart and existing map/directory/details stack to stay readable. The card shows
signed gearbox RPM, rotation sign, cumulative ticks, invalid quadrature counts,
absolute-RPM difference, measurement freshness, desktop receipt time and encoder
sequence. No Data, Receiving, Stale, Disconnected and monitoring Unavailable are
separate display states.

A2.7 fusion RPM is now an explicit fallback. Fresh standalone ENC remains
authoritative; otherwise a fresh, valid FUS packet can supply **RPM only**. Both
views show the RPM source and separate **ENC counters** freshness. Tick counts,
errors and encoder sequence always come from ENC, remain absent before ENC is
received, and are labeled stale when ENC stops. See
[the A2.7 investigation](a27-drivetrain-investigation.md) for the actual receiver
capture, diagnostic switches, regression replay and remaining radio questions.

## Data flow and isolation

1. The existing Rust serial owner retains 115200 baud, its 100 ms read timeout,
   discovery/reconnect loop and command queue. Bounded newline framing retains
   partial bytes across timeouts and skips corrupt/oversized lines without a
   disconnect. Each read is limited to 1 KiB; a line is capped at 64 KiB.
2. `encoder_telemetry::classify` distinguishes encoder, fusion and sensor JSON
   independently. It supports bare JSON and anchored DATA:/ENC:/FUS: JSON,
   rejects mismatched prefix/type combinations, and never extracts JSON from
   `[RAW RX]` diagnostic echoes. Encoder validation precedes the sensor
   branch. Required numbers are validated without coercing strings, booleans or
   nulls. Sequence, error counters and transmit age are unsigned 32-bit integers;
   tick counts must be integers representable exactly in JavaScript. RPM is finite
   and signed. Missing or malformed encoder packets are ignored, including ones
   containing sensor-looking extras. Unknown JSON and non-JSON text are ignored.
3. Accepted encoder packets enter an in-memory stream and the `encoder-data`
   event. This branch cannot enqueue soil readings, emit `sensor-data`, update
   GPS/probe state or satisfy the mission assistant's sensor-telemetry gate.
   Sensor/error JSON continues through its existing branch with its payload
   unchanged, including the legacy 19-field sensor structure.
4. The stream timestamps native receipt, orders packets and coalesces bursts to
   the latest accepted reading at most 10 times per second. Its pending trailing
   packet is emitted even during read timeouts. There is no encoder SQL access.
   Fusion uses an independent sequence filter and `fusion-data` event with
   native receipt time. Its encoder RPM/validity/age fields are validated; it
   never modifies the standalone stream, soil buffer, mission telemetry gate or
   GPS/sensor events.
5. `App` calls `useEncoderTelemetrySource` once to own the persistent
   `encoderTelemetryStore`. This replaces the former Field Map-local subscription;
   there is one frontend subscription to each of `encoder-data` and `fusion-data`,
   with the existing single Rust serial owner. Freshness uses the same calculation
   for each independent source and retains the 3-second default timeout.
6. Both cards use `useEncoderTelemetry`/`useSyncExternalStore` to read that same
   cached snapshot. Only card consumers refresh at 10 Hz, without repainting App's
   maps/tables. Collection continues on every route, even while neither card is
   mounted. Navigation cannot reset the packet, timeout, history or freshness.
   Shared receiver changes publish before paint; USB loss masks RPM in both views
   and clears the current packet/history. Reconnection requires a new packet.
7. The source cleans up both event subscriptions and its timer when App unmounts;
   obsolete asynchronous registrations/events are discarded, including React
   StrictMode cleanup. Listener setup failures display Unavailable and an app
   reload instruction in either view. Encoder history remains in memory only.

`[RAW RX]` DATA/ENC echoes are excluded from frontend diagnostic traffic and
mission evidence to avoid high-frequency duplicate renders. Mission V2 raw
`ACK2` and `NACK2` lines still reach the existing mission handler. Mode/status,
mission and real error diagnostics keep their existing handling. No embedded
firmware, Mission V2 protocol code, SQLite schema, migrations or sensor fields
were changed. Historical encoder storage is intentionally absent.

## Freshness and direction

- Native receipt time is sent as `receivedAtMs`. Initial event delivery delay is
  included; subsequent desktop elapsed time uses `performance.now()` so a desktop
  wall-clock adjustment does not make retained readings fresh again.
- Minimum ENC age = `ageAtTransmitMs` + time since native receipt. Minimum FUS
  RPM age = `encoderAgeMs` + time since that fusion packet's native receipt.
  Unknown rover-to-desktop transit time is excluded. This is a lower bound on
  measurement age, not measured end-to-end latency.
- The initial stale threshold is 3 seconds; the card offers 3, 5 and 10 seconds
  for this application session, shared by both views. Changing it retains the current packet. The encoder
  freshness clock is independent of the sensor interval. Old-at-transmit packets
  can be stale immediately. No valid new packet means age keeps increasing.
- Stale/unavailable states hide RPM, direction and RPM difference. Retained
  counts and errors have their own stale/unavailable status and are explicitly
  identified as the last accepted ENC packet. Fresh FUS cannot refresh them.
- Fresh ENC has priority over FUS. Fusion fallback requires `encoderValid: 1`,
  finite left/right RPM, `fusionSeq` and nonnegative `encoderAgeMs`. An accepted
  `encoderValid: 0` disables that fallback without invalidating fresh ENC.
- Duplicate sequences do not extend freshness. Forward sequence progression and
  unsigned 32-bit wrap are accepted. Backward sequences are ignored until at
  least 3 seconds without accepted progress and two increasing backward packets
  observed within 3 seconds suggest a reboot. USB reconnection starts a fresh
  sequence epoch immediately. A sequence alone cannot distinguish every reboot
  from delayed/reordered old traffic; firmware has no boot identifier. No wire
  protocol changes were introduced to resolve that ambiguity.
  Each source owns its own sequence history; fusionSeq never deduplicates ENC.
- The checked-in Mega sketch calibrates raw tick forward signs as left `+1`,
  right `-1`. It does not define the new transmitted RPM sign normalization;
  the supplied example also has opposite tick signs and equal RPM signs. The
  card therefore reports Positive rotation, Negative rotation or Stopped, and
  does not infer Forward/Reverse. Confirm that mapping on hardware before adding
  vehicle-direction labels.
- RPM difference uses the absolute motor RPM values and their average, returning
  zero when the average is at most 0.1 RPM. It carries no performance grade.
  Encoder rotation is not a ground speed, odometry or distance measurement.

## Live RPM history

Live Monitoring adds a dependency-free SVG chart of signed left/right RPM over a
rolling 60-second window, capped at 600 points. Green solid and earth-brown dashed
traces distinguish the motors. Points use desktop receipt time on the existing
monotonic freshness clock; old source measurements are excluded from history.
History follows the selected RPM source and breaks traces on source changes.
Stale/unavailable gaps start new trace segments instead of interpolation, and
stale history is explicitly labeled as historical. History ages out and is cleared
on receiver disconnect/port change or app shutdown. Switching tabs retains it;
no encoder SQL writes, migrations or export records were added.

## Changed files

| File | Purpose |
| --- | --- |
| `src/App.jsx` | Own the single shared source and add the expanded Live Monitoring section. |
| `src/App.css` | Responsive soil KPI and GIS workspace columns below the new dashboard section. |
| `src-tauri/src/lib.rs` | Route serial packets, emit coalesced encoder events and quiet raw echoes; encoder-only traffic can identify the receiver during probing. |
| `src-tauri/src/encoder_telemetry.rs` | Typed DATA/ENC/FUS classification, independent ordering, reboot handling, coalescing and native regressions. |
| `src-tauri/src/serial_lines.rs` | Bounded serial framing, timeout retention and recovery from corrupt/oversized lines. |
| `src-tauri/examples/replay_telemetry.rs` | Replay the production framer/parser/streams without serial hardware. |
| `src/views/FieldMapView.jsx` | Mount the independent drivetrain card and apply scoped layout classes. |
| `src/views/FieldMapView.css` | Responsive Field Map columns and stacked layouts. |
| `src/components/DrivetrainTelemetry.jsx` | Same reusable card in compact Field Map and expanded dashboard modes; shared state/timeout and unique accessible heading IDs. |
| `src/components/DrivetrainTelemetry.css` | Existing compact styling plus responsive dashboard/chart styling using design tokens. |
| `src/components/RpmHistoryChart.jsx` | Lightweight signed RPM chart with gaps, accessible labels and historical-state indication. |
| `src/hooks/useEncoderTelemetry.js` | One app-owned source lifecycle plus read-only subscriptions to the shared store. |
| `src/services/encoderTelemetryStore.js` | Shared snapshots, one subscription per source, RPM fallback, independent counter freshness, bounded history and lifecycle handling. |
| `src/utils/encoderTelemetry.js` | Source validation and rejection reasons, monotonic freshness, direction and RPM difference calculations. |
| `src/utils/telemetryDiagnostics.js` | Temporary opt-in frontend diagnostics. |
| `tests/encoderTelemetry.test.js` | Calculations, freshness, real-card/chart rendering and distinct counter/RPM source display. |
| `tests/encoderTelemetryStore.test.js` | Shared snapshots, navigation, bounds, source priority/fallback, stale counters, disconnect and lifecycle tests. |
| `tests/serialTelemetryPipeline.test.js` | Actual Rust-to-store replay, actual receiver capture, mixed traffic and genuine absence of RPM sources. |
| `tests/fixtures/encoder-stream.jsonl` | Shared hardware-free stationary/rotating/signed/unequal/old/malformed/interleaved examples. |
| `tests/fixtures/mixed-fusion-stream.jsonl` | Synthetic alternating DATA/ENC/FUS regression including malformed lines and diagnostic echoes. |
| `tests/fixtures/actual-a27-receiver.log` | User-supplied desktop receiver capture, with no fabricated standalone ENC packets. |
| `scripts/check-drivetrain.mjs` | Real Chromium event/reconnect/layout and existing route smoke checks with an isolated mock Tauri bridge. |
| `docs/encoder-telemetry.md` | Integration decisions, file inventory, verification and hardware follow-up. |
| `docs/a27-drivetrain-investigation.md` | Evidence, diagnosis, fallback behavior, logging controls, replay instructions and scope of this fix. |

## Verification

From `apps/desktop`:

```powershell
node --test tests/*.test.js
npm run build
node scripts/check-drivetrain.mjs
cd src-tauri
cargo test --lib --offline
cargo check --offline
```

There is no TypeScript/typecheck script in this JavaScript application. Vite
builds the production frontend; Cargo checks the native types. No dependency
was added. Chromium can be selected with `CHROME_PATH`; it uses a temporary
browser profile, mock native commands and synthetic events, never the live
application database or a serial port. Screenshots are written to the temporary
directory printed by the script. Some sandbox environments require running this
browser check outside the sandbox for Chromium's renderer to start.

Verified results: **62 frontend tests passed**, **41 native library tests passed**,
production Vite build passed, `cargo check --offline` passed, and the Chromium
check passed at all three widths. The build reports its existing large-bundle
warning (approximately 711 kB for the main JavaScript bundle); Cargo reports the
existing unused `Read` and `State` imports in `lib.rs`. No remaining check errors
were observed. The sandbox initially prevented Chromium's renderer from starting;
the isolated browser check succeeded when run outside that sandbox.

Automated coverage includes stationary/rotating/negative/unequal RPM, malformed
and incomplete packets, immediate and elapsed stale states, recovery, interleaved
sensor/encoder classification, sequence duplicates/reordering/wrap/reboot, burst
coalescing, disconnect/reconnect and subscription cleanup. Store tests verify
identical snapshot identity for two subscribers and bounded history/rendering.
Chromium verifies both views retain identical readings and timeout on navigation,
freshness keeps advancing and background routes still receive encoder events,
and exactly one listener per encoder/fusion event stream remains active. Sensor/GPS cards remain unchanged
by encoder events and encoder events invoke no SQL writes. Both layouts are
checked at 1366/1024/800 pixels, along with GIS/dashboard/crop/report navigation.
Existing native tests cover database
migrations, merge/import rollback/persistence and Mission V2 command/ACK/retry/
recovery behavior.

## Hardware follow-up

Confirm the new firmware's RPM direction convention, real encoder cadence and
age distribution, actual LoRa DATA/ENC interleaving under load, serial removal
and device reboot behavior, and end-to-end GPS/soil geotagging during missions.
Validate mission deployment/execution with the actual radios and controller,
real sensor acquisition and saved samples, crop/heatmap results, SQL import/
export and PDF printing on the deployed Tauri/WebView application. Route smoke
checks and existing unit tests do not establish field accuracy or complete these
physical/integration checks. No real rover or serial device was used here.
