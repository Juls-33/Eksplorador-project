#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "../../shared/MissionProtocol.h"

// =====================================================
// RX_BOARD CONFIGURATION
// =====================================================

#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  2

const unsigned long TX_TEST_INTERVAL = 2000;

// Start in normal receive mode
bool txMode = false;

uint32_t lastProcessedID = 0;
uint32_t txTestCounter = 0;

unsigned long lastTxTestTime = 0;

bool missionTxBusy = false;
volatile bool missionTxDone = false;
String missionAttemptKey;
uint32_t missionStartedAt = 0;
uint32_t missionTxBudget = 0;
uint32_t missionAckBudget = 1500;

void onMissionTxDone() { missionTxDone = true; }

void printMissionProtocol() { Serial.println(F("[MISSION PROTOCOL] V2")); }

void serviceMissionTransmission() {
  if (!missionTxBusy) return;
  if (missionTxDone) {
    LoRa.onTxDone(nullptr);
    missionTxDone = false;
    missionTxBusy = false;
    LoRa.receive();
    Serial.printf("[MISSION TX_DONE] %s:%lu\n", missionAttemptKey.c_str(), (unsigned long)missionAckBudget);
  } else if (millis() - missionStartedAt > missionTxBudget) {
    LoRa.onTxDone(nullptr);
    LoRa.idle();
    missionTxBusy = false;
    LoRa.receive();
    Serial.println(F("[ERROR] Mission transmission failed: TX completion timeout."));
  }
}

// =====================================================
// SEND ACK TO SENSOR UNIT
// =====================================================

void sendAck(uint32_t id) {
  delay(10);

  LoRa.beginPacket();
  LoRa.print("ACK:");
  LoRa.print(id);
  LoRa.endPacket();

  LoRa.receive(); // FIX: Return to listening mode after transmitting
}

// =====================================================
// PARSE COMMA-SEPARATED FIELDS
// =====================================================

bool splitFields(const String &body, String out[], int expected) {
  int fieldIndex = 0;
  int start = 0;

  for (int i = 0;
       i < (int)body.length() && fieldIndex < expected;
       i++) {

    if (body.charAt(i) == ',') {
      out[fieldIndex++] = body.substring(start, i);
      start = i + 1;
    }
  }

  if (fieldIndex < expected) {
    out[fieldIndex++] = body.substring(start);
  }

  return fieldIndex == expected;
}

// =====================================================
// MODE SWITCHING
// =====================================================

void switchToRX() {
  if (missionTxBusy) {
    LoRa.onTxDone(nullptr);
    LoRa.idle(); // Cancel a local in-flight packet; an already received packet cannot be recalled.
    missionTxBusy = false;
    missionTxDone = false;
  }
  if (!txMode) {
    Serial.println(F("[MODE] Already in RX mode."));
    return;
  }

  txMode = false;
  lastProcessedID = 0;

  LoRa.receive();

  Serial.println();
  Serial.println(F("================================"));
  Serial.println(F("[MODE] RX MODE"));
  Serial.println(F("Receiving Sensor Unit LoRa data."));
  Serial.println(F("ACK and telemetry processing enabled."));
  Serial.println(F("================================"));
}

void switchToTX() {
  printMissionProtocol();
  if (txMode) {
    Serial.println(F("[MODE] Already in TX mode."));
    return;
  }

  txMode = true;
  lastTxTestTime = millis();

  Serial.println();
  Serial.println(F("================================"));
  Serial.println(F("[MODE] TX MODE"));
  Serial.println(F("Sensor packet processing paused."));
  Serial.println(F("Mission upload mode; no automatic test transmissions."));
  Serial.println(F("Type RX to return to receive mode."));
  Serial.println(F("================================"));
}

void printStatus() {
  printMissionProtocol();
  Serial.println();
  Serial.print(F("[STATUS] Current mode: "));
  Serial.println(txMode ? F("TX") : F("RX"));
}

// =====================================================
// SERIAL MONITOR COMMANDS
// =====================================================

void transmitMission(const String &sequence);

void handleSerialCommands() {
  if (!Serial.available()) {
    return;
  }

  String command = Serial.readStringUntil('\n');
  command.trim();
  command.toUpperCase();

  if (command == "TX") {
    switchToTX();
  }
  else if (command == "RX") {
    switchToRX();
  }
  else if (command == "STATUS") {
    printStatus();
  }
  else if (command == "PING") {
  transmitMission("PING");
}
  else if (command.startsWith("MISSION:")) {
    String sequence = command.substring(8);
    sequence.trim();

    if (sequence.length() == 0) {
      Serial.println(F("[ERROR] Empty mission sequence."));
    }
    else {
      Serial.print(F("[MISSION RECEIVED] "));
      Serial.println(sequence);

      transmitMission(sequence);
    }
  }
  else if (command.length() > 0) {
    Serial.print(F("[ERROR] Unknown command: "));
    Serial.println(command);
    Serial.println(
      F("Commands: RX, TX, STATUS, MISSION:<sequence>")
    );
  }
}


void transmitMission(const String &sequence) {
  if (missionTxBusy) {
    Serial.println(F("[ERROR] Mission transmission failed: radio still busy."));
    return;
  }
  // Mission commands can only be sent while TX mode is active.
  if (!txMode) {
    Serial.println(
      F("[ERROR] Switch RX_Board to TX mode before sending a mission.")
    );
    return;
  }

  if (sequence.length() == 0) {
    Serial.println(F("[ERROR] Empty mission sequence."));
    return;
  }

  if (sequence.startsWith("M2:")) {
    const int separator = sequence.lastIndexOf('|');
    if (separator < 0) {
      Serial.println(F("[ERROR] Mission transmission failed: missing attempt number."));
      return;
    }
    String packet = sequence.substring(0, separator);
    String attempt = sequence.substring(separator + 1);
    for (unsigned i = 0; i < attempt.length(); ++i) {
      if (!isDigit(attempt[i])) {
        Serial.println(F("[ERROR] Mission transmission failed: invalid attempt number."));
        return;
      }
    }
    MissionProtocol::Frame frame;
    if (attempt.length() == 0 || attempt.toInt() < 1 || !MissionProtocol::parse(packet.c_str(), frame)) {
      Serial.println(F("[ERROR] Mission transmission failed: invalid V2 frame or checksum."));
      return;
    }
    char key[26];
    MissionProtocol::key(frame, key, sizeof(key));
    missionAttemptKey = String(key) + ":" + attempt;
    missionAckBudget = MissionProtocol::ackTimeoutMs(strlen(frame.sequence));
    missionTxBudget = MissionProtocol::airtimeMs(packet.length()) + 1000;
    LoRa.idle();
    if (!LoRa.beginPacket() || LoRa.write((const uint8_t*)packet.c_str(), packet.length()) != packet.length()) {
      Serial.println(F("[ERROR] Could not start mission packet."));
      LoRa.receive();
      return;
    }
    missionTxDone = false;
    missionTxBusy = true;
    missionStartedAt = millis();
    Serial.println("[MISSION SUBMITTED] " + missionAttemptKey);
    LoRa.onTxDone(onMissionTxDone);
    if (LoRa.endPacket(true) != 1) {
      LoRa.onTxDone(nullptr);
      missionTxBusy = false;
      Serial.println(F("[ERROR] Mission transmission failed."));
      LoRa.receive();
    }
    return;
  }

  Serial.print(F("[LoRa TX] Sending mission: "));
  Serial.println(sequence);

  if (LoRa.beginPacket()) {
    LoRa.print(sequence);

    if (LoRa.endPacket() == 1) {
      Serial.println(F("[LoRa TX] Mission packet transmitted."));
    } else {
      Serial.println(F("[LoRa TX] Mission transmission failed."));
    }

    LoRa.receive();
  } else {
    Serial.println(F("[LoRa TX] Could not start mission packet."));
    LoRa.receive();
  }
}



// =====================================================
// TRANSMIT TEST PACKET
// =====================================================

void transmitTestPacket() {
  unsigned long now = millis();

  if (now - lastTxTestTime < TX_TEST_INTERVAL) {
    return;
  }

  lastTxTestTime = now;
  txTestCounter++;

  String payload = "RXBOARD_TEST:" + String(txTestCounter);

  Serial.print(F("[LoRa TX] Sending: "));
  Serial.println(payload);

  if (LoRa.beginPacket()) {
    LoRa.print(payload);

    if (LoRa.endPacket() == 1) {
      Serial.println(F("[LoRa TX] Packet transmitted."));
    }
    else {
      Serial.println(F("[LoRa TX] Transmission failed."));
    }
    
    LoRa.receive(); // FIX: Return to listening mode after transmitting
  }
  else {
    Serial.println(F("[LoRa TX] Could not start packet."));
    LoRa.receive(); // FIX: Fallback to RX if packet fails to start
  }
}

// =====================================================
// PROCESS SENSOR UNIT DATA
// =====================================================

void processSensorPacket(const String &incoming) {
  if (!incoming.startsWith("DATA:")) {
    return;
  }

  int commaIndex = incoming.indexOf(',');

  if (commaIndex == -1) {
    Serial.println(F("[ERROR] Invalid DATA packet."));
    return;
  }

  uint32_t packetID =
      incoming.substring(5, commaIndex).toInt();

  // ACK the packet, including duplicates
  sendAck(packetID);

  // Ignore previously processed packet IDs
  if (packetID == lastProcessedID) {
    Serial.printf(
      "[RX Duplicate Ignored] ID #%lu re-acknowledged.\n",
      (unsigned long)packetID
    );
    return;
  }

  lastProcessedID = packetID;

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  String body = incoming.substring(5);
  String fields[19];

  if (!splitFields(body, fields, 19)) {
    Serial.println(
      F("{\"error\":\"field count mismatch\"}")
    );
    return;
  }

  // Field order matches the Sensor Unit payload.
  int satsLocked     = fields[1].toInt();
  int satsView       = fields[2].toInt();
  double lat         = fields[3].toDouble();
  double lng         = fields[4].toDouble();
  float speedKmph    = fields[5].toFloat();
  float ax           = fields[6].toFloat();
  float ay           = fields[7].toFloat();
  float az           = fields[8].toFloat();
  float gz           = fields[9].toFloat();
  int soilValid      = fields[10].toInt();
  float temperature  = fields[11].toFloat();
  float moisture     = fields[12].toFloat();
  int ec             = fields[13].toInt();
  float ph           = fields[14].toFloat();
  int salinity       = fields[15].toInt();
  int nitrogen       = fields[16].toInt();
  int phosphorus     = fields[17].toInt();
  int potassium      = fields[18].toInt();

  // Preserve JSON telemetry output for Eksplorador.
  Serial.print("{");
  Serial.print("\"seq\":");          Serial.print(packetID);
  Serial.print(",\"satsLocked\":");  Serial.print(satsLocked);
  Serial.print(",\"satsView\":");    Serial.print(satsView);
  Serial.print(",\"lat\":");         Serial.print(lat, 6);
  Serial.print(",\"lng\":");         Serial.print(lng, 6);
  Serial.print(",\"speedKmph\":");   Serial.print(speedKmph, 1);
  Serial.print(",\"ax\":");          Serial.print(ax, 2);
  Serial.print(",\"ay\":");          Serial.print(ay, 2);
  Serial.print(",\"az\":");          Serial.print(az, 2);
  Serial.print(",\"gz\":");          Serial.print(gz, 1);
  Serial.print(",\"soilValid\":");   Serial.print(soilValid);
  Serial.print(",\"temperature\":"); Serial.print(temperature, 1);
  Serial.print(",\"moisture\":");    Serial.print(moisture, 1);
  Serial.print(",\"ec\":");          Serial.print(ec);
  Serial.print(",\"ph\":");          Serial.print(ph, 2);
  Serial.print(",\"salinity\":");    Serial.print(salinity);
  Serial.print(",\"nitrogen\":");    Serial.print(nitrogen);
  Serial.print(",\"phosphorus\":");  Serial.print(phosphorus);
  Serial.print(",\"potassium\":");   Serial.print(potassium);
  Serial.print(",\"rssi\":");        Serial.print(rssi);
  Serial.print(",\"snr\":");         Serial.print(snr, 1);
  Serial.println("}");
}

// =====================================================
// A2.6 additive wireless encoder message (separate from DATA JSON)
// ENC:seq,leftTicks,rightTicks,leftRPM,rightRPM,badL,badR,ageMs
// =====================================================
void processEncoderPacket(const String& incoming) {
  unsigned long seq, badL, badR, ageMs;
  long leftTicks, rightTicks;
  float leftRPM, rightRPM;
  int end = 0;
  const int n = sscanf(incoming.c_str(),
    "ENC:%lu,%ld,%ld,%f,%f,%lu,%lu,%lu%n",
    &seq, &leftTicks, &rightTicks, &leftRPM, &rightRPM,
    &badL, &badR, &ageMs, &end);
  if (n != 8 || end != incoming.length() ||
      !isfinite(leftRPM) || !isfinite(rightRPM) ||
      fabsf(leftRPM) > 10000 || fabsf(rightRPM) > 10000) {
    Serial.println(F("[ENC RX ERROR] Malformed packet"));
    return;
  }
  Serial.print(F("{\"type\":\"encoder\",\"encoderSeq\":")); Serial.print(seq);
  Serial.print(F(",\"leftTicks\":")); Serial.print(leftTicks);
  Serial.print(F(",\"rightTicks\":")); Serial.print(rightTicks);
  Serial.print(F(",\"leftRPM\":")); Serial.print(leftRPM, 2);
  Serial.print(F(",\"rightRPM\":")); Serial.print(rightRPM, 2);
  Serial.print(F(",\"invalidL\":")); Serial.print(badL);
  Serial.print(F(",\"invalidR\":")); Serial.print(badR);
  Serial.print(F(",\"ageAtTransmitMs\":")); Serial.print(ageMs);
  Serial.println(F("}"));
}

// =====================================================
// A2.7 diagnostic-only fusion observer output.
// GPS fix and heading validity MUST be checked before using coordinates.
// No GPS/IMU/encoder dead reckoning is enabled in this firmware.
// =====================================================
void processFusionPacket(const String& incoming) {
  unsigned long seq, gpsAge, imuAge, encAge;
  unsigned int gpsValid, headingValid, imuValid, encoderValid;
  double lat, lng;
  float heading, yaw, left, right;
  int end = 0;
  const int n = sscanf(incoming.c_str(),
    "FUS:%lu,%u,%lf,%lf,%u,%f,%u,%f,%u,%f,%f,%lu,%lu,%lu%n",
    &seq, &gpsValid, &lat, &lng, &headingValid, &heading,
    &imuValid, &yaw, &encoderValid, &left, &right,
    &gpsAge, &imuAge, &encAge, &end);
  if (n != 14 || end != incoming.length() ||
      gpsValid > 1 || headingValid > 1 || imuValid > 1 || encoderValid > 1 ||
      !isfinite(lat) || !isfinite(lng) || !isfinite(heading) ||
      !isfinite(yaw) || !isfinite(left) || !isfinite(right) ||
      fabs(lat) > 90.0 || fabs(lng) > 180.0 ||
      heading < 0 || heading >= 360.01 ||
      fabs(yaw) > 2000 || fabs(left) > 10000 || fabs(right) > 10000 ||
      (headingValid && !gpsValid)) {
    Serial.println(F("[FUS RX ERROR] Malformed packet"));
    return;
  }
  Serial.print(F("{\"type\":\"fusion\",\"fusionSeq\":")); Serial.print(seq);
  Serial.print(F(",\"gpsValid\":")); Serial.print(gpsValid);
  Serial.print(F(",\"lat\":")); Serial.print(gpsValid ? lat : 0.0, 6);
  Serial.print(F(",\"lng\":")); Serial.print(gpsValid ? lng : 0.0, 6);
  Serial.print(F(",\"headingValid\":")); Serial.print(headingValid);
  Serial.print(F(",\"headingDeg\":")); Serial.print(headingValid ? heading : 0.0f, 2);
  Serial.print(F(",\"headingSource\":\"")); Serial.print(headingValid ? F("GPS_COURSE") : F("NONE")); Serial.print('"');
  Serial.print(F(",\"imuValid\":")); Serial.print(imuValid);
  Serial.print(F(",\"gyroZDps\":")); Serial.print(yaw, 2);
  Serial.print(F(",\"encoderValid\":")); Serial.print(encoderValid);
  Serial.print(F(",\"leftRPM\":")); Serial.print(left, 2);
  Serial.print(F(",\"rightRPM\":")); Serial.print(right, 2);
  Serial.print(F(",\"gpsAgeMs\":")); Serial.print(gpsAge);
  Serial.print(F(",\"imuAgeMs\":")); Serial.print(imuAge);
  Serial.print(F(",\"encoderAgeMs\":")); Serial.print(encAge);
  Serial.println(F(",\"positionSource\":\"GPS_ONLY\",\"navigationEnabled\":false}"));
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(50);

  delay(500);

  Serial.println();
  Serial.println(F("================================"));
  Serial.println(F("  EKSPLORADOR RX_BOARD"));
  Serial.println(F("================================"));

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(433E6)) {
    Serial.println(
      F("[ERROR] LoRa initialization failed!")
    );

    while (true) {
      delay(1000);
    }
  }

  LoRa.setSyncWord(0xF3);
  LoRa.enableCrc();
  // Explicitly retain the existing SX127x default profile on both endpoints.
  LoRa.setSpreadingFactor(MissionProtocol::SF);
  LoRa.setSignalBandwidth(MissionProtocol::BANDWIDTH);
  LoRa.setCodingRate4(MissionProtocol::CODING_DENOMINATOR);
  LoRa.setPreambleLength(MissionProtocol::PREAMBLE);

  LoRa.receive();

  Serial.println(F("[OK] LoRa initialized at 433 MHz."));
  Serial.println(F("[OK] Hardware CRC enabled."));
  Serial.println(F("[OK] Starting in RX mode."));
  Serial.println();
  Serial.println(F("Available commands:"));
  Serial.println(F("  RX     - Receive Sensor Unit data"));
  Serial.println(F("  TX     - Transmit LoRa test packets"));
  Serial.println(F("  STATUS - Show current mode"));
  Serial.println();
  Serial.println(F("Enter a command below."));
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  serviceMissionTransmission();
  handleSerialCommands();
  if (missionTxBusy) return; // Preserve async Mission V2 TX.

  // Receive exactly once: old second parsePacket() consumed an empty FIFO.
  const int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) return;
  String incoming;
  incoming.reserve(packetSize + 1);
  while (LoRa.available()) incoming += (char)LoRa.read();
  incoming.trim();
  Serial.println("[RAW RX]: " + incoming);

  if (incoming == "PONG") {
    Serial.println(F("[TEST] PONG received"));
  } else if (!txMode && incoming.startsWith("DATA:")) {
    processSensorPacket(incoming); // Existing 19-field JSON unchanged.
  } else if (!txMode && incoming.startsWith("ENC:")) {
    processEncoderPacket(incoming); // New additive encoder JSON.
  } else if (!txMode && incoming.startsWith("FUS:")) {
    processFusionPacket(incoming); // A2.7 status-only fusion observation.
  }
}
