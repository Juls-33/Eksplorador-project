Eksplorador N1 / 3.1.0 RC arming diagnostic patch

Updated ONLY 01_Mega_2560/Mega_A3_0/RcSafety.h and RcMega.h.
No navigation commands, PWM rules, arming safety thresholds, or automatic rearm behavior changed.
The Rover and Desktop ESP32 folders are unchanged from the previous Arduino-ready package.

New RC diagnostic part /3:
  fresh = all six channels currently valid and fresh
  rear  = safety latch still requires deliberate rearm
  low   = a complete >=400ms centered DISARM hold qualified
  hold  = currently accumulating centered low hold duration in milliseconds
  badN  = off-neutral stick mask: 1=CH1 steering, 2=CH2 throttle, 4=CH4 actuator
  rej   = last failed LOW->HIGH arm attempt: 0=none, 1=no qualified >=400ms centered disarm hold, 2=sticks off-center

Diagnostic-only ARM_REJECTED event has ev bit 32. The latch's original fault cause is retained.

Procedure (drive and actuator power isolated initially):
  1) CH6 MANUAL, all sticks/actuator command exactly neutral, CH5 DISARM (around 1000 us).
  2) Hold at least 1 second; check [RC .../3] low=1 (can be delayed in USB log).
  3) Deliberately move CH5 ARMED (around 2000 us); check fresh=1 rear=0, STATE MANUAL.
  4) If rear stays 1, provide complete numbered [RC .../0..6] records, especially /3.

Compiling note: Host GCC tests of the production RcSafety.h passed for four scenarios.
The Mega AVR/Arduino board compiler was NOT available in this environment. Verify the Mega sketch in Arduino IDE before flashing. Leave motor power disconnected during first boot/arming tests.

Caution: This patch DOES NOT cure electrical PWM glitches, receiver brownouts, or inadequate motor supply.
