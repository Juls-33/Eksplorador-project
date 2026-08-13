#include <SoftwareSerial.h>

// SoftwareSerial Pins
#define RS485_RX    2  // Connected to RO on converter
#define RS485_TX    3  // Connected to DI on converter
#define DE_RE_PIN   4  // Connected to DE & RE on converter

SoftwareSerial modbusSerial(RS485_RX, RS485_TX);

// Modbus RTU Query Frame:
// [Slave ID: 0x01] [Function: 0x03] [Start Addr: 0x0000] [Count: 0x0008] [CRC: 0x44 0x0C]
const byte modbusQuery[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x08, 0x44, 0x0C};

// Function to calculate Modbus RTU CRC16
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
  // Laptop Serial Monitor
  Serial.begin(9600);
  
  // Direction Control Pin for RS485 Converter
  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW); // Set to Receive Mode by default

  // Start RS485 Serial (YAGO sensor default is 9600 baud)
  modbusSerial.begin(9600);

  Serial.println(F("========================================"));
  Serial.println(F("   YAGO 8-in-1 Modbus Test (Uno)       "));
  Serial.println(F("========================================"));
  delay(1000);
}

void loop() {
  byte response[21]; // Expected response length: 21 bytes

  // Clear software serial buffer
  while (modbusSerial.available()) {
    modbusSerial.read();
  }

  // --- STEP 1: TRANSMIT MODBUS COMMAND ---
  digitalWrite(DE_RE_PIN, HIGH); // Switch converter to Transmit
  delay(2);
  modbusSerial.write(modbusQuery, sizeof(modbusQuery));
  modbusSerial.flush();          // Wait for all bytes to send
  digitalWrite(DE_RE_PIN, LOW);  // Switch converter back to Receive

  // --- STEP 2: WAIT FOR RESPONSE ---
  unsigned long startTime = millis();
  int bytesRead = 0;

  // Read response frame (up to 1 second timeout)
  while ((millis() - startTime < 1000) && (bytesRead < 21)) {
    if (modbusSerial.available()) {
      response[bytesRead++] = modbusSerial.read();
    }
  }

  // --- STEP 3: PARSE RESPONSE ---
  if (bytesRead >= 21) {
    uint16_t receivedCRC = response[bytesRead - 2] | (response[bytesRead - 1] << 8);
    uint16_t calculatedCRC = calculateCRC(response, bytesRead - 2);

    if (receivedCRC == calculatedCRC) {
      // Decode registers (Big-Endian format)
      float moisture      = ((response[3]  << 8) | response[4])  / 10.0;
      float temperature   = ((response[5]  << 8) | response[6])  / 10.0;
      uint16_t ec         = (response[7]   << 8) | response[8];
      float ph            = ((response[9]  << 8) | response[10]) / 10.0;
      uint16_t nitrogen   = (response[11]  << 8) | response[12];
      uint16_t phosphorus = (response[13]  << 8) | response[14];
      uint16_t potassium  = (response[15]  << 8) | response[16];
      uint16_t salinity   = (response[17]  << 8) | response[18];

      Serial.println(F("\n--- SUCCESS: Data Received ---"));
      Serial.print(F("Soil Moisture:     ")); Serial.print(moisture, 1);    Serial.println(F(" %"));
      Serial.print(F("Soil Temperature:  ")); Serial.print(temperature, 1); Serial.println(F(" C"));
      Serial.print(F("Electrical Cond.:  ")); Serial.print(ec);             Serial.println(F(" us/cm"));
      Serial.print(F("Soil pH:           ")); Serial.println(ph, 1);
      Serial.print(F("Nitrogen (N):      ")); Serial.print(nitrogen);       Serial.println(F(" mg/kg"));
      Serial.print(F("Phosphorus (P):    ")); Serial.print(phosphorus);     Serial.println(F(" mg/kg"));
      Serial.print(F("Potassium (K):     ")); Serial.print(potassium);      Serial.println(F(" mg/kg"));
      Serial.print(F("Salinity:          ")); Serial.print(salinity);       Serial.println(F(" mg/L"));
    } else {
      Serial.println(F("[ERROR] Checksum Mismatch (Corrupted data frame)."));
    }
  } else {
    Serial.print(F("[ERROR] Timeout. Received "));
    Serial.print(bytesRead);
    Serial.println(F("/21 bytes. Verify 9V-12V power on Vin."));
  }

  delay(2000); // Read every 2 seconds
}