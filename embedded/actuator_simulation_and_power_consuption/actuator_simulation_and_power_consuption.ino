int RPWM = 5;
int LPWM = 6;

void setup() {
  pinMode(RPWM, OUTPUT);
  pinMode(LPWM, OUTPUT);

  // 5-second safety delay before the batch starts
  delay(5000);

  // Run exactly 25 simulated soil plots
  for (int i = 1; i <= 25; i++) {
    // 1. EXTEND: Half depth (~80mm)
    analogWrite(RPWM, 185); 
    analogWrite(LPWM, 0);
    delay(8000); 

    // 2. READ: Simulate the 5-pin sensor gathering data
    analogWrite(RPWM, 0);
    analogWrite(LPWM, 0);
    delay(5000); 

    // 3. RETRACT: Pull probe out completely
    analogWrite(RPWM, 0);
    analogWrite(LPWM, 185);
    delay(9000);

    // 4. IDLE: Simulate the rover driving to the next 10-meter node
    analogWrite(RPWM, 0);
    analogWrite(LPWM, 0);
    delay(10000);
  }
}

void loop() {
  // The test is complete. Keep the motor driver completely off.
  analogWrite(RPWM, 0);
  analogWrite(LPWM, 0);
}