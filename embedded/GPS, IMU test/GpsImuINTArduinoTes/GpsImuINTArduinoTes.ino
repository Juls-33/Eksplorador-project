#include <Wire.h>
#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>

static const int GPS_RXPin = 4;
static const int GPS_TXPin = 255;
static const uint32_t GPSBaud = 9600;

SoftwareSerial gpsSerial(GPS_RXPin, GPS_TXPin);
TinyGPSPlus gps;

// Custom NMEA extractor for GSV sentences (Satellites in View / Searched)
TinyGPSCustom satsInView(gps, "GPGSV", 3);
TinyGPSCustom gnssSatsInView(gps, "GNGSV", 3); // For multi-GNSS (NEO-8M default)

const uint8_t MPU_ADDR = 0x68;
unsigned long lastPrintTime = 0;
const unsigned long printInterval = 100; // 10 Hz refresh rate

// Calibration offsets
float accX_offset = 0.0, accY_offset = 0.0, accZ_offset = 0.0;
float gyroX_offset = 0.0, gyroY_offset = 0.0, gyroZ_offset = 0.0;

void calibrateMPU(int samples = 400) {
  Serial.println(F("Calibrating IMU... Keep sensor still."));
  
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

  Serial.println(F("IMU Calibrated!\n"));
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPSBaud);
  
  Wire.begin();
  Wire.setClock(400000);
  Wire.setWireTimeout(3000, true);

  // Wake up MPU-6050
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  // Set DLPF to ~20Hz low-pass filter
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1A);
  Wire.write(0x04);
  Wire.endTransmission();

  delay(100);
  calibrateMPU(400);

  Serial.println(F("AccX\tAccY\tAccZ\tGyrZ\tSatsLocked\tSatsSearched\tLatitude\tLongitude\tSpeed(km/h)"));
}

void loop() {
  // Continuously feed incoming GPS characters
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Periodic display update
  if (millis() - lastPrintTime >= printInterval) {
    lastPrintTime = millis();

    // 1. Read MPU-6050
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    if (Wire.endTransmission(false) == 0) {
      Wire.requestFrom(MPU_ADDR, (uint8_t)14);
      if (Wire.available() == 14) {
        int16_t rawAx = (Wire.read() << 8) | Wire.read();
        int16_t rawAy = (Wire.read() << 8) | Wire.read();
        int16_t rawAz = (Wire.read() << 8) | Wire.read();
        Wire.read(); Wire.read(); // Skip temp
        Wire.read(); Wire.read(); // Skip GyroX
        Wire.read(); Wire.read(); // Skip GyroY
        int16_t rawGz = (Wire.read() << 8) | Wire.read();

        float ax = (rawAx / 16384.0) - accX_offset;
        float ay = (rawAy / 16384.0) - accY_offset;
        float az = (rawAz / 16384.0) - accZ_offset;
        float gz = (rawGz / 131.0) - gyroZ_offset;

        if (abs(gz) < 0.25) gz = 0.0;

        Serial.print(ax, 2); Serial.print('\t');
        Serial.print(ay, 2); Serial.print('\t');
        Serial.print(az, 2); Serial.print('\t');
        Serial.print(gz, 1); Serial.print('\t');
      }
    }

    // 2. Satellites Locked (Used in Fix)
    if (gps.satellites.isValid()) {
      Serial.print(gps.satellites.value());
    } else {
      Serial.print(F("0"));
    }
    Serial.print('\t');

    // 3. Satellites Searched (In View via GSV sentence)
    if (gnssSatsInView.isValid() && strlen(gnssSatsInView.value()) > 0) {
      Serial.print(gnssSatsInView.value());
    } else if (satsInView.isValid() && strlen(satsInView.value()) > 0) {
      Serial.print(satsInView.value());
    } else {
      Serial.print(F("0"));
    }
    Serial.print(F("\t\t"));

    // 4. Coordinates & Speed
    if (gps.location.isValid()) {
      Serial.print(gps.location.lat(), 6);
      Serial.print('\t');
      Serial.print(gps.location.lng(), 6);
    } else {
      Serial.print(F("Searching...\tSearching..."));
    }
    Serial.print('\t');

    if (gps.speed.isValid()) {
      Serial.println(gps.speed.kmph(), 1);
    } else {
      Serial.println(F("0.0"));
    }
  }
}