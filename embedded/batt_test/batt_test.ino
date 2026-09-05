// BTS7960 Motor Driver Pins
const int RPWM = 5;  // Forward PWM
const int LPWM = 6;  // Reverse PWM
const int REN = 7;   // Forward Enable
const int LEN = 8;   // Reverse Enable

// Current Diagnostic Pin (Connect BTS7960 R_IS to A0)
const int R_IS = A0; 

// Safe maximum PWM for 12V motor on a 16.8V (fully charged 4S) LiPo
// 12V / 16.8V * 255 = ~182. Capped at 180 for safety.
const int MAX_SPEED = 180; 

unsigned long previousMillis = 0;
const long interval = 1000; // Log data every 1 second

void setup() {
  Serial.begin(9600);
  
  pinMode(RPWM, OUTPUT);
  pinMode(LPWM, OUTPUT);
  pinMode(REN, OUTPUT);
  pinMode(LEN, OUTPUT);

  // Enable both H-bridge sides
  digitalWrite(REN, HIGH);
  digitalWrite(LEN, HIGH);

  // Smooth ramp-up to protect gearboxes and limit initial current spike
  Serial.println("Starting motor ramp-up...");
  for(int speed = 0; speed <= MAX_SPEED; speed++) {
    analogWrite(LPWM, 0); 
    analogWrite(RPWM, speed);
    delay(20); 
  }
  
  Serial.println("Motor at test speed. Logging consumption...");
  Serial.println("Time(s) \t Raw_Sensor \t Approx_mA");
}

void loop() {
  unsigned long currentMillis = millis();

  // Log data to Serial Monitor every second without pausing the motor
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    // Read the analog voltage from the R_IS pin
    int sensorValue = analogRead(R_IS);
    
    // BTS7960 Conversion Logic:
    // The IS pin outputs a current proportional to motor current (Ratio ~ 1:8500).
    // The standard breakout board passes this through a 10k resistor to ground.
    // V = I * R -> Voltage = (MotorCurrent / 8500) * 10000
    // MotorCurrent = Voltage / 1.176
    
    float voltage = (sensorValue * 5.0) / 1023.0; 
    float current_mA = (voltage / 1.176) * 1000.0;

    Serial.print(currentMillis / 1000);
    Serial.print(" \t\t ");
    Serial.print(sensorValue);
    Serial.print(" \t\t ");
    Serial.println(current_mA);
  }
  
  // Maintain constant forward speed
  analogWrite(LPWM, 0); 
  analogWrite(RPWM, MAX_SPEED); 
}