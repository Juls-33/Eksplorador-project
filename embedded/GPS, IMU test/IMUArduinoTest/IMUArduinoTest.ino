#include <Wire.h>

const uint8_t MPU_ADDR = 0x68;

// Calibration Offsets
float accX_offset = 0.0, accY_offset = 0.0, accZ_offset = 0.0;
float gyroX_offset = 0.0, gyroY_offset = 0.0, gyroZ_offset = 0.0;

// Filtered values
float filtered_gx = 0.0, filtered_gy = 0.0, filtered_gz = 0.0;
const float ALPHA = 0.2;         // EMA smoothing factor (0.0 to 1.0)
const float DEADBAND = 0.25;      // Gyro noise threshold (dps)

void setDLPF(uint8_t mode) {
  // Register 0x1A - CONFIG (bits 2:0 set DLPF_CFG)
  // Mode 4 = ~20Hz low-pass cutoff (filters motor/table jitter)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1A);
  Wire.write(mode);
  Wire.endTransmission();
}

void calibrateSensor(int samples = 600) {
  Serial.println(F("Calibrating... DO NOT MOVE SENSOR"));
  
  long ax_sum = 0, ay_sum = 0, az_sum = 0;
  long gx_sum = 0, gy_sum = 0, gz_sum = 0;

  for (int i = 0; i < samples; i++) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    Wire.requestFrom(MPU_ADDR, (uint8_t)14);

    ax_sum += (Wire.read() << 8) | Wire.read();
    ay_sum += (Wire.read() << 8) | Wire.read();
    az_sum += (Wire.read() << 8) | Wire.read();
    Wire.read(); Wire.read(); // Skip temp
    gx_sum += (Wire.read() << 8) | Wire.read();
    gy_sum += (Wire.read() << 8) | Wire.read();
    gz_sum += (Wire.read() << 8) | Wire.read();

    delay(2);
  }

  accX_offset  = (ax_sum / (float)samples) / 16384.0;
  accY_offset  = (ay_sum / (float)samples) / 16384.0;
  accZ_offset  = ((az_sum / (float)samples) / 16384.0) - 1.0;

  gyroX_offset = (gx_sum / (float)samples) / 131.0;
  gyroY_offset = (gy_sum / (float)samples) / 131.0;
  gyroZ_offset = (gz_sum / (float)samples) / 131.0;

  Serial.println(F("Done!\n"));
}

void setup() {
  Serial.begin(115200);
  while (!Serial);
  Wire.begin();
  Wire.setClock(400000);
  Wire.setWireTimeout(3000, true);

  // Wake up MPU-6050
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  // Set internal hardware filter (~20 Hz bandwidth)
  setDLPF(0x04);

  delay(100);
  calibrateSensor(600);

  Serial.println(F("AccX(g)\tAccY(g)\tAccZ(g)\tGyroX(dps)\tGyroY(dps)\tGyroZ(dps)\tTemp(C)"));
}

void loop() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return;

  Wire.requestFrom(MPU_ADDR, (uint8_t)14);
  if (Wire.available() == 14) {
    int16_t rawAx = (Wire.read() << 8) | Wire.read();
    int16_t rawAy = (Wire.read() << 8) | Wire.read();
    int16_t rawAz = (Wire.read() << 8) | Wire.read();
    int16_t rawTemp = (Wire.read() << 8) | Wire.read();
    int16_t rawGx = (Wire.read() << 8) | Wire.read();
    int16_t rawGy = (Wire.read() << 8) | Wire.read();
    int16_t rawGz = (Wire.read() << 8) | Wire.read();

    // Accelerometer calibrated
    float ax = (rawAx / 16384.0) - accX_offset;
    float ay = (rawAy / 16384.0) - accY_offset;
    float az = (rawAz / 16384.0) - accZ_offset;

    // Gyroscope calibrated & raw units
    float gx = (rawGx / 131.0) - gyroX_offset;
    float gy = (rawGy / 131.0) - gyroY_offset;
    float gz = (rawGz / 131.0) - gyroZ_offset;

    // 1. Deadband clamping (zero-out residual static noise)
    if (abs(gx) < DEADBAND) gx = 0.0;
    if (abs(gy) < DEADBAND) gy = 0.0;
    if (abs(gz) < DEADBAND) gz = 0.0;

    // 2. Exponential Moving Average (smoothing filter)
    filtered_gx = (ALPHA * gx) + ((1.0 - ALPHA) * filtered_gx);
    filtered_gy = (ALPHA * gy) + ((1.0 - ALPHA) * filtered_gy);
    filtered_gz = (ALPHA * gz) + ((1.0 - ALPHA) * filtered_gz);

    float tempC = (rawTemp / 340.0) + 36.53;

    // Print values
    Serial.print(ax, 2);          Serial.print('\t');
    Serial.print(ay, 2);          Serial.print('\t');
    Serial.print(az, 2);          Serial.print('\t');
    Serial.print(filtered_gx, 2); Serial.print('\t');
    Serial.print(filtered_gy, 2); Serial.print('\t');
    Serial.print(filtered_gz, 2); Serial.print('\t');
    Serial.println(tempC, 1);
  }

  delay(50);
}