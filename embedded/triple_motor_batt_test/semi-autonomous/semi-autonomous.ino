// =================================================================
// ARDUINO MEGA 2560 - FULL ROVER, ACTUATOR & SEMI-AUTONOMOUS FSM
// CH1: Steer | CH2: Throttle | CH4: Actuator | CH5: Arm | CH6: Mode
// =================================================================

// ---------------------- PIN ASSIGNMENTS --------------------------
// Receiver Hardware Interrupt Pins
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

// ------------------- TUNING & FAILSAFE CONSTANTS -----------------
const uint16_t RC_MIN          = 1000;
const uint16_t RC_MID          = 1500;
const uint16_t RC_MAX          = 2000;
const uint16_t RC_DEADZONE     = 45;
const uint32_t SIGNAL_TIMEOUT  = 200; // ms

const unsigned int OBSTACLE_DISTANCE_CM = 25; // Safe trigger distance
const unsigned long PING_INTERVAL_MS    = 40; // Sonar check interval

// Autonomous Speeds (0 to 255)
const uint8_t AUTO_DRIVE_SPEED    = 160; 
const uint8_t AUTO_TURN_SPEED     = 150;
const uint8_t AUTO_ACTUATOR_SPEED = 200;

// ----------------- VOLATILE INTERRUPT VARIABLES ------------------
volatile uint32_t ch1_start = 0, ch1_pulse = 1500;
volatile uint32_t ch2_start = 0, ch2_pulse = 1500;
volatile uint32_t ch4_start = 0, ch4_pulse = 1500;
volatile uint32_t ch5_start = 0, ch5_pulse = 1000;
volatile uint32_t ch6_start = 0, ch6_pulse = 1000;
volatile uint32_t last_rc_time = 0;

// -------------------- SYSTEM STATES ------------------------------
enum SystemState {
  STATE_DISARMED,
  STATE_MANUAL,
  STATE_HOLD,
  STATE_SEMI_AUTO
};

SystemState currentState = STATE_DISARMED;
SystemState previousState = STATE_DISARMED;

// Autonomous Step Sequence
enum AutoStep {
  AUTO_IDLE,
  AUTO_MOVE_FORWARD_1,
  AUTO_ACTUATOR_DOWN_1,
  AUTO_SOIL_TEST_1,
  AUTO_ACTUATOR_UP_1,
  AUTO_TURN_LEFT,
  AUTO_MOVE_FORWARD_2,
  AUTO_ACTUATOR_DOWN_2,
  AUTO_SOIL_TEST_2,
  AUTO_ACTUATOR_UP_2,
  AUTO_COMPLETE
};

AutoStep currentAutoStep = AUTO_IDLE;

// Autonomous Timing & State Variables
unsigned long autoStepStartTime = 0;
unsigned long autoElapsedBeforePause = 0;
bool isObstaclePaused = false;

unsigned int currentObstacleDist = 999;
unsigned long lastPingTime       = 0;

// Forward Declarations
void setMotorSpeed(uint8_t rpwmPin, uint8_t lpwmPin, int speed);
void stopDriveMotors();
void stopActuator();
void stopAllOutputs();
void updateUltrasonicDistance();
void processManualDrive(uint16_t throttleRaw, uint16_t steerRaw);
void processManualActuator(uint16_t actRaw);
void runSemiAutonomousRoutine();
void resetAutonomousRoutine();

// =================================================================
// INTERRUPT SERVICE ROUTINES
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

void isrCh4() {
  if (digitalRead(PIN_CH4_ACTUATOR) == HIGH) {
    ch4_start = micros();
  } else {
    ch4_pulse = micros() - ch4_start;
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
  Serial2.begin(115200); // Ready for ESP32

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

  pinMode(PIN_CH1_STEER, INPUT);
  pinMode(PIN_CH2_THROTTLE, INPUT);
  pinMode(PIN_CH4_ACTUATOR, INPUT);
  pinMode(PIN_CH5_ARM, INPUT);
  pinMode(PIN_CH6_MODE, INPUT);

  attachInterrupt(digitalPinToInterrupt(PIN_CH1_STEER), isrCh1, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH2_THROTTLE), isrCh2, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH4_ACTUATOR), isrCh4, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH5_ARM), isrCh5, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_CH6_MODE), isrCh6, CHANGE);

  Serial.println(F("Mega 2560 Ready. CH5 to Arm. CH6 Position 3 for Semi-Auto."));
}

// =================================================================
// MAIN LOOP
// =================================================================
void loop() {
  uint16_t steer, throttle, actuator, armPulse, modePulse;
  uint32_t lastSignal;

  noInterrupts();
  steer      = ch1_pulse;
  throttle   = ch2_pulse;
  actuator   = ch4_pulse;
  armPulse   = ch5_pulse;
  modePulse  = ch6_pulse;
  lastSignal = last_rc_time;
  interrupts();

  updateUltrasonicDistance();

  // 1. Loss of Signal Protection
  if (millis() - lastSignal > SIGNAL_TIMEOUT || throttle < 800 || steer < 800) {
    stopAllOutputs();
    resetAutonomousRoutine();
    currentState = STATE_DISARMED;
    return;
  }

  // 2. Kill Switch (CH5: < 1500us = Disarmed, > 1500us = Armed)
  if (armPulse < 1500) {
    stopAllOutputs();
    resetAutonomousRoutine();
    currentState = STATE_DISARMED;
    return;
  }

  // 3. Operational Mode (CH6 3-Position Switch)
  if (modePulse < 1300) {
    currentState = STATE_MANUAL;
  } else if (modePulse <= 1700) {
    currentState = STATE_HOLD;
  } else {
    currentState = STATE_SEMI_AUTO;
  }

  // Detect state transitions to cleanly enter/exit autonomous mode
  if (previousState != STATE_SEMI_AUTO && currentState == STATE_SEMI_AUTO) {
    resetAutonomousRoutine();
    currentAutoStep = AUTO_MOVE_FORWARD_1;
    autoStepStartTime = millis();
    Serial.println(F("[FSM] Semi-Autonomous routine started."));
  } else if (previousState == STATE_SEMI_AUTO && currentState != STATE_SEMI_AUTO) {
    resetAutonomousRoutine();
    Serial.println(F("[FSM] Semi-Autonomous routine aborted by user."));
  }
  previousState = currentState;

  // 4. Execution Dispatcher
  switch (currentState) {
    case STATE_MANUAL:
      processManualDrive(throttle, steer);
      processManualActuator(actuator);
      break;

    case STATE_HOLD:
      stopAllOutputs();
      break;

    case STATE_SEMI_AUTO:
      runSemiAutonomousRoutine();
      break;

    case STATE_DISARMED:
    default:
      stopAllOutputs();
      break;
  }

  delay(10); // 100 Hz refresh
}

// =================================================================
// SEMI-AUTONOMOUS FINITE STATE MACHINE (FSM)
// =================================================================
void resetAutonomousRoutine() {
  currentAutoStep = AUTO_IDLE;
  autoStepStartTime = 0;
  autoElapsedBeforePause = 0;
  isObstaclePaused = false;
  stopAllOutputs();
}

void advanceToNextStep(AutoStep nextStep) {
  stopAllOutputs();
  currentAutoStep = nextStep;
  autoStepStartTime = millis();
  autoElapsedBeforePause = 0;
  isObstaclePaused = false;
}

void runSemiAutonomousRoutine() {
  unsigned long now = millis();
  unsigned long activeDuration = now - autoStepStartTime;

  switch (currentAutoStep) {

    // --- STEP 1: DRIVE FORWARD ---
    case AUTO_MOVE_FORWARD_1: {
      const unsigned long STEP_DURATION = 4000; // 4 seconds forward drive

      // Obstacle detection during forward motion
      if (currentObstacleDist <= OBSTACLE_DISTANCE_CM) {
        if (!isObstaclePaused) {
          stopDriveMotors();
          autoElapsedBeforePause += (now - autoStepStartTime);
          isObstaclePaused = true;
          Serial.println(F("[AUTO] Obstacle detected! Pausing movement."));
        }
        return; // Halt until clear
      } else if (isObstaclePaused) {
        // Obstacle cleared: resume timing
        autoStepStartTime = now;
        isObstaclePaused = false;
        Serial.println(F("[AUTO] Obstacle cleared. Resuming movement."));
      }

      if ((activeDuration + autoElapsedBeforePause) < STEP_DURATION) {
        setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, AUTO_DRIVE_SPEED);
        setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, AUTO_DRIVE_SPEED);
      } else {
        Serial.println(F("[AUTO] Waypoint 1 reached. Lowering probe..."));
        advanceToNextStep(AUTO_ACTUATOR_DOWN_1);
      }
      break;
    }

    // --- STEP 2: LOWER ACTUATOR INTO GROUND ---
    case AUTO_ACTUATOR_DOWN_1: {
      const unsigned long EXTEND_DURATION = 3500; // 3.5 seconds extension

      if (activeDuration < EXTEND_DURATION) {
        setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, AUTO_ACTUATOR_SPEED);
      } else {
        Serial.println(F("[AUTO] Probe inserted. Beginning soil sampling..."));
        // Transmit trigger event to ESP32 via Serial2
        Serial2.println(F("{\"cmd\":\"START_SOIL_READING\"}"));
        advanceToNextStep(AUTO_SOIL_TEST_1);
      }
      break;
    }

    // --- STEP 3: DWELL & READ SENSORS ---
    case AUTO_SOIL_TEST_1: {
      const unsigned long DWELL_DURATION = 4000; // 4 seconds settling/measurement

      stopAllOutputs(); // Everything holds still
      if (activeDuration >= DWELL_DURATION) {
        Serial.println(F("[AUTO] Sampling complete. Retracting probe..."));
        advanceToNextStep(AUTO_ACTUATOR_UP_1);
      }
      break;
    }

    // --- STEP 4: RETRACT ACTUATOR FULLY ---
    case AUTO_ACTUATOR_UP_1: {
      const unsigned long RETRACT_DURATION = 3500; // 3.5 seconds retraction

      if (activeDuration < RETRACT_DURATION) {
        setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, -AUTO_ACTUATOR_SPEED);
      } else {
        Serial.println(F("[AUTO] Probe stowed. Turning left 90 deg..."));
        advanceToNextStep(AUTO_TURN_LEFT);
      }
      break;
    }

    // --- STEP 5: PIVOT TURN LEFT ---
    case AUTO_TURN_LEFT: {
      const unsigned long TURN_DURATION = 1500; // Calibrate for a 90-degree pivot

      if (activeDuration < TURN_DURATION) {
        // Left wheel backwards, Right wheel forwards
        setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, -AUTO_TURN_SPEED);
        setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, AUTO_TURN_SPEED);
      } else {
        Serial.println(F("[AUTO] Turn complete. Driving forward to Waypoint 2..."));
        advanceToNextStep(AUTO_MOVE_FORWARD_2);
      }
      break;
    }

    // --- STEP 6: DRIVE FORWARD TO SECOND POINT ---
    case AUTO_MOVE_FORWARD_2: {
      const unsigned long STEP_DURATION = 4000;

      if (currentObstacleDist <= OBSTACLE_DISTANCE_CM) {
        if (!isObstaclePaused) {
          stopDriveMotors();
          autoElapsedBeforePause += (now - autoStepStartTime);
          isObstaclePaused = true;
        }
        return;
      } else if (isObstaclePaused) {
        autoStepStartTime = now;
        isObstaclePaused = false;
      }

      if ((activeDuration + autoElapsedBeforePause) < STEP_DURATION) {
        setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, AUTO_DRIVE_SPEED);
        setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, AUTO_DRIVE_SPEED);
      } else {
        Serial.println(F("[AUTO] Waypoint 2 reached. Lowering probe..."));
        advanceToNextStep(AUTO_ACTUATOR_DOWN_2);
      }
      break;
    }

    // --- STEP 7: LOWER ACTUATOR AGAIN ---
    case AUTO_ACTUATOR_DOWN_2: {
      const unsigned long EXTEND_DURATION = 3500;

      if (activeDuration < EXTEND_DURATION) {
        setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, AUTO_ACTUATOR_SPEED);
      } else {
        Serial2.println(F("{\"cmd\":\"START_SOIL_READING\"}"));
        advanceToNextStep(AUTO_SOIL_TEST_2);
      }
      break;
    }

    // --- STEP 8: SECOND SAMPLING DWELL ---
    case AUTO_SOIL_TEST_2: {
      const unsigned long DWELL_DURATION = 4000;

      stopAllOutputs();
      if (activeDuration >= DWELL_DURATION) {
        advanceToNextStep(AUTO_ACTUATOR_UP_2);
      }
      break;
    }

    // --- STEP 9: RETRACT PROBE ---
    case AUTO_ACTUATOR_UP_2: {
      const unsigned long RETRACT_DURATION = 3500;

      if (activeDuration < RETRACT_DURATION) {
        setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, -AUTO_ACTUATOR_SPEED);
      } else {
        Serial.println(F("[AUTO] Mission accomplished! Entering complete state."));
        advanceToNextStep(AUTO_COMPLETE);
      }
      break;
    }

    // --- STEP 10: MISSION COMPLETE ---
    case AUTO_COMPLETE:
    case AUTO_IDLE:
    default:
      stopAllOutputs();
      break;
  }
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

void stopActuator() {
  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, 0);
}

void stopAllOutputs() {
  stopDriveMotors();
  stopActuator();
}

// =================================================================
// SENSORS & MANUAL PROCESSING
// =================================================================
void updateUltrasonicDistance() {
  if (millis() - lastPingTime >= PING_INTERVAL_MS) {
    lastPingTime = millis();

    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    unsigned long duration = pulseIn(PIN_ECHO, HIGH, 8000); // 8ms timeout (~137 cm)

    if (duration == 0) {
      currentObstacleDist = 999;
    } else {
      currentObstacleDist = (unsigned int)(duration * 0.0343 / 2.0);
    }
  }
}

void processManualDrive(uint16_t throttleRaw, uint16_t steerRaw) {
  int throttle = (int)throttleRaw - RC_MID;
  int steer    = (int)steerRaw - RC_MID;

  if (abs(throttle) < RC_DEADZONE) throttle = 0;
  if (abs(steer) < RC_DEADZONE)    steer = 0;

  // Obstacle avoidance safety in manual mode
  if (currentObstacleDist <= OBSTACLE_DISTANCE_CM && throttle > 0) {
    throttle = 0;
  }

  int fwdSpeed  = map(throttle, -500, 500, -255, 255);
  int turnSpeed = map(steer, -500, 500, -255, 255);

  int leftSpeed  = fwdSpeed + turnSpeed;
  int rightSpeed = fwdSpeed - turnSpeed;

  setMotorSpeed(PIN_L_RPWM, PIN_L_LPWM, leftSpeed);
  setMotorSpeed(PIN_R_RPWM, PIN_R_LPWM, rightSpeed);
}

void processManualActuator(uint16_t actRaw) {
  int input = (int)actRaw - RC_MID;

  if (abs(input) < RC_DEADZONE) {
    stopActuator();
    return;
  }

  int actSpeed = map(input, -500, 500, -255, 255);
  setMotorSpeed(PIN_ACT_RPWM, PIN_ACT_LPWM, actSpeed);
}