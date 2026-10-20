// =================================================================
// ARDUINO MEGA 2560 - AUTONOMOUS MOTOR BENCH TEST FIRMWARE
// Monitor at 115200 baud to verify driver wiring and directionality
// =================================================================

// ---------------------- PIN ASSIGNMENTS --------------------------
const uint8_t PIN_CH1_STEER    = 18; // INT5 (Right Stick X)
const uint8_t PIN_CH2_THROTTLE = 19; // INT4 (Right Stick Y)
const uint8_t PIN_CH4_ACTUATOR = 20; // INT3 (Left Stick X)
const uint8_t PIN_CH5_ARM      = 21; // INT2 (2-Pos Left Shoulder)
const uint8_t PIN_CH6_MODE     = 2;  // INT0 (3-Pos Switch)

// BTS7960 Driver 1 (Left Drive Motor)
const uint8_t PIN_L_RPWM = 3;
const uint8_t PIN_L_LPWM = 4;

// BTS7960 Driver 2 (Right Drive Motor)
const uint8_t PIN_R_RPWM = 5;
const uint8_t PIN_R_LPWM = 6;

// BTS7960 Driver 3 (Linear Actuator)
const uint8_t PIN_ACT_RPWM = 7;
const uint8_t PIN_ACT_LPWM = 8;

// HC-SR04 Ultrasonic Sensor
const uint8_t PIN_TRIG = 11;
const uint8_t PIN_ECHO = 12;

// ------------------- TEST BENCH SETTINGS -------------------------
const int TEST_SPEED        = 150;  // PWM speed (0 - 255)
const unsigned long RUN_MS  = 1500; // Duration of each motion
const unsigned long STOP_MS = 1000; // Rest duration between motions

// Variables tracked for debug printing
int debugLeftMotorPwm  = 0;
int debugRightMotorPwm = 0;
int debugActuatorPwm   = 0;

// Forward Declarations
void setMotorSpeed(uint8_t rpwmPin, uint8_t lpwmPin, int speed);
void driveMotors(int leftSpeed, int rightSpeed);
void stopDriveMotors();
void stopActuator();
void stopAllOutputs();

// =================================================================
// SETUP
// =================================================================
void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000);

  Serial.println(F("\n--- MEGA 2560 MOTOR BENCH TEST INITIALIZATION ---"));

  pinMode(PIN_L_RPWM, OUTPUT);
  pinMode(PIN_L_LPWM, OUTPUT);
  pinMode(PIN_R_RPWM, OUTPUT);
  pinMode(PIN_R_LPWM, OUTPUT);
  pinMode(PIN_ACT_RPWM, OUTPUT);
  pinMode(PIN_ACT_LPWM, OUTPUT);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  stopAllOutputs();

  Serial.println(F("Outputs initialized. Starting drive sequence in 2 seconds..."));
  delay(2000);
}

// =================================================================
// MAIN LOOP - SEQUENTIAL MOTION TEST
// =================================================================
void loop() {
  // 1. FORWARD (Both wheels forward)
  Serial.println(F("[ACTION] Driving FORWARD..."));
  driveMotors(TEST_SPEED, TEST_SPEED);
  delay(RUN_MS);

  stopAndRest();

  // 2. BACKWARD (Both wheels reverse)
  Serial.println(F("[ACTION] Driving BACKWARD..."));
  driveMotors(-TEST_SPEED, -TEST_SPEED);
  delay(RUN_MS);

  stopAndRest();

  // 3. TURN LEFT (Left reverse, Right forward)
  Serial.println(F("[ACTION] Turning LEFT (Skid Steer)..."));
  driveMotors(-TEST_SPEED, TEST_SPEED);
  delay(RUN_MS);

  stopAndRest();

  // 4. TURN RIGHT (Left forward, Right reverse)
  Serial.println(F("[ACTION] Turning RIGHT (Skid Steer)..."));
  driveMotors(TEST_SPEED, -TEST_SPEED);
  delay(RUN_MS);

  stopAndRest();
}

// Helper to halt motors and provide breathing room between state transitions
void stopAndRest() {
  Serial.println(F("[STATUS] Stopped."));
  stopDriveMotors();
  delay(STOP_MS);
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

void driveMotors(int leftSpeed, int rightSpeed) {
  debugLeftMotorPwm  = leftSpeed;
  debugRightMotorPwm = rightSpeed;
  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, leftSpeed);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, rightSpeed);

  Serial.print(F(" -> L_PWM: "));
  Serial.print(leftSpeed);
  Serial.print(F(" | R_PWM: "));
  Serial.println(rightSpeed);
}

void stopDriveMotors() {
  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, 0);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, 0);
  debugLeftMotorPwm  = 0;
  debugRightMotorPwm = 0;
}

void stopActuator() {
  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, 0);
  debugActuatorPwm = 0;
}

void stopAllOutputs() {
  stopDriveMotors();
  stopActuator();
}