
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <TinyGPS++.h>
#include <math.h>
#include <stdlib.h>
#include <Preferences.h>
#include "MissionProtocol.h"
#include "WaypointProtocol.h"

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

char inLine[256];
uint8_t inLen = 0;
bool discardLine = false;

Preferences missionPreferences;
MissionProtocol::Record missionRecord{};
bool missionJournalReady = false;
String pendingMegaMission;
size_t pendingMegaOffset = 0;
String deferredImuLine;
String deferredModeAck;
String deferredNavLine;
String deferredGyroLine;
uint32_t a31GyroSendAt=0,a31GyroSequence=0,a31GpsSequence=0;
String a31LastNav,a31LastCalibration;
String a31Events[8];uint8_t a31EventHead=0,a31EventCount=0;uint32_t a31LastQueuedRevision=0;
uint32_t a30LastGpsReport=0;

// A2.9 last-known Mega execution state; repeated while rover radio is TX.
// Not an ACK2 substitute: ACK2 still means UART queued, not accepted.
String a29LastMegaStatus;
unsigned long a29LastStatusRadio = 0;
const uint32_t A29_STATUS_RADIO_MS = 2200;

void serviceMissionStatusRadio() {
  if (!loraReady || !txMode || !a29LastMegaStatus.length()) return;
  const uint32_t now = millis();
  if (!a31EventCount && a29LastStatusRadio && now - a29LastStatusRadio < A29_STATUS_RADIO_MS) return;
  a29LastStatusRadio = now;
  LoRa.idle();
  if (LoRa.beginPacket()) {
    LoRa.print(a31EventCount?a31Events[a31EventHead]:a29LastMegaStatus);
    if (LoRa.endPacket() == 1) {
      if(a31EventCount){a31Events[a31EventHead]="";a31EventHead=(a31EventHead+1)%8;--a31EventCount;}
      Serial.print("[MEGA STATUS LoRa TX] ");
      Serial.println(a29LastMegaStatus);
    }
  }
  LoRa.receive();
}

void sendImuLine(const String& line) {
  if (pendingMegaMission.length()) deferredImuLine = line;
  else Serial2.println(line);
}

void sendModeAck(const char* line) {
  if (pendingMegaMission.length()) deferredModeAck = line;
  else Serial2.println(line);
}

void sendMissionResponse(const char* prefix, const MissionProtocol::Frame& frame, const char* reason = nullptr) {
  char key[26];
  MissionProtocol::key(frame, key, sizeof(key));
  String reply = String(prefix) + key;
  if (reason) reply += String(":") + reason;
  LoRa.idle();
  if (LoRa.beginPacket()) {
    LoRa.print(reply);
    LoRa.endPacket();
  }
  LoRa.receive();
}

bool persistMissionRecord(const MissionProtocol::Record& record) {
  if (missionPreferences.putBytes("latest", &record, sizeof(record)) != sizeof(record)) {
    missionJournalReady = false; // Fail closed if durable duplicate protection is unavailable.
    return false;
  }
  missionRecord = record;
  return true;
}

void initMissionJournal() {
  if (!missionPreferences.begin("mission-v2", false)) return;
  const size_t size = missionPreferences.getBytesLength("latest");
  if (size == 0) { missionJournalReady = true; return; }
  if (size != sizeof(missionRecord)) return;
  if (missionPreferences.getBytes("latest", &missionRecord, sizeof(missionRecord)) != sizeof(missionRecord)) return;
  missionJournalReady = MissionProtocol::valid(missionRecord);
}

// UART handoff is serviced in small chunks so GPS, IMU, RC mode commands and
// safety messages continue to be serviced during an upload. No execution command
// is sent: the Mega receives RCV2:<missionId16>:<original sequence>.
void serviceMissionForward() {
  if (pendingMegaMission.length() == 0) return;
  const size_t room = Serial2.availableForWrite();
  size_t count = pendingMegaMission.length() - pendingMegaOffset;
  if (count > room) count = room;
  if (count > 32) count = 32;
  if (count) pendingMegaOffset += Serial2.write((const uint8_t*)pendingMegaMission.c_str() + pendingMegaOffset, count);
  if (pendingMegaOffset != pendingMegaMission.length()) return;
  MissionProtocol::Record queued = missionRecord;
  queued.stage = MissionProtocol::UART_QUEUED;
  pendingMegaMission = "";
  pendingMegaOffset = 0;
  // Keep each UART line intact. Forward the latest real IMU sample immediately
  // after RCV, before flash/LoRa work; never insert IMU or mode ACKs inside RCV.
  if (deferredImuLine.length()) { Serial2.println(deferredImuLine); deferredImuLine = ""; }
  if (deferredModeAck.length()) { Serial2.println(deferredModeAck); deferredModeAck = ""; }
  if (deferredNavLine.length()) { Serial2.println(deferredNavLine); deferredNavLine = ""; }
  if (deferredGyroLine.length()) { Serial2.println(deferredGyroLine); deferredGyroLine = ""; }
  MissionProtocol::Frame frame;
  frame.id = queued.id;
  frame.checksum = queued.checksum;
  frame.sequence = queued.sequence;
  if (persistMissionRecord(queued)) {
    Serial.println("[MISSION V2] UART queued once; Mega storage is not verified");
    sendMissionResponse("ACK2:", frame);
  } else {
    sendMissionResponse("NACK2:", frame, "PERSISTENCE_FAILED");
  }
}

void receiveMissionV2(const String& packet) {
  MissionProtocol::Frame frame;
  if (!MissionProtocol::parse(packet.c_str(), frame)) {
    Serial.println("[MISSION V2] Invalid frame/checksum; not forwarded");
    LoRa.receive();
    return;
  }
  WaypointProtocol::Plan targets;
  if (!WaypointProtocol::parse(frame.sequence,targets)) { sendMissionResponse("NACK2:",frame,"NAV_FORMAT_REQUIRED");return; }
  if (!missionJournalReady) {
    sendMissionResponse("NACK2:", frame, "JOURNAL_UNAVAILABLE");
    return;
  }
  const auto decision = MissionProtocol::classify(frame, missionRecord);
  if (decision == MissionProtocol::Delivery::DUPLICATE) {
    sendMissionResponse("ACK2:", frame); // ACK loss is harmless; no second UART handoff.
  } else if (decision == MissionProtocol::Delivery::STALE) {
    sendMissionResponse("NACK2:", frame, "STALE_MISSION_ID");
  } else if (decision == MissionProtocol::Delivery::CONFLICT) {
    sendMissionResponse("NACK2:", frame, "ID_PAYLOAD_CONFLICT");
  } else if (decision == MissionProtocol::Delivery::UNCERTAIN) {
    // A retry while our UART job is pending is simply left to the next ACK wait.
    // A reboot in the reserve/handoff window requires explicit operator recovery.
    if (pendingMegaMission.length() == 0) sendMissionResponse("NACK2:", frame, "HANDOFF_OUTCOME_UNKNOWN");
    else LoRa.receive();
  } else if (pendingMegaMission.length() != 0) {
    sendMissionResponse("NACK2:", frame, "PREVIOUS_HANDOFF_PENDING");
  } else if (persistMissionRecord(MissionProtocol::reserve(frame))) {
    // Preserve the Mission V2 identifier for Mega-confirmed statuses.
    // The first 16 bytes of the canonical key are the immutable mission ID.
    char missionKey[26];
    MissionProtocol::key(frame, missionKey, sizeof(missionKey));
    pendingMegaMission = "RCV2:" + String(missionKey).substring(0,16) +
                         ":" + String(frame.sequence) + "\n";
    a29LastMegaStatus = ""; // Prevent old status appearing for a new mission.
    a31EventHead=a31EventCount=0;a31LastQueuedRevision=0;a31LastNav="";
    a29LastStatusRadio = 0;
    pendingMegaOffset = 0;
    LoRa.receive();
  } else {
    sendMissionResponse("NACK2:", frame, "PERSISTENCE_FAILED");
  }
}

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

extern uint32_t lastGoodImuFusion;
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
    lastGoodImuFusion = millis();

    if (!haveAngles) {
      pitchFilt = p;
      rollFilt = r;
      haveAngles = true;
    } else {
      pitchFilt += IMU_ALPHA * (p - pitchFilt);
      rollFilt += IMU_ALPHA * (r - rollFilt);
    }

    sendImuLine(String("IMU:") + String(pitchFilt, 2) + "," + String(rollFilt, 2) + ",1");

  } else {
    haveAngles = false;
    sendImuLine("IMU:0,0,0");

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

// ================= A2.6 ENCODER UART =================
// Mega message: ENC:leftTicks,rightTicks,leftRPM,rightRPM,badL,badR
// Separate from existing SOIL: and mission traffic.
struct EncoderTelemetry {
  int32_t leftTicks = 0;
  int32_t rightTicks = 0;
  float leftRPM = 0;
  float rightRPM = 0;
  uint32_t badL = 0;
  uint32_t badR = 0;
  uint32_t receivedAt = 0;
  bool received = false;
} encoderTelemetry;

const uint32_t ENCODER_FRESH_MS = 2500;
const uint32_t ENCODER_RADIO_MS = 2000;
uint32_t lastEncoderRadio = 0;
uint32_t encoderRadioSeq = 0;

bool parseEncoderLine(const char* line) {
  if (strncmp(line, "ENC:", 4) != 0) return false;
  long left, right;
  float lrpm, rrpm;
  unsigned long invalidL, invalidR;
  int end = 0;
  const int matched = sscanf(line + 4, "%ld,%ld,%f,%f,%lu,%lu%n",
                             &left, &right, &lrpm, &rrpm, &invalidL, &invalidR, &end);
  if (matched != 6 || line[4 + end] != '\0' ||
      !isfinite(lrpm) || !isfinite(rrpm) || fabsf(lrpm) > 10000 || fabsf(rrpm) > 10000)
    return false;
  encoderTelemetry.leftTicks = (int32_t)left;
  encoderTelemetry.rightTicks = (int32_t)right;
  encoderTelemetry.leftRPM = lrpm;
  encoderTelemetry.rightRPM = rrpm;
  encoderTelemetry.badL = (uint32_t)invalidL;
  encoderTelemetry.badR = (uint32_t)invalidR;
  encoderTelemetry.receivedAt = millis();
  encoderTelemetry.received = true;
  return true;
}

// ================= MEGA UART =================

void processMegaLine(const char *s) {
  if (!strcmp(s, "SET_MODE:RX")) {
    txMode = false;
    Serial.println("[MODE] RX");
    sendModeAck("ACK: LoRa set to RX mode.");

    if (loraReady)
      LoRa.receive();

  } else if (!strcmp(s, "SET_MODE:TX")) {
    txMode = true;
    Serial.println("[MODE] TX");
    sendModeAck("ACK: LoRa set to TX mode.");

    if (loraReady)
      LoRa.idle();

  } else if (!strncmp(s, "ENC:", 4)) {
    if (!parseEncoderLine(s)) Serial.println("[ENC] rejected invalid UART frame");

  } else if (!strncmp(s, "SOIL:", 5)) {
    if (!parseSoil(s))
      Serial.println("[SOIL] rejected malformed data");

  } else if (!strncmp(s, "NT1:", 4)) {
    char forwarded[256];if(WaypointProtocol::relayTelemetry(s,forwarded,sizeof(forwarded)))a31LastNav=forwarded;
  } else if (!strncmp(s, "NC1:", 4)) {
    WaypointProtocol::CalibrationInfo cal;if(WaypointProtocol::calibration(s,cal))a31LastCalibration=s;
  } else if (!strncmp(s, "MS:", 3)) {
    WaypointProtocol::MissionStatus status;
    if(!WaypointProtocol::status(s,status)){Serial.println("[MEGA MISSION STATE] invalid frame discarded");return;}
    if(missionRecord.magic==MissionProtocol::JOURNAL_MAGIC){
      MissionProtocol::Frame expected;expected.id=missionRecord.id;expected.checksum=missionRecord.checksum;
      char key[26];MissionProtocol::key(expected,key,sizeof(key));if(strncmp(status.id,key,16))return;
    }
    a29LastMegaStatus=s;
    if(status.revision>a31LastQueuedRevision){
      a31LastQueuedRevision=status.revision;
      if(a31EventCount==8){a31EventHead=(a31EventHead+1)%8;--a31EventCount;}
      a31Events[(a31EventHead+a31EventCount)%8]=s;++a31EventCount;
    }
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

void serviceA30GpsToMega() {
  if(millis()-a30LastGpsReport<1000)return;a30LastGpsReport=millis();
  const bool fix=gps.location.isValid()&&gps.location.age()<=GPS_MAX_AGE;
  const int32_t lat=fix?(int32_t)lround(gps.location.lat()*1000000.0):0;
  const int32_t lon=fix?(int32_t)lround(gps.location.lng()*1000000.0):0;
  const unsigned sats=fix&&gps.satellites.isValid()?gps.satellites.value():0;
  const long rawHdop=gps.hdop.value();
  const unsigned hdop=fix&&gps.hdop.isValid()&&rawHdop>0?(unsigned)(rawHdop>9999?9999:rawHdop):9999;
  String line=String("NG1:")+String(a31GpsSequence)+","+(fix?"1":"0")+","+String(lat)+","+String(lon)+","+String(sats)+","+String(hdop)+","+String(fix?gps.location.age():999999UL);
  if(pendingMegaMission.length())deferredNavLine=line;else Serial2.println(line);
}
void serviceA31GyroToMega(){
  if(millis()-a31GyroSendAt<100)return;a31GyroSendAt=millis();
  const bool valid=imuReady&&haveAngles&&millis()-lastIMU<200&&isfinite(gyroZ);
  const String line=String("NI1:")+String(++a31GyroSequence)+","+(valid?"1":"0")+","+String(valid?gyroZ:0,3)+","+String(millis()-lastIMU);
  if(pendingMegaMission.length())deferredGyroLine=line;else Serial2.println(line);
}
void serviceA31ExtraRadio(){
  static uint32_t next=0;static uint8_t slot=0;
  if((int32_t)(millis()-next)<0)return;next=millis()+600;
  if(a31EventCount){serviceMissionStatusRadio();return;}
  const uint8_t selected=slot++%5;
  if(selected==0){serviceMissionStatusRadio();return;}
  if(selected==1){serviceEncoderRadio();return;}
  if(selected==2){serviceFusionRadio();return;}
  const String& packet=selected==3?a31LastNav:a31LastCalibration;
  if(!packet.length())return;
  LoRa.idle();if(LoRa.beginPacket()){LoRa.print(packet);LoRa.endPacket();}LoRa.receive();
}

void readGPS() {
  uint16_t budget = 256;

  while (gpsUART.available() && budget--) {
    gps.encode((char)gpsUART.read());
  }
  if(gps.location.isUpdated()){++a31GpsSequence;(void)gps.location.lat();(void)gps.location.lng();}
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

// Best-effort extra LoRa frame. It never displaces DATA ACK/retries.
// No ACK/retry for ENC packets in this first diagnostic integration.
void serviceEncoderRadio() {
  const uint32_t now = millis();
  if (!encoderTelemetry.received || now - encoderTelemetry.receivedAt > ENCODER_FRESH_MS) return;
  if (now - lastEncoderRadio < ENCODER_RADIO_MS) return;
  // Give the existing 19-field sensor telemetry its scheduled airtime.
  if (awaitingAck || now - lastTelemetry >= TELEMETRY_MS) return;
  const uint32_t age = now - encoderTelemetry.receivedAt;
  char packet[128];
  const unsigned long nextSeq = (unsigned long)(encoderRadioSeq + 1);
  const int written = snprintf(packet, sizeof(packet),
    "ENC:%lu,%ld,%ld,%.2f,%.2f,%lu,%lu,%lu",
    nextSeq,
    (long)encoderTelemetry.leftTicks, (long)encoderTelemetry.rightTicks,
    encoderTelemetry.leftRPM, encoderTelemetry.rightRPM,
    (unsigned long)encoderTelemetry.badL, (unsigned long)encoderTelemetry.badR,
    (unsigned long)age);
  if (written <= 0 || written >= (int)sizeof(packet)) return;
  LoRa.idle();
  if (LoRa.beginPacket()) {
    LoRa.print(packet);
    if (LoRa.endPacket() == 1) {
      encoderRadioSeq++;
      lastEncoderRadio = now;
      Serial.printf("[ENC LoRa TX] seq=%lu age=%lums L=%.2f R=%.2f\n",
                    nextSeq, (unsigned long)age,
                    encoderTelemetry.leftRPM, encoderTelemetry.rightRPM);
    }
  }
  LoRa.receive();
}

// ================= A2.7 SENSOR FUSION OBSERVER =================
// Diagnostic-only: NEVER writes motor commands, mission controls, or Mega UART.
// GPS fixes are the ONLY source of latitude/longitude in this release.
// GPS course is usable only during meaningful movement. MPU yaw-rate is
// reported but NOT integrated into compass heading until its sign, bias and
// mounting orientation are validated outdoors.
// Encoder rotations DO NOT yield ground displacement on a tracked rover
// until effective track advance and width have been calibrated under load.
const uint32_t FUSION_RADIO_MS = 2000;
const uint32_t FUSION_IMU_FRESH_MS = 350;
const float FUSION_GPS_COURSE_MIN_KMPH = 3.0f;
const bool ENABLE_GYRO_HEADING_PROPAGATION = false; // intentionally gated
uint32_t lastFusionRadio = 0;
uint32_t fusionSeq = 0;
uint32_t lastGoodImuFusion = 0;

static bool fusionGpsFix() {
  return gps.location.isValid() && gps.location.age() <= GPS_MAX_AGE;
}
static bool fusionEncoderFresh() {
  return encoderTelemetry.received &&
    (uint32_t)(millis() - encoderTelemetry.receivedAt) <= ENCODER_FRESH_MS;
}
static bool fusionImuFresh() {
  return haveAngles && lastGoodImuFusion != 0 &&
    (uint32_t)(millis() - lastGoodImuFusion) <= FUSION_IMU_FRESH_MS;
}

// GPS heading/course is not meaningful while stationary. Return invalid
// rather than an arbitrary zero-degree heading or an unverified gyro estimate.
static bool fusionGpsCourse() {
  return fusionGpsFix() && gps.course.isValid() &&
    gps.course.age() <= GPS_MAX_AGE && gps.speed.isValid() &&
    gps.speed.age() <= GPS_MAX_AGE &&
    gps.speed.kmph() >= FUSION_GPS_COURSE_MIN_KMPH;
}

// Best-effort telemetry, never preempts an awaited DATA ACK or a mission.
void serviceFusionRadio() {
  const uint32_t now = millis();
  if (now - lastFusionRadio < FUSION_RADIO_MS) return;
  if (awaitingAck || now - lastTelemetry >= TELEMETRY_MS) return;
  // Existing ENC frames get priority; do not starve A2.6 telemetry.
  if (encoderTelemetry.received &&
      now - encoderTelemetry.receivedAt <= ENCODER_FRESH_MS &&
      now - lastEncoderRadio >= ENCODER_RADIO_MS) return;

  const bool fix = fusionGpsFix();
  const bool course = fusionGpsCourse();
  const bool imu = fusionImuFresh();
  const bool enc = fusionEncoderFresh();
  const double lat = fix ? gps.location.lat() : 0.0;
  const double lng = fix ? gps.location.lng() : 0.0;
  const float heading = course ? gps.course.deg() : 0.0f;
  const float yawRate = imu ? gyroZ : 0.0f;
  const float left = enc ? encoderTelemetry.leftRPM : 0.0f;
  const float right = enc ? encoderTelemetry.rightRPM : 0.0f;
  const unsigned long gpsAge = fix ? gps.location.age() : 0UL;
  const unsigned long imuAge = imu ? (unsigned long)(now - lastGoodImuFusion) : 0UL;
  const unsigned long encAge = enc ? (unsigned long)(now - encoderTelemetry.receivedAt) : 0UL;
  // FUS:seq,gpsFix,lat,lng,headingValid,headingDeg,imuValid,
  //     yawRateDps,encoderValid,leftRPM,rightRPM,gpsAge,imuAge,encAge
  char packet[196];
  const unsigned long nextSeq = (unsigned long)(fusionSeq + 1);
  int n = snprintf(packet, sizeof(packet),
    "FUS:%lu,%u,%.6f,%.6f,%u,%.2f,%u,%.2f,%u,%.2f,%.2f,%lu,%lu,%lu",
    nextSeq, fix ? 1U : 0U, lat, lng, course ? 1U : 0U, heading,
    imu ? 1U : 0U, yawRate, enc ? 1U : 0U, left, right,
    gpsAge, imuAge, encAge);
  if (n <= 0 || n >= (int)sizeof(packet)) return;
  LoRa.idle();
  if (LoRa.beginPacket()) {
    LoRa.print(packet);
    if (LoRa.endPacket() == 1) {
      lastFusionRadio = millis();
      fusionSeq++;
      Serial.printf("[A2.7 FUS TX] seq=%lu gps=%u course=%u imu=%u enc=%u (no odometry)\n",
        nextSeq, fix ? 1U : 0U, course ? 1U : 0U, imu ? 1U : 0U, enc ? 1U : 0U);
    }
  }
  LoRa.receive();
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

  if (data.startsWith("M2:")) {
    receiveMissionV2(data);
    return;
  }

  if (data.startsWith("ACK:") || data.startsWith("ACK2:") || data.startsWith("NACK2:")) {
    LoRa.receive();
    return;
  }

  if (data.length() > 275) {
    Serial.println("[RX ERROR] Payload too long, not forwarded");
    LoRa.receive();
    return;
  }
  if (pendingMegaMission.length()) {
    Serial.println("[RX ERROR] Legacy packet ignored during protected V2 UART handoff");
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
  initMissionJournal();

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
    LoRa.setSpreadingFactor(MissionProtocol::SF);
    LoRa.setSignalBandwidth(MissionProtocol::BANDWIDTH);
    LoRa.setCodingRate4(MissionProtocol::CODING_DENOMINATOR);
    LoRa.setPreambleLength(MissionProtocol::PREAMBLE);
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
  serviceA31GyroToMega();
  serviceA30GpsToMega();
  readMega();
  serviceMissionForward();

  if (loraReady) {
    if (txMode) {
      serviceTx();
      if (!awaitingAck) {
        serviceA31ExtraRadio();
      }
    } else {
      awaitingAck = false;
      serviceRx();
    }
  }

  delay(1);
}
