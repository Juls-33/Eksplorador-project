#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <TinyGPSPlus.h>

// ================= PIN DEFINITIONS =================
#define LORA_SS      5
#define LORA_RST     14
#define LORA_DIO0    2

#define RS485_RX_PIN 16
#define RS485_TX_PIN 17
#define RS485_DE_RE  27

#define GPS_RX_PIN   32
#define GPS_TX_PIN   -1
#define GPS_BAUDRATE 9600

#define I2C_SDA      21
#define I2C_SCL      22
const uint8_t MPU_ADDR = 0x68;

// ================= OBJECTS & STATE =================
HardwareSerial rs485Serial(2);
HardwareSerial gpsSerial(1);
TinyGPSPlus gps;

// Custom NMEA Extractors for Satellites In View
TinyGPSCustom satsInView(gps, "GPGSV", 3);
TinyGPSCustom gnssSatsInView(gps, "GNGSV", 3);

const byte modbusQuery[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x08, 0x44, 0x0C};

float accX_offset = 0.0, accY_offset = 0.0, accZ_offset = 0.0;
float gyroX_offset = 0.0, gyroY_offset = 0.0, gyroZ_offset = 0.0;

unsigned long lastSensorPoll = 0;
const unsigned long pollInterval = 2000;

// ARQ Retransmission Parameters
uint32_t packetSequenceID = 1;
const int MAX_RETRIES = 3;
const unsigned long ACK_TIMEOUT = 600;

// ================= HELPER FUNCTIONS =================
uint16_t calculateCRC(const byte *buf, int len) {
  uint16_t crc = 0xFFFF;
  for (int pos = 0; pos < len; pos++) {
    crc ^= (uint16_t)buf[pos];
    for (int i = 8; i != 0; i--) {
      if ((crc & 0x0001) != 0) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}

void calibrateMPU(int samples = 300) {
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
    Wire.read(); Wire.read();
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
  Serial.println(F("IMU Calibrated successfully."));
}

bool waitForAck(uint32_t expectedID) {
  unsigned long startWait = millis();
  while (millis() - startWait < ACK_TIMEOUT) {
    int packetSize = LoRa.parsePacket();
    if (packetSize) {
      String resp = "";
      while (LoRa.available()) {
        resp += (char)LoRa.read();
      }
      resp.trim();
      if (resp.startsWith("ACK:")) {
        uint32_t ackID = resp.substring(4).toInt();
        if (ackID == expectedID) {
          return true;
        }
      }
    }
    yield();
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  while (!Serial);

  pinMode(RS485_DE_RE, OUTPUT);
  digitalWrite(RS485_DE_RE, LOW);
  rs485Serial.begin(9600, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
  gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1A);
  Wire.write(0x04);
  Wire.endTransmission();
  calibrateMPU(300);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println(F("[ERROR] LoRa init failed."));
    while (1);
  }
  LoRa.setSyncWord(0xF3);
  LoRa.enableCrc();
  Serial.println(F("[OK] TX Node Ready."));
}

void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (millis() - lastSensorPoll >= pollInterval) {
    lastSensorPoll = millis();

    // 1. Read MPU-6050
    float ax = 0, ay = 0, az = 0, gz = 0;
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    if (Wire.endTransmission(false) == 0) {
      Wire.requestFrom(MPU_ADDR, (uint8_t)14);
      if (Wire.available() == 14) {
        int16_t rawAx = (Wire.read() << 8) | Wire.read();
        int16_t rawAy = (Wire.read() << 8) | Wire.read();
        int16_t rawAz = (Wire.read() << 8) | Wire.read();
        Wire.read(); Wire.read();
        Wire.read(); Wire.read();
        int16_t rawGz = (Wire.read() << 8) | Wire.read();

        ax = (rawAx / 16384.0) - accX_offset;
        ay = (rawAy / 16384.0) - accY_offset;
        az = (rawAz / 16384.0) - accZ_offset;
        gz = (rawGz / 131.0) - gyroZ_offset;
        if (abs(gz) < 0.25) gz = 0.0;
      }
    }

    // 2. Read GPS & Satellite Signal Metrics
    uint32_t satsLocked = gps.satellites.isValid() ? gps.satellites.value() : 0;
    uint32_t satsView = 0;
    if (gnssSatsInView.isValid() && strlen(gnssSatsInView.value()) > 0) {
      satsView = atoi(gnssSatsInView.value());
    } else if (satsInView.isValid() && strlen(satsInView.value()) > 0) {
      satsView = atoi(satsInView.value());
    }

    double lat = gps.location.isValid() ? gps.location.lat() : 0.0;
    double lng = gps.location.isValid() ? gps.location.lng() : 0.0;
    float speedKmph = gps.speed.isValid() ? gps.speed.kmph() : 0.0;

    // 3. Read RS485 Soil Probe
    while (rs485Serial.available()) rs485Serial.read();
    digitalWrite(RS485_DE_RE, HIGH);
    delay(2);
    rs485Serial.write(modbusQuery, sizeof(modbusQuery));
    rs485Serial.flush();
    digitalWrite(RS485_DE_RE, LOW);

    byte response[21];
    int bytesRead = 0;
    unsigned long rs485Start = millis();
    while ((millis() - rs485Start < 300) && (bytesRead < 21)) {
      if (rs485Serial.available()) {
        response[bytesRead++] = rs485Serial.read();
      }
    }

    float temperature = 0.0, moisture = 0.0, ph = 0.0;
    uint16_t ec = 0, salinity = 0, nitrogen = 0, phosphorus = 0, potassium = 0;
    bool soilValid = false;

    if (bytesRead >= 21) {
      uint16_t receivedCRC = response[bytesRead - 2] | (response[bytesRead - 1] << 8);
      uint16_t calculatedCRC = calculateCRC(response, bytesRead - 2);

      if (receivedCRC == calculatedCRC) {
        int16_t rawTemp   = (response[3]  << 8) | response[4];
        uint16_t rawMoist = (response[5]  << 8) | response[6];
        ec                = (response[7]  << 8) | response[8];
        salinity          = (response[9]  << 8) | response[10];
        nitrogen          = (response[11] << 8) | response[12];
        phosphorus        = (response[13] << 8) | response[14];
        potassium         = (response[15] << 8) | response[16];
        uint16_t rawPh    = (response[17] << 8) | response[18];

        temperature = rawTemp / 10.0;
        moisture    = rawMoist / 10.0;
        ph          = rawPh / 100.0;
        soilValid   = true;
      }
    }

    // 4. Construct Payload
    char payload[260];
    snprintf(payload, sizeof(payload),
             "DATA:%lu,%u,%u,%.6f,%.6f,%.1f,%.2f,%.2f,%.2f,%.1f,%d,%.1f,%.1f,%u,%.2f,%u,%u,%u,%u",
             (unsigned long)packetSequenceID,
             satsLocked, satsView,
             lat, lng, speedKmph,
             ax, ay, az, gz,
             soilValid ? 1 : 0,
             temperature, moisture, ec, ph, salinity, nitrogen, phosphorus, potassium);

    // 5. Send with ARQ Retransmission
    bool acknowledged = false;
    for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      LoRa.beginPacket();
      LoRa.print(payload);
      LoRa.endPacket();

      Serial.printf("[TX #%lu] (Attempt %d/%d) %s\n", (unsigned long)packetSequenceID, attempt, MAX_RETRIES, payload);

      if (waitForAck(packetSequenceID)) {
        Serial.printf("[ACK RECEIVED] Packet #%lu verified.\n", (unsigned long)packetSequenceID);
        acknowledged = true;
        break;
      } else {
        Serial.printf("[WARNING] Timeout waiting for ACK on #%lu.\n", (unsigned long)packetSequenceID);
        delay(50 * attempt);
      }
    }

    if (!acknowledged) {
      Serial.printf("[DROP] Packet #%lu failed after %d retries.\n", (unsigned long)packetSequenceID, MAX_RETRIES);
    }

    packetSequenceID++;
  }
}