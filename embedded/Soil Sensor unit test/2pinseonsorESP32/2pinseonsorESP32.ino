#include <Arduino.h>

// Pin Definition
#define SOIL_ANALOG_PIN 34

// Calibration Values (Adjust these based on your test readings)
// In air (completely dry), the sensor reads HIGH voltage (~3000 - 3500)
// Submerged in water (completely wet), the sensor reads LOW voltage (~1000 - 1500)
int dryValue = 3200; 
int wetValue = 1200; 

void setup() {
  // Start Serial Monitor at 115200 baud
  Serial.begin(115200);
  
  // Set ADC resolution to 12-bit (0 - 4095)
  analogReadResolution(12);

  Serial.println("========================================");
  Serial.println(" ESP32 2-Pin Soil Moisture Sensor Test  ");
  Serial.println("========================================");
  delay(1000);
}

void loop() {
  // Read the raw ADC value (0 - 4095)
  int rawADC = analogRead(SOIL_ANALOG_PIN);

  // Map the raw value to percentage (0% to 100%)
  // Note: dryValue maps to 0% and wetValue maps to 100%
  int moisturePercent = map(rawADC, dryValue, wetValue, 0, 100);

  // Keep percentage bounded between 0% and 100%
  moisturePercent = constrain(moisturePercent, 0, 100);

  // Calculate approximate input voltage (0.0V - 3.3V)
  float voltage = (rawADC / 4095.0) * 3.3;

  // Print results
  Serial.print("Raw ADC Value: ");
  Serial.print(rawADC);
  Serial.print("  | Voltage: ");
  Serial.print(voltage, 2);
  Serial.print(" V  | Moisture: ");
  Serial.print(moisturePercent);
  Serial.println(" %");

  delay(1000); // Read every second
}