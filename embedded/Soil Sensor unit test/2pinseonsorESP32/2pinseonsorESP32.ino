#include <Arduino.h>

#define SOIL_ANALOG_PIN 34

// Updated Calibration Values
// Measure these with your specific sensor:
int dryValue = 3300; // Raw ADC when completely in air
int wetValue = 500;  // Raw ADC when fully submerged in water (or saturated mud)

void setup() {
  Serial.begin(115200);
  analogReadResolution(12); // ESP32 12-bit ADC (0 - 4095)
  delay(1000);
}

void loop() {
  int rawADC = analogRead(SOIL_ANALOG_PIN);

  // Map raw ADC to percentage
  int moisturePercent = map(rawADC, dryValue, wetValue, 0, 100);
  moisturePercent = constrain(moisturePercent, 0, 100);

  float voltage = (rawADC / 4095.0) * 3.3;

  Serial.print("Raw ADC Value: ");
  Serial.print(rawADC);
  Serial.print("  | Voltage: ");
  Serial.print(voltage, 2);
  Serial.print(" V  | Moisture: ");
  Serial.print(moisturePercent);
  Serial.println(" %");

  delay(1000);
}