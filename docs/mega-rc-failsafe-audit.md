# Mega RC failsafe audit and diagnostics

The observed fresh=1 rearmRequired=1 disarmObserved=0 means the six PWM inputs
currently qualify, but a prior loss/invalid input or startup/disarm condition has
left authorization latched off. CH5 at 1980-2000 us and CH6 at 1000 us are valid
ARMED/MANUAL values; they do not identify which earlier input caused the latch.
The original code discarded invalid widths and zeroed their last-valid timestamps,
so that console line cannot establish the actual offending channel or root cause.
No firmware was flashed and no electrical timing or RF link was measured here.

## Audit findings

| Input | Mega pin | External interrupt | Role |
| --- | --- | --- | --- |
| CH1 | 18 | INT3 | Steering |
| CH2 | 19 | INT2 | Throttle |
| CH4 | 20 | INT1 | Actuator |
| CH5 | 21 | INT0 | Arm/disarm |
| CH6 | 2 | INT4 | Manual/HOLD/semi-auto |
| CH8 | 3 | INT5 | Rover LoRa role |

All six use CHANGE interrupts and now call the same tested capture routine.
There is no channel-specific validity policy. Width acceptance remains inclusive
850..2150 us; freshness remains <=250 ms for EVERY channel. Neutral remains
strictly within 45 us of 1500 on CH1/CH2/CH4. Disarm remains CH5<1500; qualification
requires 400 continuous ms of fresh, neutral, disarmed input. Mode thresholds
1300/1700 and all drive/actuator/navigation interlocks are unchanged.

Findings and corrections:

* Previously, an invalid falling edge erased both pulse and last-valid time.
  Capture now retains the full 32-bit offending width, last-good width/time,
  whether a valid pulse has ever been seen, and a saturating invalid count.
  A falling edge without an observed rise, or a repeated rise without a fall,
  is explicitly UNPAIRED_EDGE, including
  attaching an interrupt partway through a pulse. It never authorizes motion.
* A bad pulse could recover before the loop observed it. The first bad edge is
  now sticky until atomically consumed by the safety decision, with a channel
  mask for additional faults. A valid CH5 disarm transition between loops is
  likewise retained. These changes strengthen fail-closed behavior; there is no
  debounce, glitch tolerance or silent auto-rearm.
* The old loop copied channels BEFORE sonar/soil/serial work and checked their
  ages AFTER that work. This could falsely age the old copies despite ongoing
  valid ISR updates. The new decision takes one coherent snapshot immediately
  after that work, with its own time captured under the same interrupt lock.
  Actual >250 ms gaps are still faults, including a gap that recovers during a
  blocked foreground loop. Valid pulses at millis()==0 are distinguished from
  never-seen channels; unsigned rollover is covered by tests.
* The old rearm state could retain a qualified disarm after ARM went high with
  off-center sticks, then rearm when the operator centered later. ARM-high now
  consumes that observation even if unsuccessful. Return to neutral disarm for
  a fresh 400 ms qualification, then arm deliberately while neutral.
* Unauthorized outputs are stopped before any diagnostic/mode-message output.
  Existing RC loss cancels navigation, and its separate physical HOLD-to-SEMI_AUTO
  start gate, gyro/GPS/encoder handling, soil logging and actuator/tilt safety
  remain. Neither restored PWM nor restored GPS restarts the discarded route.
* The old aggregate RC STATUS could say OK when only the most recently active
  channel was fresh. It now reports ALL_FRESH/INPUT_FAULT from the six-channel
  gate, and explicitly displays rearmRequired/disarmObserved.

## Reading the diagnostic log

USB Serial Monitor remains 115200 baud. There is no new radio/DATA protocol.
One record is seven complete lines with a shared identifier, for example:

    [RC 12/0] t=5432 c=INVALID_PULSE ch=8
    [RC 12/1] us=700 age=20 at=5425
    [RC 12/2] edge_us=5425000 bad=0 pend=32 ev=1
    [RC 12/3] fresh=0 rearm=1 low=0 drop=0
    [RC 12/4] gap=42000 sensor=25100 esp=900
    [RC 12/5] tail=6000 irqoff=80 isr=16
    [RC 12/6] usb=100 maxgap=42000 err=1

These values are illustrative, not hardware measurements. Existing diagnostics
can appear BETWEEN parts; each part is a complete, nonblocking USB line.
Identifiers wrap at 65536. Keep all parts, including the initial boot records.

* t: decision time in milliseconds since boot. c/ch: retained originating
  cause and actual channel number (0 means no specific startup channel).
* us: full measured invalid width, or last-good width for a stale input.
  UNPAIRED_EDGE uses 0 for an unmatched fall, or elapsed time since the prior
  unmatched rise; neither is a trustworthy complete PWM width.
* age: age of the last valid pulse when evidence was captured/first evaluated,
  in ms. 4294967295 means no valid pulse had yet been seen. It is retained
  evidence, not the current channel age on every later summary.
* at: time the fault/disarm was observed in ms. For a stale input, it is the
  derived first violating instant (last valid time +251 ms), not the later log
  print time. edge_us: observed invalid/disarm edge time, or an approximate
  derived stale time, modulo uint32 microseconds. Timer0 has 4 us resolution;
  software edge timestamps include ISR service latency and are not scope traces.
* bad: channels currently invalid/unseen/stale; pend: transient channels
  retained since the last decision. Bits 0..5 are CH1, CH2, CH4, CH5, CH6, CH8;
  pending bit 6 denotes a valid CH5 disarm transition. Thus pend=32 means CH8.
  bad=0 with pend!=0 can explain a glitch that has already recovered.
* ev bits: 1 new latch/startup, 2 neutral disarm qualified, 4 deliberate rearm
  succeeded, 8 input freshness restored, 16 current bad-channel mask changed.
  A record with ev=0 is a periodic retained-latch summary. Later mask changes
  do not overwrite the first cause of a continuing fault episode. The valid
  CH5 disarm cause is DISARM_INPUT; this identifies the signal, not whether a
  human deliberately moved the switch or the receiver generated that pulse.
* fresh/rearm/low: current gate freshness, rearm latch and disarm qualification.
  low is disarmObserved, not simply the electrical CH5 switch level.
* gap: time between RC safety decisions, in us. sensor: current sonar/current/
  Modbus section; esp: current ESP UART processing/status section; usb: current
  USB setup-command/telemetry service; tail: previous decision-to-end work before
  the existing 10 ms loop delay. maxgap is the largest decision gap observed.
* irqoff: largest measured runtime encoder/RC snapshot interrupt-disabled
  section, in us. isr: maximum RC capture-handler body duration observed, in us
  (excludes vector entry/exit and initial digitalRead). Neither measures the
  time an external edge waited for CPU service. err is the originating channel's
  saturating invalid-pulse count at record capture. drop counts records omitted
  by the bounded diagnostic queue. Counters saturate at 65535.

Causes are STARTUP, INVALID_PULSE, UNPAIRED_EDGE, STALE_CHANNEL and DISARM_INPUT.
Simultaneous/near-simultaneous sources are reported in MCU observation order,
with masks; these records cannot determine the earlier RF/electrical root cause.
The first missing channel at startup is not evidence that its wiring is faulty.
A received valid low arm pulse is disarm evidence, not proof of operator intent.

The logger has six fixed queued records and a 64-byte formatting buffer. No
String, heap allocation, delay, flush or print occurs in any RC ISR. At most one
complete line (<=63 bytes) is submitted after motor handling per loop, and only
when Serial.availableForWrite() can hold all of it. Queue overflow counts loss
explicitly and does not affect safety decisions. Sustained repeated bad input
keeps its first latch rather than flooding a new latch event every pulse. This
is bounded diagnostics, not a complete persistent edge recorder.

## Timing contributors and remaining hardware work

The code alone does not prove that interrupt latency caused this incident.
Existing foreground blocks include sonar pulseIn(...,25000), the eight-byte
Modbus request flush at 9600 baud, Serial2 sensor/status output at 9600 baud,
EEPROM setup writes while disarmed, USB debug prints, and the 10 ms loop delay.
Sonar's 25 ms wait alone is below the 250 ms policy and ordinarily leaves PWM
interrupts enabled. Foreground serial waits can accumulate; they do not normally
stop RC ISRs, but previously made the pre-work snapshot artificially old. Runtime
phase/gap metrics now expose correlations without extending any timeout.

The quadrature ISR and other Arduino interrupt services can delay RC edge
handling; overloaded interrupts, electrical noise, ground disturbance, a receiver
brownout or missing edges can also produce invalid widths. The encoder snapshot
now restores the caller's SREG rather than unconditionally enabling interrupts.
Runtime snapshot masking is measured. Timer0 and these software measurements
cannot prove worst-case latency or correct timekeeping across long periods of
interrupt starvation; use external instrumentation.

Before installing any updated image, preserve existing calibration and firmware
artifacts. This change does not alter the EEPROM calibration format or addresses.
Then use the team's normal deliberate flashing procedure; no script here flashes:

1. With drive power isolated/rover restrained and probe safe, capture the complete
   USB log from boot. Confirm startup requires neutral disarm >=400 ms then arm.
2. With a logic analyzer, monitor all six PWM lines at the Mega pins and receiver
   supply/ground. Compare actual invalid/stale edges against at/edge_us and the
   first c/ch record. Check common ground, receiver power under actuator/motor
   load, connector integrity and PWM endpoints. Pins 18/19 share Serial1 and
   20/21 share I2C alternate functions; verify no competing wiring/peripheral.
3. Verify transmitter-off failsafe electrically. No-pulse output must latch
   stale loss. Disarmed receiver output must disable motion. A receiver holding
   valid ARMED PWM is NOT detectable as RF loss from these six wires; configure
   no-pulse or disarmed failsafe and verify it with the RadioMaster Pocket off.
4. Inject a controlled invalid pulse or briefly disconnect each channel with
   motor power isolated. Confirm the named channel, width/age, stopped outputs
   and retained latch after valid pulses return. No physical automatic rearm.
5. Verify all three sticks must stay neutral during the 400 ms disarm hold.
   Try an off-center ARM-high attempt, then center while still armed: it must
   remain latched. Re-disarm/qualify/arm deliberately to recover.
6. Repeat with existing sensor/LoRa/encoder activity, recording gap/sensor/esp/
   usb/tail/irqoff/isr. Check loaded stopping delay and stack/heap headroom on the
   Mega before short ground trials. Do not infer stop latency from compilation
   or a host test. Recheck manual, actuator, tilt, obstacle and navigation gates.

No timeout has been extended and no transient is ignored. If the log proves
real PWM glitches, their electrical/receiver cause still needs correction;
this update deliberately keeps those glitches fail-closed.

## Verification and exact source inventory

Run embedded/tests/CheckNavigation.ps1 -HostOnly for production capture/rearm and
navigation/receiver C++ tests. Without -HostOnly it also compiles all three
firmware targets. npm test includes both host executables and the existing Rust
protocol/serial replay integration. cargo test --locked --offline covers native
mission/status/database regressions. No command opens a board or flashes.

RC tests exercise every input, inclusive validity boundaries, >16-bit widths,
unpaired edges, first-event retention, invalid-then-valid between decisions,
250/251 ms stale boundary, real no-pulse loss/recovery, valid held ARMED PWM,
receiver disarm output, qualified recovery, non-neutral arm rejection, pulses
at time zero, millis/micros wrap, blocked-loop stale recovery versus continuously
fresh ISR updates, serial backpressure, bounded queue overflow and maximum-width
log formatting. Actual hardware stop behavior remains untested.

Files changed for this RC task only:

* embedded/shared/RcSafety.h: production shared capture, first-event evidence,
  six-channel freshness and explicit rearm state machine.
* embedded/libraries/EksploradorNavigation/src/RcSafety.h: Arduino wrapper for
  the same shared module used by host tests.
* embedded/1 Final Microcontroller Firmwares (unuploaded)/mega/Mega_A3_0/
  RcMega.h: Mega ISR adapter, atomic snapshot, timing metrics and bounded USB log.
* Same directory, Mega_A3_0.ino: six thin ISR handlers, snapshot at decision,
  shared gate integration, immediate unauthorized stop, aggregate status fix,
  encoder snapshot SREG restoration and timing hooks.
* embedded/tests/rc_safety_test.cpp: production-module and Mega-logger tests.
* embedded/tests/CheckNavigation.ps1: compile/run RC regression with navigation.
* apps/desktop/tests/embeddedNavigationIntegration.test.js: run both C++ suites
  on supported Windows/G++ paths before existing receiver-to-Rust/UI replay.
* docs/mega-rc-failsafe-audit.md: this report and remaining physical checks.
* docs/mission-a3.0-desktop.md: link to the RC audit and updated Mega build result.

Final verification:

| Check | Result |
| --- | --- |
| Production RC capture/rearm and bounded Mega logger host regressions | Passed |
| Production navigation/calibration/receiver C++ simulations | Passed |
| npm test | 145 passed, none failed/skipped; includes both C++ executables |
| cargo test --locked --offline | 55 passed; binary/doc targets passed |
| Mega AVR 1.8.8 compile | Passed; 59926 B flash / 4609 B static RAM (3583 B left for stack/heap) |
| Rover ESP32 3.3.11 compile | Passed; 349520 B flash / 25324 B static RAM |
| Receiver ESP32 3.3.11 compile | Passed; 317316 B flash / 22796 B static RAM |
| git diff --check and added-text whitespace check | Passed |

Arduino builds use the existing local navigation library and LoRa/TinyGPSPlus
versions recorded in the mission report. USB logging latency, ISR timing under
loaded encoder interrupts, stack/heap margin and physical stops require hardware
checks. Existing Rust unused-import/diagnostic dead-code warnings remain.
Earlier unrelated working-tree changes, firmware archive files and removed A2.9
folders are retained. No image was flashed or physical RF/motor test performed.
