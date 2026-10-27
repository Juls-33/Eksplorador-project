#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <math.h>

// ESP32 <-> Mega Serial2 (existing pins, unchanged)
#define RX2_PIN 25
#define TX2_PIN 33
#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26

// MPU-6050 on ESP32 I2C: adjust if your actual pins differ.
#define IMU_SDA 21
#define IMU_SCL 22
#define MPU_ADDR 0x68   // change to 0x69 if AD0 is HIGH

const unsigned long IMU_PERIOD_MS = 50; // 20 Hz; Mega timeout 350ms
const unsigned long TELEMETRY_PERIOD_MS = 2000;
const float FILTER_ALPHA = 0.22f;

bool isTxMode = true;
bool imuAvailable = false;
bool loraReady = false;
bool haveOrientation = false;
float filteredPitch = 0.0f, filteredRoll = 0.0f;
unsigned long lastIMU = 0, lastTelemetryTime = 0, lastDiagnostic = 0;
float mockLat = 14.609f;
float mockLng = 120.982f;
uint32_t mockPacketID = 1;
char megaLine[80];
uint8_t megaLen = 0;

bool writeMPU(uint8_t reg, uint8_t data) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(data);
  return Wire.endTransmission() == 0;
}

bool initMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75); // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)1) != 1) return false;
  uint8_t who = Wire.read();
  if (who != 0x68 && who != 0x70) return false;
  return writeMPU(0x6B, 0x00) &&  // wake
         writeMPU(0x1C, 0x00) &&  // accelerometer ±2g
         writeMPU(0x1A, 0x03);   // low-pass filter
}

bool readMPU(float &pitch, float &roll) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)6) != 6) return false;
  int16_t ax = (int16_t)((Wire.read() << 8) | Wire.read());
  int16_t ay = (int16_t)((Wire.read() << 8) | Wire.read());
  int16_t az = (int16_t)((Wire.read() << 8) | Wire.read());
  float x = ax / 16384.0f, y = ay / 16384.0f, z = az / 16384.0f;
  float magnitude = sqrtf(x*x + y*y + z*z);
  // Dynamic acceleration corrupts inclination readings: invalidate outliers.
  if (!isfinite(magnitude) || magnitude < 0.78f || magnitude > 1.22f) return false;
  pitch = atan2f(-x, sqrtf(y*y + z*z)) * 180.0f / PI;
  roll = atan2f(y, z) * 180.0f / PI;
  return isfinite(pitch) && isfinite(roll);
}

void updateAndSendIMU() {
  if (millis() - lastIMU < IMU_PERIOD_MS) return;
  lastIMU = millis();
  float pitch, roll;
  if (!imuAvailable) {
    // retry instead of locking up LoRa
    static unsigned long lastRetry = 0;
    if (millis() - lastRetry >= 1000) {
      lastRetry = millis();
      imuAvailable = initMPU();
      if (imuAvailable) haveOrientation = false;
    }
  }
  bool ok = imuAvailable && readMPU(pitch, roll);
  if (ok) {
    if (!haveOrientation) {
      filteredPitch = pitch;
      filteredRoll = roll;
      haveOrientation = true;
    } else {
      filteredPitch += FILTER_ALPHA * (pitch - filteredPitch);
      filteredRoll += FILTER_ALPHA * (roll - filteredRoll);
    }
    Serial2.print("IMU:");
    Serial2.print(filteredPitch, 2);
    Serial2.print(',');
    Serial2.print(filteredRoll, 2);
    Serial2.println(",1");
  } else {
    Serial2.println("IMU:0,0,0");
    if (imuAvailable) { // keep retrying without claiming valid measurement
      static uint8_t failures = 0;
      if (++failures >= 20) { imuAvailable = false; failures = 0; }
    }
  }
  if (millis() - lastDiagnostic >= 500) {
    lastDiagnostic = millis();
    Serial.print("[IMU] valid="); Serial.print(ok);
    Serial.print(" pitch="); Serial.print(filteredPitch, 2);
    Serial.print(" roll="); Serial.println(filteredRoll, 2);
  }
}

void processMegaCommand(const char *command) {
  if (strcmp(command, "SET_MODE:RX") == 0) {
    isTxMode = false;
    Serial.println("[MODE] RECEIVE");
    Serial2.println("ACK: LoRa set to RX mode.");
    if (loraReady) LoRa.receive();
  } else if (strcmp(command, "SET_MODE:TX") == 0) {
    isTxMode = true;
    Serial.println("[MODE] TRANSMIT");
    Serial2.println("ACK: LoRa set to TX mode.");
  } else if (strncmp(command, "FAULT:", 6) == 0) {
    Serial.print("[MEGA SAFETY] "); Serial.println(command);
    // No autonomous mission is resumed here.
  }
}

void readMegaSerial() {
  uint8_t budget = 96;
  while (Serial2.available() && budget--) {
    char c = (char)Serial2.read();
    if (c == '\r') continue;
    if (c == '\n') {
      megaLine[megaLen] = '\0';
      if (megaLen) processMegaCommand(megaLine);
      megaLen = 0;
    } else if (megaLen < sizeof(megaLine)-1) {
      megaLine[megaLen++] = c;
    } else megaLen = 0;
  }
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  Wire.begin(IMU_SDA, IMU_SCL);
  Wire.setClock(100000);
  imuAvailable = initMPU();
  Serial.println(imuAvailable ? "[MPU6050] Ready" : "[MPU6050] Not found; actuator will stay inhibited");
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  loraReady = LoRa.begin(433E6);
  if (!loraReady) {
    Serial.println("LoRa Initialization Failed! Check wiring.");
    // Keep sending IMU even if LoRa is unavailable.
  } else {
    LoRa.setSyncWord(0xF3);
    LoRa.enableCrc();
    Serial.println("LoRa Initialized Successfully!");
  }
}

void loop() {
  updateAndSendIMU();
  readMegaSerial();
  if (!loraReady) { delay(2); return; }
  if (isTxMode) {
    if (millis() - lastTelemetryTime >= TELEMETRY_PERIOD_MS) {
      lastTelemetryTime = millis();
      mockLat += 0.0001f;
      String payload = "DATA:" + String(mockPacketID) + ",12,12," +
        String(mockLat, 6) + "," + String(mockLng, 6) +
        ",0.0,0.0,0.0,0.0,0.0,1,25.0,50.0,100,7.0,0,0,0,0";
      LoRa.beginPacket();
      LoRa.print(payload);
      LoRa.endPacket();
      Serial.print("[LoRa TX] Sent: "); Serial.println(payload);
      mockPacketID++;
    }
  } else {
    int packetSize = LoRa.parsePacket();
    if (packetSize) {
      String data;
      while (LoRa.available()) data += (char)LoRa.read();
      Serial.print("[LoRa RX] "); Serial.println(data);
      Serial2.println("RCV:" + data);
      LoRa.beginPacket();
      LoRa.print("ACK:" + data);
      LoRa.endPacket();
      LoRa.receive();
    }
  }
  delay(2);
}
