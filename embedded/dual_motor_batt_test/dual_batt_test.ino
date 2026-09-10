// Motor 1 Pins (Left Side)
const int RPWM1 = 5;  // Forward PWM
const int LPWM1 = 6;  // Reverse PWM
const int REN1 = 7;   // Forward Enable
const int LEN1 = 8;   // Reverse Enable
const int R_IS1 = A0; // Current Diagnostic Pin 1

// Motor 2 Pins (Right Side)
const int RPWM2 = 9;  // Forward PWM
const int LPWM2 = 10; // Reverse PWM
const int REN2 = 11;  // Forward Enable
const int LEN2 = 12;  // Reverse Enable
const int R_IS2 = A1; // Current Diagnostic Pin 2

// Safe maximum PWM for 12V motor on a 16.8V LiPo
const int MAX_SPEED = 180; 

unsigned long previousMillis = 0;
const long interval = 1000; 

void setup() {
  Serial.begin(9600);
  
  // Initialize Motor 1 Pins
  pinMode(RPWM1, OUTPUT);
  pinMode(LPWM1, OUTPUT);
  pinMode(REN1, OUTPUT);
  pinMode(LEN1, OUTPUT);
  digitalWrite(REN1, HIGH);
  digitalWrite(LEN1, HIGH);

  // Initialize Motor 2 Pins
  pinMode(RPWM2, OUTPUT);
  pinMode(LPWM2, OUTPUT);
  pinMode(REN2, OUTPUT);
  pinMode(LEN2, OUTPUT);
  digitalWrite(REN2, HIGH);
  digitalWrite(LEN2, HIGH);

  // Smooth ramp-up for both motors simultaneously 
  Serial.println("Starting dual motor ramp-up...");
  for(int speed = 0; speed <= MAX_SPEED; speed++) {
    analogWrite(LPWM1, 0); 
    analogWrite(RPWM1, speed);
    analogWrite(LPWM2, 0); 
    analogWrite(RPWM2, speed);
    delay(20); 
  }
  
  Serial.println("Motors at test speed. Logging consumption...");
  Serial.println("Time(s) \t Motor1_mA \t Motor2_mA \t Total_mA");
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    // Read the analog voltage from both R_IS pins
    int sensor1 = analogRead(R_IS1);
    int sensor2 = analogRead(R_IS2);
    
    // Convert logic for Motor 1
    float voltage1 = (sensor1 * 5.0) / 1023.0; 
    float mA1 = (voltage1 / 1.176) * 1000.0;

    // Convert logic for Motor 2
    float voltage2 = (sensor2 * 5.0) / 1023.0; 
    float mA2 = (voltage2 / 1.176) * 1000.0;

    // Calculate total system draw
    float total_mA = mA1 + mA2;

    Serial.print(currentMillis / 1000);
    Serial.print(" \t\t ");
    Serial.print(mA1);
    Serial.print(" \t\t ");
    Serial.print(mA2);
    Serial.print(" \t\t ");
    Serial.println(total_mA);
  }
  
  // Maintain constant forward speed for both
  analogWrite(LPWM1, 0); 
  analogWrite(RPWM1, MAX_SPEED); 
  analogWrite(LPWM2, 0); 
  analogWrite(RPWM2, MAX_SPEED); 
}