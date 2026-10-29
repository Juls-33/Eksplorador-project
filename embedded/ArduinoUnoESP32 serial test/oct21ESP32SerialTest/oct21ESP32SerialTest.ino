
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <TinyGPS++.h>
#include <math.h>
#include <stdlib.h>

// ESP32 -> Mega Serial2:
// TX33 -> Mega RX2/17
// RX25 <- voltage divider <- Mega TX2/16
#define MEGA_RX 25
#define MEGA_TX 33

#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26

#define GPS_RX 32
#define MPU_ADDR 0x68
#define IMU_SDA 21
#define IMU_SCL 22

HardwareSerial gpsUART(1);
TinyGPSPlus gps;
TinyGPSCustom satsGPGSV(gps, "GPGSV", 3);
TinyGPSCustom satsGNGSV(gps, "GNGSV", 3);

const uint32_t IMU_MS = 50;
const uint32_t TELEMETRY_MS = 2000;
const uint32_t SOIL_MAX_AGE = 5000;
const uint32_t GPS_MAX_AGE = 3000;
const float IMU_ALPHA = 0.22f;

bool imuReady = false;
bool haveAngles = false;
bool loraReady = false;
bool txMode = true;

float pitchFilt = 0;
float rollFilt = 0;
float accX = 0;
float accY = 0;
float accZ = 0;
float gyroZ = 0;

uint32_t lastIMU = 0;
uint32_t lastTelemetry = 0;
uint32_t lastDiag = 0;
uint32_t lastSoil = 0;
uint32_t packetId = 1;

struct Soil {
  bool valid = false;
  float temp = 0;
  float moisture = 0;
  float ph = 0;
  unsigned ec = 0;
  unsigned sal = 0;
  unsigned n = 0;
  unsigned p = 0;
  unsigned k = 0;
} soil;

char inLine[160];
uint8_t inLen = 0;
bool discardLine = false;

// ================= IMU =================

bool mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool initMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);

  if (Wire.endTransmission(false) != 0 ||
      Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)1) != 1)
    return false;

  uint8_t id = Wire.read();

  if (id != 0x68 && id != 0x70)
    return false;

  return mpuWrite(0x6B, 0) &&
         mpuWrite(0x1C, 0) &&
         mpuWrite(0x1A, 3);
}

bool readIMU(float &p, float &r) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0 ||
      Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)14) != 14)
    return false;

  int16_t x = (Wire.read() << 8) | Wire.read();
  int16_t y = (Wire.read() << 8) | Wire.read();
  int16_t z = (Wire.read() << 8) | Wire.read();

  Wire.read();
  Wire.read();

  Wire.read();
  Wire.read();
  Wire.read();
  Wire.read();

  int16_t gz = (Wire.read() << 8) | Wire.read();

  float fx = x / 16384.0f;
  float fy = y / 16384.0f;
  float fz = z / 16384.0f;

  float mag = sqrtf(fx * fx + fy * fy + fz * fz);

  if (!isfinite(mag) || mag < 0.78f || mag > 1.22f)
    return false;

  p = atan2f(-fx, sqrtf(fy * fy + fz * fz)) * 180.0f / PI;
  r = atan2f(fy, fz) * 180.0f / PI;

  accX = fx;
  accY = fy;
  accZ = fz;
  gyroZ = gz / 131.0f;

  return isfinite(p) && isfinite(r);
}

void serviceIMU() {
  if (millis() - lastIMU < IMU_MS)
    return;

  lastIMU = millis();

  static uint32_t retryAt = 0;
  static uint8_t fail = 0;

  if (!imuReady && millis() - retryAt >= 1000) {
    retryAt = millis();
    imuReady = initMPU();
    haveAngles = false;
  }

  float p, r;
  bool good = imuReady && readIMU(p, r);

  if (good) {
    fail = 0;

    if (!haveAngles) {
      pitchFilt = p;
      rollFilt = r;
      haveAngles = true;
    } else {
      pitchFilt += IMU_ALPHA * (p - pitchFilt);
      rollFilt += IMU_ALPHA * (r - rollFilt);
    }

    Serial2.print("IMU:");
    Serial2.print(pitchFilt, 2);
    Serial2.print(',');
    Serial2.print(rollFilt, 2);
    Serial2.println(",1");

  } else {
    haveAngles = false;
    Serial2.println("IMU:0,0,0");

    if (imuReady && ++fail >= 20) {
      imuReady = false;
      fail = 0;
    }
  }

  if (millis() - lastDiag >= 1000) {
    lastDiag = millis();

    Serial.printf(
      "[IMU] valid=%d P=%.2f R=%.2f "
      "[GPS] fix=%d chars=%lu "
      "[SOIL] fresh=%d valid=%d\n",
      good,
      pitchFilt,
      rollFilt,
      gps.location.isValid() &&
        gps.location.age() < GPS_MAX_AGE,
      (unsigned long)gps.charsProcessed(),
      millis() - lastSoil < SOIL_MAX_AGE,
      soil.valid
    );
  }
}

// ================= SOIL =================

// Expected Mega message:
// SOIL:valid,temp,moist,ec,pH,salinity,N,P,K

bool parseSoil(const char *line) {
  if (strncmp(line, "SOIL:", 5))
    return false;

  char tmp[160];
  strncpy(tmp, line + 5, sizeof(tmp) - 1);
  tmp[sizeof(tmp) - 1] = 0;

  char *tok = strtok(tmp, ",");
  double v[9];

  for (int i = 0; i < 9; i++) {
    if (!tok)
      return false;

    char *end;
    v[i] = strtod(tok, &end);

    if (end == tok || *end || !isfinite(v[i]))
      return false;

    tok = strtok(NULL, ",");
  }

  if (tok ||
      (v[0] != 0 && v[0] != 1) ||
      v[1] < -50 || v[1] > 100 ||
      v[2] < 0 || v[2] > 100 ||
      v[3] < 0 ||
      v[4] < 0 || v[4] > 14)
    return false;

  soil.valid = (v[0] == 1);
  soil.temp = v[1];
  soil.moisture = v[2];
  soil.ec = (unsigned)v[3];
  soil.ph = v[4];
  soil.sal = (unsigned)v[5];
  soil.n = (unsigned)v[6];
  soil.p = (unsigned)v[7];
  soil.k = (unsigned)v[8];

  lastSoil = millis();
  return true;
}

// ================= MEGA UART =================

void processMegaLine(const char *s) {
  if (!strcmp(s, "SET_MODE:RX")) {
    txMode = false;
    Serial.println("[MODE] RX");
    Serial2.println("ACK: LoRa set to RX mode.");

    if (loraReady)
      LoRa.receive();

  } else if (!strcmp(s, "SET_MODE:TX")) {
    txMode = true;
    Serial.println("[MODE] TX");
    Serial2.println("ACK: LoRa set to TX mode.");

    if (loraReady)
      LoRa.idle();

  } else if (!strncmp(s, "SOIL:", 5)) {
    if (!parseSoil(s))
      Serial.println("[SOIL] rejected malformed data");

  } else if (!strncmp(s, "MISSION_STATUS:", 15)) {
    Serial.print("[MEGA MISSION] ");
    Serial.println(s + 15);
  } else if (!strncmp(s, "FAULT:", 6)) {
    Serial.print("[MEGA SAFETY] ");
    Serial.println(s);
  }
}

void readMega() {
  uint16_t budget = 192;

  while (Serial2.available() && budget--) {
    char c = Serial2.read();

    if (c == '\r')
      continue;

    if (c == '\n') {
      if (!discardLine) {
        inLine[inLen] = 0;

        if (inLen)
          processMegaLine(inLine);
      }

      inLen = 0;
      discardLine = false;

    } else if (!discardLine) {
      if (inLen < sizeof(inLine) - 1) {
        inLine[inLen++] = c;
      } else {
        inLen = 0;
        discardLine = true;
      }
    }
  }
}

// ================= GPS =================

void readGPS() {
  uint16_t budget = 256;

  while (gpsUART.available() && budget--) {
    gps.encode((char)gpsUART.read());
  }
}

// ================= LORA TX / ACK =================

char txPayload[280];
bool awaitingAck = false;
uint8_t attempts = 0;
uint32_t sentAt = 0;

void sendCurrent() {
  LoRa.idle();

  if (!LoRa.beginPacket())
    return;

  LoRa.print(txPayload);
  int ok = LoRa.endPacket();

  if (ok) {
    attempts++;
    sentAt = millis();

    Serial.printf(
      "[TX] attempt %u packet %lu %s\n",
      attempts,
      (unsigned long)packetId,
      txPayload
    );

    LoRa.receive();
  }
}

void serviceTx() {
  if (awaitingAck) {
    int sz = LoRa.parsePacket();

    if (sz) {
      String resp;

      while (LoRa.available())
        resp += (char)LoRa.read();

      resp.trim();

      if (resp == "ACK:" + String(packetId)) {
        Serial.printf(
          "[ACK] %lu\n",
          (unsigned long)packetId
        );

        awaitingAck = false;
        packetId++;
      }
    }

    if (awaitingAck && millis() - sentAt >= 600) {
      if (attempts < 3) {
        sendCurrent();
      } else {
        Serial.printf(
          "[DROP] %lu no ACK\n",
          (unsigned long)packetId
        );

        awaitingAck = false;
        packetId++;
      }
    }

    return;
  }

  if (millis() - lastTelemetry < TELEMETRY_MS)
    return;

  lastTelemetry = millis();

  // Always transmit, even with invalid sensors.
  bool gpsFresh =
    gps.location.isValid() &&
    gps.location.age() <= GPS_MAX_AGE;

  bool soilFresh =
    lastSoil != 0 &&
    millis() - lastSoil <= SOIL_MAX_AGE;

  if (!gpsFresh)
    Serial.println(
      "[SENSOR] GPS unavailable; reporting no fix"
    );

  if (!soilFresh)
    Serial.println(
      "[SENSOR] Soil unavailable; reporting invalid sample"
    );

  unsigned locked =
    gpsFresh && gps.satellites.isValid()
      ? gps.satellites.value()
      : 0;

  unsigned view = 0;

  if (gpsFresh) {
    if (satsGNGSV.isValid())
      view = atoi(satsGNGSV.value());
    else if (satsGPGSV.isValid())
      view = atoi(satsGPGSV.value());
  }

  double latitude =
    gpsFresh ? gps.location.lat() : 0.0;

  double longitude =
    gpsFresh ? gps.location.lng() : 0.0;

  float speed =
    gpsFresh &&
    gps.speed.isValid() &&
    gps.speed.age() < GPS_MAX_AGE
      ? gps.speed.kmph()
      : 0.0f;

  // 19-field payload; compatible with existing schema.
  snprintf(
    txPayload,
    sizeof(txPayload),
    "DATA:%lu,%u,%u,%.6f,%.6f,%.1f,"
    "%.2f,%.2f,%.2f,%.1f,%u,"
    "%.1f,%.1f,%u,%.2f,%u,%u,%u,%u",
    (unsigned long)packetId,
    locked,
    view,
    latitude,
    longitude,
    speed,
    accX,
    accY,
    accZ,
    gyroZ,
    (soilFresh && soil.valid) ? 1 : 0,
    soilFresh ? soil.temp : 0.0f,
    soilFresh ? soil.moisture : 0.0f,
    soilFresh ? soil.ec : 0,
    soilFresh ? soil.ph : 0.0f,
    soilFresh ? soil.sal : 0,
    soilFresh ? soil.n : 0,
    soilFresh ? soil.p : 0,
    soilFresh ? soil.k : 0
  );

  attempts = 0;
  awaitingAck = true;
  sendCurrent();
}

// ================= LORA RX =================

void serviceRx() {
  int sz = LoRa.parsePacket();

  if (!sz)
    return;

  String data;

  while (LoRa.available())
    data += (char)LoRa.read();

  Serial.print("[RX] ");
  Serial.println(data);

  if (data.startsWith("ACK:")) {
    LoRa.receive();
    return;
  }

  if (data.length() > 275) {
    Serial.println("[RX ERROR] Payload too long, not forwarded");
    LoRa.receive();
    return;
  }
  Serial2.println("RCV:" + data);
  Serial.printf("[UART FORWARD] %u payload bytes to Mega\n", (unsigned)data.length());

  LoRa.idle();

  if (LoRa.beginPacket()) {
    LoRa.print("ACK:" + data);
    LoRa.endPacket();
  }

  LoRa.receive();
}

// ================= SETUP =================

void setup() {
  Serial.begin(115200);

  Serial2.begin(
    9600,
    SERIAL_8N1,
    MEGA_RX,
    MEGA_TX
  );

  gpsUART.begin(
    9600,
    SERIAL_8N1,
    GPS_RX,
    -1
  );

  Wire.begin(IMU_SDA, IMU_SCL);
  Wire.setClock(100000);

  imuReady = initMPU();

  LoRa.setPins(
    LORA_SS,
    LORA_RST,
    LORA_DIO0
  );

  loraReady = LoRa.begin(433E6);

  if (loraReady) {
    LoRa.setSyncWord(0xF3);
    LoRa.enableCrc();
  }

  Serial.printf(
    "[BOOT] IMU=%d LoRa=%d "
    "GPS=GPIO32 soil=Mega Serial3\n",
    imuReady,
    loraReady
  );
}

// ================= MAIN LOOP =================

void loop() {
  readGPS();
  serviceIMU();
  readMega();

  if (loraReady) {
    if (txMode) {
      serviceTx();
    } else {
      awaitingAck = false;
      serviceRx();
    }
  }

  delay(1);
}
