// =================================================================
// ARDUINO MEGA 2560 - DUAL MOTOR DRIVE TEST (BTS7960 + ELRS PWM)
// CH1: Steering | CH2: Throttle | CH5: Arm/Kill | CH6: Mode Switch
// =================================================================

// ---------------------- PIN ASSIGNMENTS --------------------------
const uint8_t PIN_CH1_STEER    = 18; // INT5 (Right Stick X)
const uint8_t PIN_CH2_THROTTLE = 19; // INT4 (Right Stick Y)
const uint8_t PIN_CH5_ARM      = 21; // INT2 (2-Pos Left Shoulder)
const uint8_t PIN_CH6_MODE     = 2;  // INT0 (3-Pos Switch)

// Driver 1 (Left Motor)
const uint8_t PIN_L_RPWM = 3;
const uint8_t PIN_L_LPWM = 4;

// Driver 2 (Right Motor)
const uint8_t PIN_R_RPWM = 5;
const uint8_t PIN_R_LPWM = 6;

// ------------------- TUNING & FAILSAFE CONSTANTS -----------------
const uint16_t RC_MIN         = 1000;
const uint16_t RC_MID         = 1500;
const uint16_t RC_MAX         = 2000;
const uint16_t RC_DEADZONE    = 45;   // Microseconds deadband around 1500
const uint32_t SIGNAL_TIMEOUT = 200;  // Milliseconds before triggering failsafe

// ----------------- VOLATILE INTERRUPT VARIABLES ------------------
volatile uint32_t ch1_start = 0, ch1_pulse = 1500;
volatile uint32_t ch2_start = 0, ch2_pulse = 1500;
volatile uint32_t ch5_start = 0, ch5_pulse = 1000; // Defaults to disarmed
volatile uint32_t ch6_start = 0, ch6_pulse = 1000;
volatile uint32_t last_rc_time = 0;

enum SystemState {
  STATE_DISARMED,
  STATE_MANUAL,
  STATE_HOLD,
  STATE_SEMI_AUTO
};

SystemState currentState = STATE_DISARMED;

// =================================================================
// INTERRUPT SERVICE ROUTINES (ISRs)
// =================================================================
void isrCh1() {
  if (digitalRead(PIN_CH1_STEER) == HIGH) {
    ch1_start = micros();
  } else {
    ch1_pulse = micros() - ch1_start;
    last_rc_time = millis();
  }
}

void isrCh2() {
  if (digitalRead(PIN_CH2_THROTTLE) == HIGH) {
    ch2_start = micros();
  } else {
    ch2_pulse = micros() - ch2_start;
    last_rc_time = millis();
  }
}

void isrCh5() {
  if (digitalRead(PIN_CH5_ARM) == HIGH) {
    ch5_start = micros();
  } else {
    ch5_pulse = micros() - ch5_start;
    last_rc_time = millis();
  }
}

void isrCh6() {
  if (digitalRead(PIN_CH6_MODE) == HIGH) {
    ch6_start = micros();
  } else {
    ch6_pulse = micros() - ch6_start;
    last_rc_time = millis();
  }
}

// =================================================================
// SETUP
// =================================================================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_L_RPWM, OUTPUT);
  pinMode(PIN_L_LPWM, OUTPUT);
  pinMode(PIN_R_RPWM, OUTPUT);
  pinMode(PIN_R_LPWM, OUTPUT);

  stopDriveMotors();

  pinMode(PIN_CH1_STEER, INPUT);
  pinMode(PIN_CH2_THROTTLE, INPUT);
  pinMode(PIN_CH5_ARM, INPUT);
  pinMode(PIN_CH6_MODE, INPUT);

  attachInterrupt(digitalPinToInterrupt(PIN_CH1_STEER), isrCh1, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH2_THROTTLE), isrCh2, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH5_ARM), isrCh5, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH6_MODE), isrCh6, CHANGE);

  Serial.println(F("Mega Dual-Drive Ready. Toggle CH5 to Arm."));
}

// =================================================================
// MAIN LOOP
// =================================================================
void loop() {
  uint16_t steer, throttle, armPulse, modePulse;
  uint32_t lastSignal;

  noInterrupts();
  steer      = ch1_pulse;
  throttle   = ch2_pulse;
  armPulse   = ch5_pulse;
  modePulse  = ch6_pulse;
  lastSignal = last_rc_time;
  interrupts();

  // 1. Loss of Signal Protection
  if (millis() - lastSignal > SIGNAL_TIMEOUT || throttle < 800 || steer < 800) {
    stopDriveMotors();
    currentState = STATE_DISARMED;
    return;
  }

  // 2. Kill Switch (CH5: < 1500us = Disarmed, > 1500us = Armed)
  if (armPulse < 1500) {
    stopDriveMotors();
    currentState = STATE_DISARMED;
    return;
  }

  // 3. Mode Evaluation (CH6 3-position switch)
  if (modePulse < 1300) {
    currentState = STATE_MANUAL;
  } else if (modePulse <= 1700) {
    currentState = STATE_HOLD;
  } else {
    currentState = STATE_SEMI_AUTO;
  }

  // 4. Action Execution
  switch (currentState) {
    case STATE_MANUAL:
      processManualDrive(throttle, steer);
      break;

    case STATE_HOLD:
    case STATE_SEMI_AUTO:
    case STATE_DISARMED:
    default:
      stopDriveMotors();
      break;
  }

  delay(10); // 100 Hz refresh
}

// =================================================================
// MOTOR CONTROL PRIMITIVES
// =================================================================
void setMotorSpeed(uint8_t rpwmPin, uint8_t lpwmPin, int speed) {
  speed = constrain(speed, -255, 255);

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
}

void stopDriveMotors() {
  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, 0);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, 0);
}

void processManualDrive(uint16_t throttleRaw, uint16_t steerRaw) {
  int throttle = (int)throttleRaw - RC_MID;
  int steer    = (int)steerRaw - RC_MID;

  if (abs(throttle) < RC_DEADZONE) throttle = 0;
  if (abs(steer) < RC_DEADZONE)    steer = 0;

  int fwdSpeed  = map(throttle, -500, 500, -255, 255);
  int turnSpeed = map(steer, -500, 500, -255, 255);

  // Differential mix
  int leftSpeed  = fwdSpeed + turnSpeed;
  int rightSpeed = fwdSpeed - turnSpeed;

  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, leftSpeed);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, rightSpeed);
}