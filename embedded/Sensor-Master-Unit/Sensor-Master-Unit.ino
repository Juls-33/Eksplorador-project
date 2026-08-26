#include <Arduino.h>

#include <SPI.h>
#include <LoRa.h>

//define the pins used by the transceiver module
#define ss 5
#define rst 14
#define dio0 2

int counter = 0;

// RS485 & Hardware Serial2 Pin Definitions
#define RX2_PIN      16  // Connects to RO on RS485 module
#define TX2_PIN      17  // Connects to DI on RS485 module
#define DE_RE_PIN    4   // Connects to shorted DE & RE pins

// Modbus RTU Query Frame:
// [Slave ID: 0x01] [Function: 0x03] [Start Addr: 0x0000] [Count: 0x0008] [CRC: 0x44 0x0C]
const byte modbusQuery[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x08, 0x44, 0x0C};

// Helper function to calculate Modbus RTU CRC16 Checksum
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

void setup() {
  //initialize Serial Monitor
  Serial.begin(115200);
  while (!Serial);
  Serial.println("LoRa Sender");

  //setup LoRa transceiver module
  LoRa.setPins(ss, rst, dio0);

  //replace the LoRa.begin(---E-) argument with your location's frequency
  //433E6 for Asia
  //868E6 for Europe
  //915E6 for North America
  while (!LoRa.begin(433E6)) {
    Serial.println(".");
    delay(500);
  }
  // Change sync word (0xF3) to match the receiver
  // The sync word assures you don't get LoRa messages from other LoRa transceivers
  // ranges from 0-0xFF
  LoRa.setSyncWord(0xF3);
  Serial.println("LoRa Initializing OK!");

  // Direction Control Pin for RS485 Converter
  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW); // Set to Receive Mode by default

  // Initialize ESP32 Hardware Serial2 for RS485 (9600 baud, 8 data bits, no parity, 1 stop bit)
  Serial2.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);

  Serial.println("========================================");
  Serial.println("  YAGO 8-in-1 Soil Monitor (ESP32)     ");
  Serial.println("========================================");
  delay(1000);
}

void loop() {
  byte response[21]; // Expected response length: 21 bytes

  // Clear incoming buffer
  while (Serial2.available()) {
    Serial2.read();
  }

  // --- STEP 1: TRANSMIT MODBUS COMMAND ---
  digitalWrite(DE_RE_PIN, HIGH); // Switch to Transmit Mode
  delay(2);
  Serial2.write(modbusQuery, sizeof(modbusQuery));
  Serial2.flush();               // Ensure all bytes are sent
  digitalWrite(DE_RE_PIN, LOW);  // Switch back to Receive Mode

  // --- STEP 2: WAIT FOR RESPONSE ---
  unsigned long startTime = millis();
  int bytesRead = 0;

  // Listen for up to 1 second
  while ((millis() - startTime < 1000) && (bytesRead < 21)) {
    if (Serial2.available()) {
      response[bytesRead++] = Serial2.read();
    }
  }

  // --- STEP 3: PARSE, PRINT, AND SEND OVER LoRa ---
  if (bytesRead >= 21) {
    uint16_t receivedCRC = response[bytesRead - 2] | (response[bytesRead - 1] << 8);
    uint16_t calculatedCRC = calculateCRC(response, bytesRead - 2);

    if (receivedCRC == calculatedCRC) {
      // Verified Register Parsing
      int16_t rawTemp     = (response[3]  << 8) | response[4];   // Reg 0
      uint16_t rawMoist   = (response[5]  << 8) | response[6];   // Reg 1
      uint16_t ec         = (response[7]  << 8) | response[8];   // Reg 2
      uint16_t salinity   = (response[9]  << 8) | response[10];  // Reg 3
      uint16_t nitrogen   = (response[11] << 8) | response[12];  // Reg 4
      uint16_t phosphorus = (response[13] << 8) | response[14];  // Reg 5
      uint16_t potassium  = (response[15] << 8) | response[16];  // Reg 6
      uint16_t rawPh      = (response[17] << 8) | response[18];  // Reg 7

      float temperature = rawTemp / 10.0;
      float moisture    = rawMoist / 10.0;
      float ph          = rawPh / 100.0;

      // --- Print to Serial Monitor for local debugging ---
      Serial.println("\n--- Live Soil Readings ---");
      Serial.printf("Temperature:       %.1f C\n", temperature);
      Serial.printf("Moisture:          %.1f %%\n", moisture);
      Serial.printf("Conductivity (EC): %u us/cm\n", ec);
      Serial.printf("Soil pH:           %.2f\n", ph);
      Serial.printf("Salinity / TDS:    %u mg/L\n", salinity);
      Serial.printf("Nitrogen (N):      %u mg/kg\n", nitrogen);
      Serial.printf("Phosphorus (P):    %u mg/kg\n", phosphorus);
      Serial.printf("Potassium (K):     %u mg/kg\n", potassium);

      // --- Build one formatted string, then send it as a single LoRa packet ---
      char payload[160];
      snprintf(payload, sizeof(payload),
               "T:%.1f,M:%.1f,EC:%u,PH:%.2f,SAL:%u,N:%u,P:%u,K:%u",
               temperature, moisture, ec, ph, salinity, nitrogen, phosphorus, potassium);

      LoRa.beginPacket();
      LoRa.print(payload);
      LoRa.endPacket();

      Serial.print("Sent via LoRa: ");
      Serial.println(payload);

    } else {
      Serial.println("[ERROR] CRC Mismatch.");
      LoRa.beginPacket();
      LoRa.print("ERR:CRC_MISMATCH");
      LoRa.endPacket();
    }
  } else {
    Serial.printf("[ERROR] Response timeout. Received %d/21 bytes.\n", bytesRead);
    LoRa.beginPacket();
    LoRa.print("ERR:TIMEOUT");
    LoRa.endPacket();
  }

  delay(3000); // Poll every 2 seconds
}
