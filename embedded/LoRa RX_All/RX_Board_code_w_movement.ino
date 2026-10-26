#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>

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
  Serial.println(F("Test transmission starts shortly."));
  Serial.println(F("Type RX to return to receive mode."));
  Serial.println(F("================================"));
}

void printStatus() {
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
  // Always allow manual mode switching.
  handleSerialCommands();

  
  // Check for incoming LoRa packets in BOTH modes.
  int packetSize = LoRa.parsePacket();

  if (packetSize > 0) {
    String incoming = "";

    while (LoRa.available()) {
      incoming += (char)LoRa.read();
    }

    incoming.trim();

    Serial.println("[RAW RX]: " + incoming);

    if (incoming == "PONG") {
      Serial.println("[TEST] PONG received! LoRa communication confirmed.");
    }
    else if (!txMode) {
      // Process normal sensor telemetry only in RX mode.
      processSensorPacket(incoming);
    }
  }

  // TX mode: don't process normal sensor reception.
  if (txMode) {
    return;
  }


  if (packetSize > 0) {
    String incoming = "";

    while (LoRa.available()) {
      incoming += (char)LoRa.read();
    }

    incoming.trim();

    // FIX: Print the raw incoming string so PoC transmissions aren't hidden by the "DATA:" filter
    Serial.println("[RAW RX]: " + incoming);

    processSensorPacket(incoming);
  }
}