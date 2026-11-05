EKsplorador N1 / 3.1.0 — RC FAILSAFE AUDIT UPDATED — Arduino IDE upload package

SOURCE: the two most recently uploaded archives:
  1 Final Microcontroller Firmwares (unuploaded)(1).rar
  shared(1).rar

The 3 Arduino sketch folders are SELF-CONTAINED. Shared project headers were copied
from the real shared archive into each sketch folder (not forwarding headers).
The only source-text edits are switching a few #include <ProjectHeader.h> expressions
to #include "ProjectHeader.h" so Arduino IDE resolves local files. The navigation,
RC state machine, actuator logic, calibration, PWM values, timers, and code bodies
have not been modified.

IMPORTANT:
- Backup your existing working firmware and calibration BEFORE uploading.
- FIRST flash/test with drive MOTOR & ACTUATOR POWER DISCONNECTED. Keep valid
  controller/electronics power. Never let drive outputs unexpectedly move hardware.
- Arduino IDE: open the .ino in its exact matching folder; do not rename or move
  individual headers. Select Arduino Mega 2560 for Mega; classic ESP32 Dev Module
  for both ESP32 boards IF that matches your physical hardware.
- External libraries for ESP32: LoRa (Sandeep Mistry) and TinyGPSPlus (Mikal Hart).
- Coordinate all three microcontrollers to version 30100 (3.1.0).
- Existing calibration storage must not be erased. Loaded calibration is REQUIRED
  before autonomous motion, even if manual RC works.
- Uploaded source is NOT certified for actual motor hardware, signal integrity,
  receiver failsafe behavior, or stopping distance.
- RC diagnostic messages identify earlier pulse faults; fixes do not suppress
  genuine invalid PWM. The underlying electrical glitch is still unconfirmed.

VALIDATION IN THIS ENVIRONMENT:
- Extracted both archives successfully.
- Confirmed supplied shared RcSafety.h exactly matches Mega-local RcSafety.h.
- Verified all project header include paths and package file presence.
- Ran host g++ header smoke tests (see validation file).
- Full Arduino target compilation not available in this environment; Codex's
  report states board compiles passed before the packaging change.

If the original project produces an Arduino IDE error, do not force upload;
report the exact compiler error and board type.
