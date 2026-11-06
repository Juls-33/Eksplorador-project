EKSPLORADOR N1 / 3.1.0 — deliberate RC rearm UX adjustment

Mega-only functional change:
- RcSafety.h: minimum fresh, neutral CH5-low qualification reduced from 400 ms to 100 ms.
- Once qualified, clear any stale diagnostic arm-rejection reason.

Unchanged:
- All six RC channels must remain fresh (<=250 ms, PWM 850..2150 us).
- CH1/CH2/CH4 must be neutral (within 45 us of 1500).
- CH5 must be deliberately switched from DISARM (<1500 us) to ARM (>=1500 us).
- Any invalid/stale signal still latches the motors off. No auto rearm.
- RC faults, HOLD, actuator/IMU protection, navigation and ultrasonic interlocks untouched.

IMPORTANT:
- Verify Arduino IDE target is Arduino Mega 2560 for Mega_A3_0.ino.
- Only reflash Mega if Rover and Receiver already run matching N1/3.1.0 images.
- Power off motors and actuator for upload and first bench tests.
- Physically validate disarm/rearm and genuine RF-loss failsafe; short hold increases chance
  that an accidental low-high CH5 toggle can rearm when sticks are neutral.
- The captured log rej=2 was a prior off-center ARM rejection; badN=0 is current, not historical.
- This packaging has HOST C++ gate tests only, not a real AVR Arduino compile or powered test.
