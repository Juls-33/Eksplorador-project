#include <stdlib.h>
#include <math.h>
// =================================================================
// ARDUINO MEGA 2560 - ROVER FIRMWARE
// WITH BTS7960 ACTUATOR CURRENT-SENSE MONITORING
//
// Serial Monitor: 115200 baud
// ESP32 Communication: Serial2 at 9600 baud
//
// Motors: ENABLED
// Current Monitoring: ENABLED
// Automatic Overload Protection: DISABLED (Calibration Mode)
//
// ACTUATOR CURRENT SENSING:
// BTS7960 R_IS + L_IS -> Arduino Mega A0
// Sense resistor -> Common GND
//
// WARNING: Verify A0 remains within 0-5V.
// =================================================================


// ---------------------- PIN ASSIGNMENTS --------------------------

const uint8_t PIN_CH1_STEER    = 18;
const uint8_t PIN_CH2_THROTTLE = 19;
const uint8_t PIN_CH4_ACTUATOR = 20;
const uint8_t PIN_CH5_ARM      = 21;
const uint8_t PIN_CH6_MODE     = 2;
const uint8_t PIN_CH8_LORA     = 3;


// BTS7960 Driver 1 (Left Drive Motor)
const uint8_t PIN_L_RPWM = 9;
const uint8_t PIN_L_LPWM = 4;


// BTS7960 Driver 2 (Right Drive Motor)
const uint8_t PIN_R_RPWM = 5;
const uint8_t PIN_R_LPWM = 6;


// BTS7960 Driver 3 (Linear Actuator)
const uint8_t PIN_ACT_RPWM = 7;
const uint8_t PIN_ACT_LPWM = 8;


// BTS7960 Current-Sense Input
const uint8_t PIN_ACT_SENSE = A0;


// HC-SR04 Ultrasonic Sensor
const uint8_t PIN_TRIG = 11;
const uint8_t PIN_ECHO = 12;


// ---------------------- CONFIGURATION ---------------------------

const uint16_t RC_MIN      = 1000;
const uint16_t RC_MID      = 1500;
const uint16_t RC_MAX      = 2000;
const uint16_t RC_DEADZONE = 45;

const uint32_t SIGNAL_TIMEOUT = 250;

const unsigned int OBSTACLE_DISTANCE_CM = 25;
const unsigned long PING_INTERVAL_MS = 40;

const int AUTO_DRIVE_SPEED = 180;


// ---------------- ACTUATOR SENSING CONFIG -----------------------

// Keep FALSE while calibrating the sensor.
// Set TRUE only after determining a safe ADC threshold.
const bool ENABLE_OVERLOAD_PROTECTION = false;

// Placeholder only. NOT a calibrated threshold.
const int ACTUATOR_OVERLOAD_ADC = 800;

// Require sustained high current before stopping.
const unsigned long OVERLOAD_CONFIRM_MS = 300;

// Current-sense sampling interval.
const unsigned long SENSE_INTERVAL_MS = 20;

// Serial reporting interval.
const unsigned long TELEMETRY_INTERVAL_MS = 250;

// Mega default ADC reference is nominally 5V.
// Change if measured reference differs.
const float ADC_REFERENCE_VOLTAGE = 5.0;


// -------------------- RC INTERRUPT VARIABLES --------------------

volatile uint32_t ch1_start = 0, ch1_pulse = 0;
volatile uint32_t ch2_start = 0, ch2_pulse = 0;
volatile uint32_t ch4_start = 0, ch4_pulse = 0;
volatile uint32_t ch5_start = 0, ch5_pulse = 0;
volatile uint32_t ch6_start = 0, ch6_pulse = 0;
volatile uint32_t ch8_start = 0, ch8_pulse = 0;

volatile uint32_t last_rc_time = 0;


// ------------------------- STATES -------------------------------

enum SystemState {
  STATE_NO_SIGNAL,
  STATE_DISARMED,
  STATE_MANUAL,
  STATE_HOLD,
  STATE_SEMI_AUTO
};

SystemState currentState = STATE_NO_SIGNAL;


// ---------------------- GLOBAL VARIABLES -----------------------

unsigned int currentObstacleDist = 999;

unsigned long lastPingTime = 0;
unsigned long lastTelemetryTime = 0;
unsigned long lastSenseTime = 0;

HardwareSerial& espSerial = Serial2;

bool espInTxMode = true;


// Auto Mission
String missionSequence = "";
String currentCommand = "";

bool missionActive = false;

unsigned long missionTimerStart = 0;
unsigned long missionTimerDuration = 0;


// Motor Debug Values
int debugLeftMotorPwm = 0;
int debugRightMotorPwm = 0;
int debugActuatorPwm = 0;


// ---------------- ACTUATOR SENSE VARIABLES ----------------------

int actuatorSenseRaw = 0;

int actuatorSenseAvg = 0;
int actuatorSensePeak = 0;
int actuatorSenseMin = 1023;

float actuatorSenseVoltage = 0.0;

unsigned long senseSampleSum = 0;
unsigned int senseSampleCount = 0;

int senseWindowMin = 1023;
int senseWindowMax = 0;

bool actuatorOverload = false;
bool overloadTiming = false;

unsigned long overloadStartTime = 0;


// ---------------- IMU TILT SAFETY -------------------------------
// ESP32 sends IMU:pitch,roll,valid at 20Hz on Serial2.
// Thresholds are starting values ONLY: verify axes and tilt behavior
// with actuator power disconnected before enabling powered tests.
const float TILT_STOP_DEG = 5.0f;
const float TILT_EMERGENCY_DEG = 9.0f;
const unsigned long TILT_CONFIRM_MS = 120;
const unsigned long IMU_TIMEOUT_MS = 350;
const unsigned long RESET_NEUTRAL_MS = 700;

// TIMED RETRACTION CANNOT RETURN TO AN EXACT POSITION.
// Leave FALSE until you verify positive PWM is DOWN and negative is UP,
// and confirm that reverse motion is safe in your mechanical assembly.
const bool ENABLE_BOUNDED_RETRACTION = true;
const int RETRACT_PWM = 90;
const unsigned long MANUAL_RETRACT_MS = 150;
const unsigned long AUTO_RETRACT_MS = 350;
// Auto re-enable only after returning close to the PRE-FAULT baseline,
// holding the manual stick neutral, and receiving fresh IMU samples.
const float RECOVERY_SETTLED_DEG = 2.0f;
// Operator-requested reverse after a tilt fault: ONE limited pulse per
// left-stick press. Return stick to neutral to request another pulse.
const int MANUAL_FAULT_REVERSE_PWM = 80;
const unsigned long MANUAL_FAULT_REVERSE_MS = 220;
const float MAX_REVERSE_TILT_INCREASE_DEG = 1.5f;
const unsigned long RECOVERY_NEUTRAL_MS = 900; // require stable, neutral and baseline restored

enum RecoveryState { REC_NONE, REC_RETRACT, REC_LATCHED };
RecoveryState recoveryState = REC_NONE;
float imuPitch = 0, imuRoll = 0;
float basePitch = 0, baseRoll = 0;
unsigned long lastImuMs = 0, tiltStartMs = 0, recoveryStartedMs = 0;
unsigned long resetNeutralSince = 0;
bool imuValid = false, tiltPending = false, downBaselineCaptured = false;
bool safetyLatched = false;
bool recoveryCompleted = false;
bool faultReverseNeedsNeutral = false;
bool faultReverseActive = false;
unsigned long faultReverseStartedMs = 0;
float faultReverseStartMagnitude = 0.0f;
char serialLine[90];
uint8_t serialLen = 0;
int lastRequestedActuator = 0;
SystemState faultOrigin = STATE_NO_SIGNAL;

bool imuFresh() { return imuValid && lastImuMs != 0 && millis() - lastImuMs <= IMU_TIMEOUT_MS; }
float pitchDelta() { return imuPitch - basePitch; }
float rollDelta() { return imuRoll - baseRoll; }
void processEspLine(const char *line);
void readEspLines();
void updateTiltSafety(SystemState state, uint16_t armPulse, uint16_t actuatorRaw);
void latchTiltFault(const char *reason);
void performRecovery();
void processFaultManualReverse(uint16_t actuatorRaw);
void actuatorOutput(int speed);

// ------------------- FUNCTION DECLARATIONS ----------------------

void setMotorSpeed(uint8_t rpwmPin, uint8_t lpwmPin, int speed);

void stopDriveMotors();
void stopActuator();
void stopAllOutputs();

void updateUltrasonicDistance();

void updateActuatorCurrentSense();
void checkActuatorOverload();
void printActuatorCurrentSense();

void processManualDrive(uint16_t throttleRaw, uint16_t steerRaw);
void processManualActuator(uint16_t actRaw);

void processAutoDrive();
void fetchNextAutoCommand();
void executeAutoCommand();

void printDebugTelemetry(
  uint16_t ch1,
  uint16_t ch2,
  uint16_t ch4,
  uint16_t ch5,
  uint16_t ch6,
  uint16_t ch8,
  uint32_t lastSig
);


// =================================================================
// INTERRUPT SERVICE ROUTINES
// =================================================================

void isrCh1() {
  if (digitalRead(PIN_CH1_STEER) == HIGH)
    ch1_start = micros();
  else {
    ch1_pulse = micros() - ch1_start;
    last_rc_time = millis();
  }
}

void isrCh2() {
  if (digitalRead(PIN_CH2_THROTTLE) == HIGH)
    ch2_start = micros();
  else {
    ch2_pulse = micros() - ch2_start;
    last_rc_time = millis();
  }
}

void isrCh4() {
  if (digitalRead(PIN_CH4_ACTUATOR) == HIGH)
    ch4_start = micros();
  else {
    ch4_pulse = micros() - ch4_start;
    last_rc_time = millis();
  }
}

void isrCh5() {
  if (digitalRead(PIN_CH5_ARM) == HIGH)
    ch5_start = micros();
  else {
    ch5_pulse = micros() - ch5_start;
    last_rc_time = millis();
  }
}

void isrCh6() {
  if (digitalRead(PIN_CH6_MODE) == HIGH)
    ch6_start = micros();
  else {
    ch6_pulse = micros() - ch6_start;
    last_rc_time = millis();
  }
}

void isrCh8() {
  if (digitalRead(PIN_CH8_LORA) == HIGH)
    ch8_start = micros();
  else {
    ch8_pulse = micros() - ch8_start;
    last_rc_time = millis();
  }
}


// =================================================================
// SETUP
// =================================================================

void setup() {

  Serial.begin(115200);
  espSerial.begin(9600);

  while (!Serial && millis() < 2000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("       EKSPLORADOR ROVER INITIALIZATION"));
  Serial.println(F("=============================================="));

  Serial.println(F("[SYSTEM] Motors ENABLED"));
  Serial.println(F("[SYSTEM] Actuator Current Sensing ENABLED"));
  Serial.println(F("[SYSTEM] Overload Protection DISABLED"));
  Serial.println(F("[SYSTEM] Current Sense Input: A0"));

  // Motor Outputs
  pinMode(PIN_L_RPWM, OUTPUT);
  pinMode(PIN_L_LPWM, OUTPUT);

  pinMode(PIN_R_RPWM, OUTPUT);
  pinMode(PIN_R_LPWM, OUTPUT);

  pinMode(PIN_ACT_RPWM, OUTPUT);
  pinMode(PIN_ACT_LPWM, OUTPUT);

  // Ultrasonic
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  digitalWrite(PIN_TRIG, LOW);

  // Current Sense
  pinMode(PIN_ACT_SENSE, INPUT);

  analogReference(DEFAULT);

  stopAllOutputs();

  // Receiver Inputs
  pinMode(PIN_CH1_STEER, INPUT);
  pinMode(PIN_CH2_THROTTLE, INPUT);
  pinMode(PIN_CH4_ACTUATOR, INPUT);

  pinMode(PIN_CH5_ARM, INPUT);
  pinMode(PIN_CH6_MODE, INPUT);
  pinMode(PIN_CH8_LORA, INPUT);

  // Receiver Interrupts
  attachInterrupt(
    digitalPinToInterrupt(PIN_CH1_STEER),
    isrCh1,
    CHANGE
  );

  attachInterrupt(
    digitalPinToInterrupt(PIN_CH2_THROTTLE),
    isrCh2,
    CHANGE
  );

  attachInterrupt(
    digitalPinToInterrupt(PIN_CH4_ACTUATOR),
    isrCh4,
    CHANGE
  );

  attachInterrupt(
    digitalPinToInterrupt(PIN_CH5_ARM),
    isrCh5,
    CHANGE
  );

  attachInterrupt(
    digitalPinToInterrupt(PIN_CH6_MODE),
    isrCh6,
    CHANGE
  );

  attachInterrupt(
    digitalPinToInterrupt(PIN_CH8_LORA),
    isrCh8,
    CHANGE
  );

  Serial.println(F("[SYSTEM] Initialization Complete"));
  Serial.println(F("[SYSTEM] Waiting for RC Commands..."));
  Serial.println(F("[SAFETY] Tilt fault: MANUAL DRIVE allowed; actuator DOWN blocked."));
  Serial.println(F("[SAFETY] Restore attitude, center CH4, then disarm/rearm."));
}


// =================================================================
// MAIN LOOP
// =================================================================

void loop() {

  uint16_t steer;
  uint16_t throttle;
  uint16_t actuator;
  uint16_t armPulse;
  uint16_t modePulse;
  uint16_t loraPulse;

  uint32_t lastSignal;

  noInterrupts();

  steer = ch1_pulse;
  throttle = ch2_pulse;
  actuator = ch4_pulse;

  armPulse = ch5_pulse;
  modePulse = ch6_pulse;
  loraPulse = ch8_pulse;

  lastSignal = last_rc_time;

  interrupts();


  // ---------------- SENSOR UPDATES ----------------

  updateUltrasonicDistance();

  updateActuatorCurrentSense();


  // ---------------- ESP32 + IMU COMMANDS ----------------
  readEspLines();

  // ---------------- RC FAILSAFE ----------------

  if (
    lastSignal == 0 ||
    millis() - lastSignal > SIGNAL_TIMEOUT
  ) {

    currentState = STATE_NO_SIGNAL;

  } else if (armPulse < 1500) {

    currentState = STATE_DISARMED;

  } else {

    if (modePulse < 1300)
      currentState = STATE_MANUAL;

    else if (modePulse <= 1700)
      currentState = STATE_HOLD;

    else
      currentState = STATE_SEMI_AUTO;
  }


  updateTiltSafety(currentState, armPulse, actuator);

  // ---------------- LORA SWITCH ----------------

  if (loraPulse > 1500) {

    if (espInTxMode) {

      espSerial.println("SET_MODE:RX");

      espInTxMode = false;

      Serial.println(F("[LORA] ESP32 switched to RX Mode"));
    }

  } else {

    if (!espInTxMode) {

      espSerial.println("SET_MODE:TX");

      espInTxMode = true;

      missionActive = false;

      stopAllOutputs();

      Serial.println(F("[LORA] ESP32 switched to TX Mode"));
    }
  }


  // ---------------- MOTOR CONTROL + SAFETY ----------------
  if (recoveryState == REC_RETRACT) {
    // No drive movement during attempted recovery.
    stopDriveMotors();
    performRecovery();
  } else if (safetyLatched) {
    // A probe-tilt fault inhibits the ACTUATOR, not manual rover mobility.
    // Operator can reposition the rover to restore its pre-fault attitude.
    // Autonomous movement remains cancelled; drive only with live RC + CH5 armed.
    if (currentState == STATE_MANUAL) {
      processManualDrive(throttle, steer);
    } else {
      stopDriveMotors();
    }
    processFaultManualReverse(actuator);
  } else {
    switch (currentState) {
      case STATE_MANUAL:
        processManualDrive(throttle, steer);
        processManualActuator(actuator);
        break;
      case STATE_SEMI_AUTO:
        processAutoDrive();
        break;
      default:
        stopAllOutputs();
        break;
    }
  }
  checkActuatorOverload();

  // ---------------- DEBUG OUTPUT ----------------

  if (
    millis() - lastTelemetryTime >=
    TELEMETRY_INTERVAL_MS
  ) {

    lastTelemetryTime = millis();

    printDebugTelemetry(
      steer,
      throttle,
      actuator,
      armPulse,
      modePulse,
      loraPulse,
      lastSignal
    );

    printActuatorCurrentSense();
    Serial.print(F("[IMU] valid=")); Serial.print(imuFresh());
    Serial.print(F(" pitch=")); Serial.print(imuPitch, 2);
    Serial.print(F(" roll=")); Serial.print(imuRoll, 2);
    Serial.print(F(" fault=")); Serial.print(safetyLatched);
    Serial.print(F(" recovery="));
    switch (recoveryState) {
      case REC_NONE: Serial.print(F("NONE")); break;
      case REC_RETRACT: Serial.print(F("RETRACTING")); break;
      case REC_LATCHED: Serial.print(F("LATCHED")); break;
    }
    Serial.print(F(" baselineP=")); Serial.print(basePitch, 2);
    Serial.print(F(" baselineR=")); Serial.print(baseRoll, 2);
    Serial.print(F(" deltaP=")); Serial.print(pitchDelta(), 2);
    Serial.print(F(" deltaR=")); Serial.print(rollDelta(), 2);
    Serial.print(F(" readyToRearm="));
    bool levelForReset = imuFresh() &&
      fabs(pitchDelta()) <= RECOVERY_SETTLED_DEG &&
      fabs(rollDelta()) <= RECOVERY_SETTLED_DEG;
    Serial.print(safetyLatched && recoveryState == REC_LATCHED && levelForReset);
    if (safetyLatched) {
      Serial.print(F(" resetCheck="));
      if (!imuFresh()) Serial.print(F("IMU_STALE"));
      else if (!levelForReset) Serial.print(F("RESTORE_BASELINE"));
      else if (recoveryState != REC_LATCHED) Serial.print(F("RECOVERY_ACTIVE"));
      else if (abs((int)actuator - (int)RC_MID) >= RC_DEADZONE) Serial.print(F("CENTER_CH4"));
      else if (currentState != STATE_MANUAL && currentState != STATE_DISARMED) Serial.print(F("SET_MANUAL_OR_DISARM"));
      else Serial.print(F("HOLD_NEUTRAL"));
    }
    Serial.println();
  }

  delay(10);
}


// =================================================================
// ACTUATOR CURRENT-SENSE MONITORING
// =================================================================

void updateActuatorCurrentSense() {

  if (
    millis() - lastSenseTime <
    SENSE_INTERVAL_MS
  ) {
    return;
  }

  lastSenseTime = millis();

  // Read BTS7960 current-sense voltage
  actuatorSenseRaw = analogRead(PIN_ACT_SENSE);

  // Accumulate readings for window statistics
  senseSampleSum += actuatorSenseRaw;
  senseSampleCount++;

  // Track the highest and lowest readings
  if (actuatorSenseRaw > senseWindowMax) {
    senseWindowMax = actuatorSenseRaw;
  }

  if (actuatorSenseRaw < senseWindowMin) {
    senseWindowMin = actuatorSenseRaw;
  }

  // Approximate instantaneous voltage
  actuatorSenseVoltage =
    actuatorSenseRaw * ADC_REFERENCE_VOLTAGE / 1023.0;
}


// =================================================================
// ACTUATOR OVERLOAD DETECTION
// =================================================================

void checkActuatorOverload() {

  if (!ENABLE_OVERLOAD_PROTECTION) {
    return;
  }

  // Once tripped, remain stopped until reset.
  if (actuatorOverload) {

    stopActuator();

    return;
  }

  // Only monitor while actuator is moving
  if (debugActuatorPwm == 0) {

    overloadTiming = false;

    return;
  }

  // Detect sustained high sense reading
  if (actuatorSenseRaw >= ACTUATOR_OVERLOAD_ADC) {

    if (!overloadTiming) {

      overloadTiming = true;
      overloadStartTime = millis();
    }

    if (
      millis() - overloadStartTime >=
      OVERLOAD_CONFIRM_MS
    ) {

      actuatorOverload = true;

      stopActuator();

      Serial.println();
      Serial.println(F("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"));
      Serial.println(F("[WARNING] ACTUATOR OVERLOAD!"));
      Serial.println(F("[SAFETY] ACTUATOR STOPPED"));
      Serial.println(F("[SAFETY] Reset Arduino to clear"));
      Serial.println(F("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"));
    }

  } else {

    overloadTiming = false;
  }
}


// =================================================================
// PRINT ACTUATOR CURRENT-SENSE READINGS
// =================================================================

void printActuatorCurrentSense() {

  if (senseSampleCount > 0) {

    actuatorSenseAvg =
      senseSampleSum / senseSampleCount;

    actuatorSensePeak = senseWindowMax;
    actuatorSenseMin = senseWindowMin;

  } else {

    actuatorSenseAvg = actuatorSenseRaw;
    actuatorSensePeak = actuatorSenseRaw;
    actuatorSenseMin = actuatorSenseRaw;
  }

  float avgVoltage =
    actuatorSenseAvg * ADC_REFERENCE_VOLTAGE / 1023.0;

  Serial.print(F("[ACT SENSE A0] "));

  Serial.print(F("Raw: "));
  Serial.print(actuatorSenseRaw);

  Serial.print(F(" | Avg: "));
  Serial.print(actuatorSenseAvg);

  Serial.print(F(" | Peak: "));
  Serial.print(actuatorSensePeak);

  Serial.print(F(" | Min: "));
  Serial.print(actuatorSenseMin);

  Serial.print(F(" | Voltage: "));
  Serial.print(avgVoltage, 3);
  Serial.print(F("V"));

  Serial.print(F(" | PWM: "));
  Serial.print(debugActuatorPwm);

  Serial.print(F(" | Direction: "));

  if (debugActuatorPwm > 0) {

    Serial.print(F("DOWN / EXTEND"));

  } else if (debugActuatorPwm < 0) {

    Serial.print(F("UP / RETRACT"));

  } else {

    Serial.print(F("STOPPED"));
  }

  Serial.print(F(" | Protection: "));

  if (!ENABLE_OVERLOAD_PROTECTION) {

    Serial.println(F("CALIBRATION ONLY"));

  } else if (actuatorOverload) {

    Serial.println(F("OVERLOAD TRIPPED"));

  } else {

    Serial.println(F("ACTIVE"));
  }


  // Reset statistics for next reporting window
  senseSampleSum = 0;
  senseSampleCount = 0;

  senseWindowMax = 0;
  senseWindowMin = 1023;
}


// =================================================================
// AUTOMATIC DRIVE PROCESSING
// =================================================================

void processAutoDrive() {

  if (!missionActive) {

    stopAllOutputs();

    return;
  }

  if (
    millis() - missionTimerStart >=
    missionTimerDuration
  ) {

    fetchNextAutoCommand();

    if (!missionActive) {
      return;
    }
  }

  char dir = currentCommand.charAt(0);


  // Obstacle Avoidance
  if (
    dir == 'F' &&
    currentObstacleDist <= OBSTACLE_DISTANCE_CM
  ) {

    stopDriveMotors();

    Serial.println(F(
      "[WARNING] Obstacle detected!"
    ));

    Serial.println(F(
      "[AUTO] Injecting Back 2s, Left 1s"
    ));

    missionSequence =
      "B2,L1," + currentCommand + "," + missionSequence;

    fetchNextAutoCommand();

  } else {

    executeAutoCommand();
  }
}


// =================================================================
// FETCH NEXT AUTOMATIC COMMAND
// =================================================================

void fetchNextAutoCommand() {

  if (missionSequence.length() == 0) {

    missionActive = false;

    stopAllOutputs();

    Serial.println(F("[MISSION COMPLETE]"));

    return;
  }

  int commaIndex = missionSequence.indexOf(',');

  if (commaIndex != -1) {

    currentCommand =
      missionSequence.substring(0, commaIndex);

    missionSequence =
      missionSequence.substring(commaIndex + 1);

  } else {

    currentCommand = missionSequence;

    missionSequence = "";
  }

  int durationSec =
    currentCommand.substring(1).toInt();

  missionTimerDuration = durationSec * 1000UL;

  missionTimerStart = millis();

  Serial.print(F("[AUTO] Executing: "));
  Serial.println(currentCommand);

  executeAutoCommand();
}


// =================================================================
// EXECUTE AUTOMATIC COMMAND
// =================================================================

void executeAutoCommand() {

  char dir = currentCommand.charAt(0);

  if (dir == 'F') {

    setMotorSpeed(
      PIN_L_RPWM,
      PIN_L_LPWM,
      -AUTO_DRIVE_SPEED
    );

    setMotorSpeed(
      PIN_R_RPWM,
      PIN_R_LPWM,
      AUTO_DRIVE_SPEED
    );

    stopActuator();
  }

  else if (dir == 'B') {

    setMotorSpeed(
      PIN_L_RPWM,
      PIN_L_LPWM,
      AUTO_DRIVE_SPEED
    );

    setMotorSpeed(
      PIN_R_RPWM,
      PIN_R_LPWM,
      -AUTO_DRIVE_SPEED
    );

    stopActuator();
  }

  else if (dir == 'L') {

    setMotorSpeed(
      PIN_L_RPWM,
      PIN_L_LPWM,
      AUTO_DRIVE_SPEED
    );

    setMotorSpeed(
      PIN_R_RPWM,
      PIN_R_LPWM,
      AUTO_DRIVE_SPEED
    );

    stopActuator();
  }

  else if (dir == 'R') {

    setMotorSpeed(
      PIN_L_RPWM,
      PIN_L_LPWM,
      -AUTO_DRIVE_SPEED
    );

    setMotorSpeed(
      PIN_R_RPWM,
      PIN_R_LPWM,
      -AUTO_DRIVE_SPEED
    );

    stopActuator();
  }

  else if (dir == 'D') {

    stopDriveMotors();

    actuatorOutput(255);
  }

  else if (dir == 'U') {

    stopDriveMotors();

    actuatorOutput(-255);
  }

  else {

    stopAllOutputs();
  }
}


// =================================================================
// MOTOR CONTROL
// =================================================================

void setMotorSpeed(
  uint8_t rpwmPin,
  uint8_t lpwmPin,
  int speed
) {

  speed = constrain(speed, -255, 255);

  // Final motor-output interlock, including invalid IMU data.
  if (rpwmPin == PIN_ACT_RPWM) {
    bool allowedReverse = recoveryState == REC_RETRACT ||
                          (safetyLatched && faultReverseActive &&
                           currentState == STATE_MANUAL && imuFresh());
    if (actuatorOverload || (safetyLatched && !allowedReverse)) speed = 0;
    if (speed > 0 && (!imuFresh() || safetyLatched)) speed = 0;
    if (speed < 0 && safetyLatched && !imuFresh()) speed = 0;
  }

  if (speed > 0) {

    analogWrite(rpwmPin, speed);
    analogWrite(lpwmPin, 0);

  } else if (speed < 0) {

    analogWrite(rpwmPin, 0);
    analogWrite(lpwmPin, abs(speed));

  } else {

    analogWrite(rpwmPin, 0);
    analogWrite(lpwmPin, 0);
  }

  if (rpwmPin == PIN_L_RPWM) {
    debugLeftMotorPwm = speed;
  }

  if (rpwmPin == PIN_R_RPWM) {
    debugRightMotorPwm = speed;
  }

  if (rpwmPin == PIN_ACT_RPWM) {
    debugActuatorPwm = speed;
  }
}


// =================================================================
// MOTOR STOP FUNCTIONS
// =================================================================

void stopDriveMotors() {

  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, 0);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, 0);
}

void stopActuator() {

  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, 0);
}

void stopAllOutputs() {

  stopDriveMotors();
  stopActuator();
}


// =================================================================
// ULTRASONIC SENSOR
// =================================================================

void updateUltrasonicDistance() {

  if (
    millis() - lastPingTime <
    PING_INTERVAL_MS
  ) {
    return;
  }

  lastPingTime = millis();

  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);

  digitalWrite(PIN_TRIG, LOW);

  unsigned long duration =
    pulseIn(PIN_ECHO, HIGH, 8000);

  currentObstacleDist =
    (duration == 0)
      ? 999
      : (unsigned int)(duration * 0.0343 / 2.0);
}


// =================================================================
// MANUAL DRIVE
// =================================================================

void processManualDrive(
  uint16_t throttleRaw,
  uint16_t steerRaw
) {

  int throttle = (int)throttleRaw - RC_MID;
  int steer = (int)steerRaw - RC_MID;

  if (abs(throttle) < RC_DEADZONE)
    throttle = 0;

  if (abs(steer) < RC_DEADZONE)
    steer = 0;

  if (
    currentObstacleDist <= OBSTACLE_DISTANCE_CM &&
    throttle > 0
  ) {
    throttle = 0;
  }

  int fwdSpeed =
    map(throttle, -500, 500, -255, 255);

  int turnSpeed =
    map(steer, -500, 500, -255, 255);

  int leftSpeed =
    constrain(-fwdSpeed + turnSpeed, -255, 255);

  int rightSpeed =
    constrain(fwdSpeed + turnSpeed, -255, 255);

  setMotorSpeed(
    PIN_L_RPWM,
    PIN_L_LPWM,
    leftSpeed
  );

  setMotorSpeed(
    PIN_R_RPWM,
    PIN_R_LPWM,
    rightSpeed
  );
}


// =================================================================
// MANUAL ACTUATOR CONTROL
// =================================================================

void processManualActuator(uint16_t actRaw) {

  int input = (int)actRaw - RC_MID;

  if (abs(input) < RC_DEADZONE) {

    stopActuator();

    return;
  }

  int speed =
    map(input, -500, 500, -255, 255);

  speed = constrain(speed, -255, 255);

  actuatorOutput(speed);
}


// =================================================================
// DEBUG TELEMETRY
// =================================================================

void printDebugTelemetry(
  uint16_t ch1,
  uint16_t ch2,
  uint16_t ch4,
  uint16_t ch5,
  uint16_t ch6,
  uint16_t ch8,
  uint32_t lastSig
) {

  unsigned long timeSinceLastPulse =
    millis() - lastSig;

  Serial.print(F("[RC STATUS] "));

  if (
    lastSig == 0 ||
    timeSinceLastPulse > SIGNAL_TIMEOUT
  ) {

    Serial.print(F("NO SIGNAL"));

  } else {

    Serial.print(F("OK"));
  }

  Serial.print(F(" | CH1:"));
  Serial.print(ch1);

  Serial.print(F(" | CH2:"));
  Serial.print(ch2);

  Serial.print(F(" | CH4:"));
  Serial.print(ch4);

  Serial.print(F(" | CH5:"));
  Serial.print(ch5);

  Serial.print(F(" | CH6:"));
  Serial.print(ch6);

  Serial.print(F(" | CH8:"));
  Serial.print(ch8);

  Serial.print(F(" | STATE: "));

  switch (currentState) {

    case STATE_NO_SIGNAL:
      Serial.print(F("NO_SIGNAL"));
      break;

    case STATE_DISARMED:
      Serial.print(F("DISARMED"));
      break;

    case STATE_MANUAL:
      Serial.print(F("MANUAL"));
      break;

    case STATE_HOLD:
      Serial.print(F("HOLD"));
      break;

    case STATE_SEMI_AUTO:
      Serial.print(F("SEMI_AUTO"));
      break;
  }

  Serial.print(F(" | Sonar:"));
  Serial.print(currentObstacleDist);

  Serial.print(F("cm | L_PWM:"));
  Serial.print(debugLeftMotorPwm);

  Serial.print(F(" | R_PWM:"));
  Serial.print(debugRightMotorPwm);

  Serial.print(F(" | ACT_PWM:"));
  Serial.println(debugActuatorPwm);
}

// =================================================================
// ESP32 FRAMED SERIAL HANDLER (nonblocking, bounded length)
// =================================================================
void readEspLines() {
  uint8_t budget = 96;  // never starve RC control
  while (espSerial.available() && budget--) {
    char c = (char)espSerial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      serialLine[serialLen] = '\0';
      if (serialLen) processEspLine(serialLine);
      serialLen = 0;
    } else if (serialLen < sizeof(serialLine) - 1) {
      serialLine[serialLen++] = c;
    } else {
      serialLen = 0;  // discard overlong line
    }
  }
}

// AVR Mega: sscanf("%f") is not supported by the default AVR libc build.
// Use strtod() to parse signed pitch and roll values reliably.
void processEspLine(const char *line) {
  if (strncmp(line, "IMU:", 4) == 0) {
    const char *cursor = line + 4;
    char *endptr;
    double p = strtod(cursor, &endptr);
    if (endptr == cursor || *endptr != ',') {
      Serial.print(F("[IMU PARSE ERROR] "));
      Serial.println(line);
      return;
    }
    cursor = endptr + 1;
    double r = strtod(cursor, &endptr);
    if (endptr == cursor || *endptr != ',') {
      Serial.print(F("[IMU PARSE ERROR] "));
      Serial.println(line);
      return;
    }
    cursor = endptr + 1;
    if ((*cursor != '0' && *cursor != '1') || cursor[1] != '\0' ||
        !isfinite(p) || !isfinite(r) || fabs(p) > 180 || fabs(r) > 180) {
      Serial.print(F("[IMU INVALID] "));
      Serial.println(line);
      return;
    }
    imuPitch = (float)p;
    imuRoll = (float)r;
    imuValid = (*cursor == '1');
    lastImuMs = millis();
    static unsigned long lastRxPrintMs = 0;
    if (millis() - lastRxPrintMs >= 1000) {
      lastRxPrintMs = millis();
      Serial.print(F("[IMU RX OK] pitch="));
      Serial.print(imuPitch, 2);
      Serial.print(F(" roll="));
      Serial.print(imuRoll, 2);
      Serial.print(F(" sensorValid="));
      Serial.println(imuValid);
    }
  } else if (strncmp(line, "RCV:", 4) == 0) {
    if (safetyLatched) {
      Serial.println(F("[MISSION] Rejected while tilt fault latched"));
      return;
    }
    missionSequence = String(line + 4);
    missionSequence.trim();
    if (missionSequence.length() == 0) return;
    if (!missionSequence.endsWith(",")) missionSequence += ",";
    missionActive = true;
    missionTimerDuration = 0;
    Serial.print(F("[MISSION UPLOADED] "));
    Serial.println(missionSequence);
    if (currentState == STATE_SEMI_AUTO) fetchNextAutoCommand();
  }
}

// =================================================================
// RELATIVE TILT MONITOR / MANUAL RESET
// =================================================================
void updateTiltSafety(SystemState state, uint16_t armPulse, uint16_t actuatorRaw) {
  bool neutral = abs((int)actuatorRaw - (int)RC_MID) < RC_DEADZONE;
  if (safetyLatched) {
    // Never clear during an active reverse recovery attempt.
    if (recoveryState == REC_RETRACT) {
      resetNeutralSince = 0;
      return;
    }

    // The mechanism may finish the short reverse but not fully level the chassis.
    // Do not rebase to the lifted angle: doing so would defeat lift protection.
    // Clear ONLY once physically level again and joystick is neutral.
    bool levelAgain = imuFresh() &&
       fabs(pitchDelta()) <= RECOVERY_SETTLED_DEG &&
       fabs(rollDelta()) <= RECOVERY_SETTLED_DEG;
    bool safeManualReset = recoveryState == REC_LATCHED &&
       state == STATE_MANUAL && neutral && levelAgain && !actuatorOverload;
    bool deliberateReset = recoveryState == REC_LATCHED &&
       state == STATE_DISARMED && armPulse >= 900 &&
       imuFresh() && neutral && levelAgain && !actuatorOverload;

    if (safeManualReset || deliberateReset) {
      if (!resetNeutralSince) resetNeutralSince = millis();
      unsigned long holdMs = safeManualReset ? RECOVERY_NEUTRAL_MS : RESET_NEUTRAL_MS;
      if (millis() - resetNeutralSince >= holdMs) {
        safetyLatched = false;
        faultReverseActive = false;
        faultReverseNeedsNeutral = false;
        recoveryCompleted = false;
        recoveryState = REC_NONE;
        downBaselineCaptured = false;
        tiltPending = false;
        resetNeutralSince = 0;
        stopActuator();
        Serial.println(F("[SAFETY] Recovery cleared; NEW down command allowed. Mission remains cancelled."));
      }
    } else {
      resetNeutralSince = 0;
    }
    return;
  }

  bool down = debugActuatorPwm > 0;
  if (!down) {
    downBaselineCaptured = false;
    tiltPending = false;
    return;
  }
  if (!imuFresh()) {
    latchTiltFault("IMU TIMEOUT/INVALID");
    return;
  }
  if (!downBaselineCaptured) {
    basePitch = imuPitch;
    baseRoll = imuRoll;
    downBaselineCaptured = true;
    Serial.print(F("[IMU] Reference pitch=")); Serial.print(basePitch, 2);
    Serial.print(F(" roll=")); Serial.println(baseRoll, 2);
    return;
  }

  float dp = fabs(pitchDelta());
  float dr = fabs(rollDelta());
  bool emergency = dp >= TILT_EMERGENCY_DEG || dr >= TILT_EMERGENCY_DEG;
  bool over = dp >= TILT_STOP_DEG || dr >= TILT_STOP_DEG;
  if (emergency) {
    latchTiltFault("SEVERE CHASSIS TILT");
  } else if (over) {
    if (!tiltPending) { tiltPending = true; tiltStartMs = millis(); }
    if (millis() - tiltStartMs >= TILT_CONFIRM_MS)
      latchTiltFault("SUSTAINED CHASSIS TILT");
  } else tiltPending = false;
}

void latchTiltFault(const char *reason) {
  if (safetyLatched) return;
  faultOrigin = currentState;
  recoveryCompleted = false;
  safetyLatched = true;
  faultReverseActive = false;
  faultReverseNeedsNeutral = true; // left stick must be released after the fault
  missionActive = false;
  missionSequence = "";
  currentCommand = "";
  stopDriveMotors();
  stopActuator();
  Serial.print(F("[TILT FAULT] ")); Serial.println(reason);
  Serial.print(F("[TILT] dPitch=")); Serial.print(pitchDelta(), 2);
  Serial.print(F(" dRoll=")); Serial.println(rollDelta(), 2);
  espSerial.println("FAULT:TILT");
  if (ENABLE_BOUNDED_RETRACTION && imuFresh() && !actuatorOverload &&
      (faultOrigin == STATE_MANUAL || faultOrigin == STATE_SEMI_AUTO)) {
    recoveryState = REC_RETRACT;
    recoveryStartedMs = millis();
    Serial.println(F("[SAFETY] Bounded reverse attempt; after rover returns to PRE-FAULT tilt, release stick to rearm"));
  } else {
    recoveryState = REC_LATCHED;
    Serial.println(F("[SAFETY] Actuator stopped. Timed retraction DISABLED or unsafe."));
  }
}

void performRecovery() {
  unsigned long bound = faultOrigin == STATE_MANUAL ? MANUAL_RETRACT_MS : AUTO_RETRACT_MS;
  // A bounded time is NOT positional feedback. Abort on stale IMU, increasing tilt,
  // disarmed state, RC signal loss, or excessive angular displacement.
  bool unsafe = !imuFresh() || currentState == STATE_DISARMED ||
      currentState == STATE_NO_SIGNAL ||
      fabs(pitchDelta()) >= TILT_EMERGENCY_DEG + 2 ||
      fabs(rollDelta()) >= TILT_EMERGENCY_DEG + 2;
  if (unsafe || millis() - recoveryStartedMs >= bound) {
    stopActuator();
    recoveryCompleted = !unsafe;  // aborted recoveries require deliberate disarm reset
    recoveryState = REC_LATCHED;
    Serial.println(recoveryCompleted ?
      F("[SAFETY] Reverse complete. Restore baseline angle and release stick to rearm in MANUAL.") :
      F("[SAFETY] Reverse aborted. Physically restore pre-fault attitude, then release joystick in MANUAL mode."));
    return;
  }
  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, -RETRACT_PWM);
}

// Manual fault recovery: operator pulls CH4 LEFT (negative PWM) to shorten.
// No forward motion while fault is latched. Limit each press to a short pulse.
// Requires MANUAL, armed, fresh IMU; release joystick between pulses.
void processFaultManualReverse(uint16_t actuatorRaw) {
  if (!safetyLatched || recoveryState != REC_LATCHED) {
    faultReverseActive = false;
    stopActuator();
    return;
  }

  int input = (int)actuatorRaw - (int)RC_MID;
  bool neutral = abs(input) < RC_DEADZONE;
  bool retractRequested = input < -(int)RC_DEADZONE;
  bool enabled = currentState == STATE_MANUAL && imuFresh() && !actuatorOverload;

  if (!enabled || neutral || !retractRequested) {
    faultReverseActive = false;
    stopActuator();
    if (neutral && enabled) faultReverseNeedsNeutral = false;
    return;
  }

  if (faultReverseNeedsNeutral) {
    faultReverseActive = false;
    stopActuator();
    return;
  }

  float magnitude = max(fabs(pitchDelta()), fabs(rollDelta()));
  if (!faultReverseActive) {
    faultReverseActive = true;
    faultReverseStartedMs = millis();
    faultReverseStartMagnitude = magnitude;
    Serial.println(F("[RECOVERY] Manual left-stick reverse pulse START"));
  }

  if (millis() - faultReverseStartedMs >= MANUAL_FAULT_REVERSE_MS ||
      magnitude > faultReverseStartMagnitude + MAX_REVERSE_TILT_INCREASE_DEG) {
    faultReverseActive = false;
    faultReverseNeedsNeutral = true;
    stopActuator();
    Serial.println(F("[RECOVERY] Reverse STOP. Release stick before another pulse."));
    return;
  }

  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, -MANUAL_FAULT_REVERSE_PWM);
}

// Gate all regular actuator commands. Forward drive functions remain unaffected.
void actuatorOutput(int speed) {
  speed = constrain(speed, -255, 255);
  if (safetyLatched || actuatorOverload) speed = 0;
  if (speed > 0 && !imuFresh()) speed = 0;
  if (speed > 0 && debugActuatorPwm <= 0 && imuFresh()) {
    basePitch = imuPitch;
    baseRoll = imuRoll;
    downBaselineCaptured = true;
    tiltPending = false;
  }
  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, speed);
}
