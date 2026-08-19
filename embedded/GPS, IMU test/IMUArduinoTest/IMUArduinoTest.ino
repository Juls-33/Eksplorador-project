#include <Wire.h>

const uint8_t MPU_ADDR = 0x68;

void setup() {
  Serial.begin(115200);
  while (!Serial);
  Wire.begin();

  // Wake up MPU-6050
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); // PWR_MGMT_1 register
  Wire.write(0x00); // Clear sleep bit
  Wire.endTransmission();

  Wire.setWireTimeout(3000, true); // 3ms timeout, reset bus on timeout
  delay(100);
  Serial.println(F("AccX(g)\tAccY(g)\tAccZ(g)\tGyroX(dps)\tGyroY(dps)\tGyroZ(dps)\tTemp(C)"));
}

void loop() {
  // Request all 14 data registers starting at ACCEL_XOUT_H (0x3B)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (uint8_t)14);

  // Read raw 16-bit values
  int16_t rawAx = (Wire.read() << 8) | Wire.read();
  int16_t rawAy = (Wire.read() << 8) | Wire.read();
  int16_t rawAz = (Wire.read() << 8) | Wire.read();
  int16_t rawTemp = (Wire.read() << 8) | Wire.read();
  int16_t rawGx = (Wire.read() << 8) | Wire.read();
  int16_t rawGy = (Wire.read() << 8) | Wire.read();
  int16_t rawGz = (Wire.read() << 8) | Wire.read();

  // Convert raw readings to physical units (default: ±2g, ±250 deg/s)
  float ax = rawAx / 16384.0;
  float ay = rawAy / 16384.0;
  float az = rawAz / 16384.0;
  float gx = rawGx / 131.0;
  float gy = rawGy / 131.0;
  float gz = rawGz / 131.0;
  float tempC = (rawTemp / 340.0) + 36.53;

  // Print values formatted with tabs
  Serial.print(ax, 2); Serial.print(F("\t"));
  Serial.print(ay, 2); Serial.print(F("\t"));
  Serial.print(az, 2); Serial.print(F("\t"));
  Serial.print(gx, 2); Serial.print(F("\t"));
  Serial.print(gy, 2); Serial.print(F("\t"));
  Serial.print(gz, 2); Serial.print(F("\t"));
  Serial.println(tempC, 1);

  delay(100); // ~20 Hz update rate
}