// =================================================================
// ARDUINO MEGA 2560 - PRODUCTION FIRMWARE (EVASIVE MANEUVERS)
// Monitor at 115200 baud to verify Receiver, Failsafes, and Drivers
// =================================================================

// ---------------------- PIN ASSIGNMENTS --------------------------
const uint8_t PIN_CH1_STEER    = 18; // INT5 (Right Stick X)
const uint8_t PIN_CH2_THROTTLE = 19; // INT4 (Right Stick Y)
const uint8_t PIN_CH4_ACTUATOR = 20; // INT3 (Left Stick X)
const uint8_t PIN_CH5_ARM      = 21; // INT2 (2-Pos Left Shoulder)
const uint8_t PIN_CH6_MODE     = 2;  // INT0 (3-Pos Switch)
const uint8_t PIN_CH8_LORA     = 3;  // INT1 (2-Pos Switch for RX/TX)

// BTS7960 Driver 1 (Left Drive Motor)
const uint8_t PIN_L_RPWM = 9; 
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

// ------------------- TUNING & FAILSAFE CONSTANTS -----------------
const uint16_t RC_MIN          = 1000;
const uint16_t RC_MID          = 1500;
const uint16_t RC_MAX          = 2000;
const uint16_t RC_DEADZONE     = 45;
const uint32_t SIGNAL_TIMEOUT  = 250; 

const unsigned int OBSTACLE_DISTANCE_CM = 25;
const unsigned long PING_INTERVAL_MS    = 40;
const int AUTO_DRIVE_SPEED = 180; 

// ----------------- VOLATILE INTERRUPT VARIABLES ------------------
volatile uint32_t ch1_start = 0, ch1_pulse = 0;
volatile uint32_t ch2_start = 0, ch2_pulse = 0;
volatile uint32_t ch4_start = 0, ch4_pulse = 0;
volatile uint32_t ch5_start = 0, ch5_pulse = 0;
volatile uint32_t ch6_start = 0, ch6_pulse = 0;
volatile uint32_t ch8_start = 0, ch8_pulse = 0;
volatile uint32_t last_rc_time = 0;

enum SystemState {
  STATE_NO_SIGNAL,
  STATE_DISARMED,
  STATE_MANUAL,
  STATE_HOLD,
  STATE_SEMI_AUTO
};

SystemState currentState = STATE_NO_SIGNAL;

unsigned int currentObstacleDist = 999;
unsigned long lastPingTime       = 0;
unsigned long lastTelemetryTime  = 0;

HardwareSerial& espSerial = Serial2; 
bool espInTxMode = true; 

// Auto-Mission State Variables
String missionSequence = "";
bool missionActive = false;
unsigned long missionTimerStart = 0;
unsigned long missionTimerDuration = 0;
String currentCommand = "";

int debugLeftMotorPwm  = 0;
int debugRightMotorPwm = 0;
int debugActuatorPwm   = 0;

// Forward Declarations
void setMotorSpeed(uint8_t rpwmPin, uint8_t lpwmPin, int speed);
void stopDriveMotors();
void stopActuator();
void stopAllOutputs();
void updateUltrasonicDistance();
void processManualDrive(uint16_t throttleRaw, uint16_t steerRaw);
void processManualActuator(uint16_t actRaw);
void processAutoDrive();
void fetchNextAutoCommand();
void executeAutoCommand();
void printDebugTelemetry(uint16_t ch1, uint16_t ch2, uint16_t ch4, uint16_t ch5, uint16_t ch6, uint16_t ch8, uint32_t lastSig);

// =================================================================
// INTERRUPT SERVICE ROUTINES (ISRs)
// =================================================================
void isrCh1() { if (digitalRead(PIN_CH1_STEER) == HIGH) ch1_start = micros(); else { ch1_pulse = micros() - ch1_start; last_rc_time = millis(); } }
void isrCh2() { if (digitalRead(PIN_CH2_THROTTLE) == HIGH) ch2_start = micros(); else { ch2_pulse = micros() - ch2_start; last_rc_time = millis(); } }
void isrCh4() { if (digitalRead(PIN_CH4_ACTUATOR) == HIGH) ch4_start = micros(); else { ch4_pulse = micros() - ch4_start; last_rc_time = millis(); } }
void isrCh5() { if (digitalRead(PIN_CH5_ARM) == HIGH) ch5_start = micros(); else { ch5_pulse = micros() - ch5_start; last_rc_time = millis(); } }
void isrCh6() { if (digitalRead(PIN_CH6_MODE) == HIGH) ch6_start = micros(); else { ch6_pulse = micros() - ch6_start; last_rc_time = millis(); } }
void isrCh8() { if (digitalRead(PIN_CH8_LORA) == HIGH) ch8_start = micros(); else { ch8_pulse = micros() - ch8_start; last_rc_time = millis(); } }

void setup() {
  Serial.begin(115200);
  espSerial.begin(9600); 
  
  while (!Serial && millis() < 2000); 

  Serial.println(F("\n--- MEGA 2560 PRODUCTION INITIALIZATION ---"));

  pinMode(PIN_L_RPWM, OUTPUT); pinMode(PIN_L_LPWM, OUTPUT);
  pinMode(PIN_R_RPWM, OUTPUT); pinMode(PIN_R_LPWM, OUTPUT);
  pinMode(PIN_ACT_RPWM, OUTPUT); pinMode(PIN_ACT_LPWM, OUTPUT);

  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  stopAllOutputs();

  pinMode(PIN_CH1_STEER, INPUT); pinMode(PIN_CH2_THROTTLE, INPUT);
  pinMode(PIN_CH4_ACTUATOR, INPUT); pinMode(PIN_CH5_ARM, INPUT);
  pinMode(PIN_CH6_MODE, INPUT); pinMode(PIN_CH8_LORA, INPUT);

  attachInterrupt(digitalPinToInterrupt(PIN_CH1_STEER), isrCh1, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH2_THROTTLE), isrCh2, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH4_ACTUATOR), isrCh4, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH5_ARM), isrCh5, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH6_MODE), isrCh6, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH8_LORA), isrCh8, CHANGE);
}

void loop() {
  uint16_t steer, throttle, actuator, armPulse, modePulse, loraPulse;
  uint32_t lastSignal;

  noInterrupts();
  steer      = ch1_pulse;
  throttle   = ch2_pulse;
  actuator   = ch4_pulse;
  armPulse   = ch5_pulse;
  modePulse  = ch6_pulse;
  loraPulse  = ch8_pulse;
  lastSignal = last_rc_time;
  interrupts();

  updateUltrasonicDistance();

  if (espSerial.available()) {
    String incoming = espSerial.readStringUntil('\n');
    incoming.trim();
    
    if (incoming.startsWith("RCV:")) {
      missionSequence = incoming.substring(4) + ","; 
      missionActive = true;
      Serial.println("\n[MISSION UPLOADED] Sequence: " + missionSequence);
      
      if (currentState == STATE_SEMI_AUTO) {
        fetchNextAutoCommand(); 
      }
    }
  }

  if (lastSignal == 0 || (millis() - lastSignal > SIGNAL_TIMEOUT)) {
    currentState = STATE_NO_SIGNAL;
  } else if (armPulse < 1500) {
    currentState = STATE_DISARMED;
  } else {
    if (modePulse < 1300) currentState = STATE_MANUAL;
    else if (modePulse <= 1700) currentState = STATE_HOLD;
    else currentState = STATE_SEMI_AUTO;
  }

  if (loraPulse > 1500) {
    if (espInTxMode) {
      espSerial.println("SET_MODE:RX");
      espInTxMode = false;
      Serial.println("\n[SYSTEM] Switched ESP32 to RX Mode (Awaiting Commands)");
    }
  } else {
    if (!espInTxMode) {
      espSerial.println("SET_MODE:TX");
      espInTxMode = true;
      missionActive = false; 
      stopAllOutputs();
      Serial.println("\n[SYSTEM] Switched ESP32 to TX Mode (Broadcasting Telemetry)");
    }
  }

  switch (currentState) {
    case STATE_MANUAL: processManualDrive(throttle, steer); processManualActuator(actuator); break;
    case STATE_SEMI_AUTO: processAutoDrive(); break;
    default: stopAllOutputs(); break;
  }

  if (millis() - lastTelemetryTime >= 250) {
    lastTelemetryTime = millis();
    printDebugTelemetry(steer, throttle, actuator, armPulse, modePulse, loraPulse, lastSignal);
  }

  delay(10);
}

// =================================================================
// AUTO-DRIVE SEQUENCER & EVASION
// =================================================================
void processAutoDrive() {
  if (!missionActive) {
    stopAllOutputs();
    return;
  }

  if (millis() - missionTimerStart >= missionTimerDuration) {
    fetchNextAutoCommand();
    if (!missionActive) return; 
  }

  char dir = currentCommand.charAt(0);
  
  // NEW: Autonomous Evasive Injection
  if (dir == 'F' && currentObstacleDist <= OBSTACLE_DISTANCE_CM) {
    stopDriveMotors(); 
    Serial.println(F("\n[WARNING] Obstacle detected! Injecting evasive maneuver (Back 2s, Left 1s)."));
    
    // Inject B2 and L1, then put the interrupted command back in the queue
    if (missionSequence.length() > 0) {
      missionSequence = "B2,L1," + currentCommand + "," + missionSequence;
    } else {
      missionSequence = "B2,L1," + currentCommand;
    }
    
    // Immediately fetch the newly injected B2 command
    fetchNextAutoCommand(); 
  } else {
    executeAutoCommand(); 
  }
}

void fetchNextAutoCommand() {
  if (missionSequence.length() == 0) {
    missionActive = false;
    stopAllOutputs();
    Serial.println("\n[MISSION COMPLETE] Rover standing by.");
    return;
  }

  int commaIndex = missionSequence.indexOf(',');
  if (commaIndex != -1) {
    currentCommand = missionSequence.substring(0, commaIndex);
    missionSequence = missionSequence.substring(commaIndex + 1);
  } else {
    currentCommand = missionSequence;
    missionSequence = "";
  }

  char dir = currentCommand.charAt(0);
  int durationSec = currentCommand.substring(1).toInt();
  
  missionTimerDuration = durationSec * 1000UL;
  missionTimerStart = millis();

  Serial.println("[AUTO] Executing: " + currentCommand + " (" + String(durationSec) + " sec remaining)");
  executeAutoCommand();
}

void executeAutoCommand() {
  char dir = currentCommand.charAt(0);
  
  if (dir == 'F') { 
    setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, -AUTO_DRIVE_SPEED); 
    setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, AUTO_DRIVE_SPEED); 
    stopActuator();
  }
  else if (dir == 'B') { 
    setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, AUTO_DRIVE_SPEED); 
    setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, -AUTO_DRIVE_SPEED); 
    stopActuator();
  }
  else if (dir == 'L') { 
    setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, AUTO_DRIVE_SPEED); 
    setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, AUTO_DRIVE_SPEED); 
    stopActuator();
  }
  else if (dir == 'R') { 
    setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, -AUTO_DRIVE_SPEED); 
    setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, -AUTO_DRIVE_SPEED); 
    stopActuator();
  }
  else if (dir == 'D') { 
    stopDriveMotors();
    setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, 255); 
  }
  else if (dir == 'U') { 
    stopDriveMotors();
    setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, -255); 
  }
  else if (dir == 'S') { 
    stopAllOutputs();
  }
  else { 
    stopAllOutputs(); 
  }
}

// =================================================================
// DIAGNOSTIC PRINT ROUTINE
// =================================================================
void printDebugTelemetry(uint16_t ch1, uint16_t ch2, uint16_t ch4, uint16_t ch5, uint16_t ch6, uint16_t ch8, uint32_t lastSig) {
  unsigned long timeSinceLastPulse = millis() - lastSig;

  Serial.print(F("[RC STATUS] "));
  if (lastSig == 0 || timeSinceLastPulse > SIGNAL_TIMEOUT) {
    Serial.print(F("NO SIGNAL (Idle: ")); Serial.print(timeSinceLastPulse); Serial.print(F("ms) | "));
  } else {
    Serial.print(F("OK (")); Serial.print(timeSinceLastPulse); Serial.print(F("ms ago) | "));
  }

  Serial.print(F("CH1:")); Serial.print(ch1);
  Serial.print(F(" | CH2:")); Serial.print(ch2);
  Serial.print(F(" | CH8(LoRa):")); Serial.print(ch8);

  Serial.print(F(" || STATE: "));
  switch (currentState) {
    case STATE_NO_SIGNAL: Serial.print(F("NO_SIGNAL")); break;
    case STATE_DISARMED:  Serial.print(F("DISARMED (Toggle CH5)")); break;
    case STATE_MANUAL:    Serial.print(F("MANUAL")); break;
    case STATE_HOLD:      Serial.print(F("HOLD")); break;
    case STATE_SEMI_AUTO: Serial.print(F("SEMI_AUTO")); break;
  }

  Serial.print(F(" | Sonar: ")); Serial.print(currentObstacleDist);
  Serial.print(F("cm | L_PWM:")); Serial.print(debugLeftMotorPwm);
  Serial.print(F(" R_PWM:")); Serial.print(debugRightMotorPwm);
  Serial.print(F(" ACT_PWM:")); Serial.println(debugActuatorPwm);
}

// =================================================================
// MOTOR CONTROL PRIMITIVES
// =================================================================
void setMotorSpeed(uint8_t rpwmPin, uint8_t lpwmPin, int speed) {
  speed = constrain(speed, -255, 255);

  if (speed > 0) {
    analogWrite(rpwmPin, speed); analogWrite(lpwmPin, 0);
  } else if (speed < 0) {
    analogWrite(rpwmPin, 0); analogWrite(lpwmPin, abs(speed));
  } else {
    analogWrite(rpwmPin, 0); analogWrite(lpwmPin, 0);
  }
  
  if (rpwmPin == PIN_L_RPWM) debugLeftMotorPwm = speed;
  if (rpwmPin == PIN_R_RPWM) debugRightMotorPwm = speed;
  if (rpwmPin == PIN_ACT_RPWM) debugActuatorPwm = speed;
}

void stopDriveMotors() { setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, 0); setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, 0); }
void stopActuator() { setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, 0); }
void stopAllOutputs() { stopDriveMotors(); stopActuator(); }

// =================================================================
// SENSORS & MANUAL PROCESSING
// =================================================================
void updateUltrasonicDistance() {
  if (millis() - lastPingTime >= PING_INTERVAL_MS) {
    lastPingTime = millis();
    digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    unsigned long duration = pulseIn(PIN_ECHO, HIGH, 8000);
    currentObstacleDist = (duration == 0) ? 999 : (unsigned int)(duration * 0.0343 / 2.0);
  }
}

void processManualDrive(uint16_t throttleRaw, uint16_t steerRaw) {
  int throttle = (int)throttleRaw - RC_MID;
  int steer    = (int)steerRaw - RC_MID;
  if (abs(throttle) < RC_DEADZONE) throttle = 0;
  if (abs(steer) < RC_DEADZONE)    steer = 0;

  if (currentObstacleDist <= OBSTACLE_DISTANCE_CM && throttle > 0) throttle = 0;

  int fwdSpeed  = map(throttle, -500, 500, -255, 255);
  int turnSpeed = map(steer, -500, 500, -255, 255);

  debugLeftMotorPwm  = constrain(-fwdSpeed + turnSpeed, -255, 255);
  debugRightMotorPwm = constrain(fwdSpeed + turnSpeed, -255, 255);

  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, debugLeftMotorPwm);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, debugRightMotorPwm);
}

void processManualActuator(uint16_t actRaw) {
  int input = (int)actRaw - RC_MID;
  if (abs(input) < RC_DEADZONE) { stopActuator(); return; }
  debugActuatorPwm = map(input, -500, 500, -255, 255);
  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, debugActuatorPwm);
}