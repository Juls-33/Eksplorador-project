// Pin Definitions for BTS7960 on Arduino Uno
const int RPWM_PIN = 6; // Right PWM (Forward speed) - Uno PWM pin
const int LPWM_PIN = 5; // Left PWM (Reverse speed) - Uno PWM pin
const int R_EN_PIN = 7; // Right Enable
const int L_EN_PIN = 8; // Left Enable

// Motor Speed (0 to 255)
const int MOTOR_SPEED = 200; 

void setup() {
  Serial.begin(9600);

  pinMode(RPWM_PIN, OUTPUT);
  pinMode(LPWM_PIN, OUTPUT);
  pinMode(R_EN_PIN, OUTPUT);
  pinMode(L_EN_PIN, OUTPUT);

  // Enable both half-bridge channels
  digitalWrite(R_EN_PIN, HIGH);
  digitalWrite(L_EN_PIN, HIGH);

  // Start with motor stopped
  stopMotor();

  Serial.println("--- Arduino Uno BTS7960 Diagnostic Test ---");
  Serial.println("Commands:");
  Serial.println("  'f' or 'F' -> Forward");
  Serial.println("  'b' or 'B' -> Backwards / Reverse");
  Serial.println("  's' or 'S' -> Stop / Brake");
  Serial.println("-------------------------------------------");
}

void loop() {
  if (Serial.available() > 0) {
    char cmd = Serial.read();

    switch (cmd) {
      case 'f':
      case 'F':
        moveForward();
        break;

      case 'b':
      case 'B':
        moveBackward();
        break;

      case 's':
      case 'S':
        stopMotor();
        break;

      default:
        // Ignore whitespace/newline
        break;
    }
  }
}

void moveForward() {
  Serial.println("Action: Moving FORWARD");
  analogWrite(LPWM_PIN, 0);
  analogWrite(RPWM_PIN, MOTOR_SPEED);
}

void moveBackward() {
  Serial.println("Action: Moving BACKWARD");
  analogWrite(RPWM_PIN, 0);
  analogWrite(LPWM_PIN, MOTOR_SPEED);
}

void stopMotor() {
  Serial.println("Action: STOPPED");
  analogWrite(RPWM_PIN, 0);
  analogWrite(LPWM_PIN, 0);
}