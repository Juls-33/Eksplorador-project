#include <SoftwareSerial.h>

#define RS485_RX 2
#define RS485_TX 3
#define DE_RE_PIN 4

SoftwareSerial modbusSerial(RS485_RX, RS485_TX);

// Query 8 registers starting at 0x0000
const byte modbusQuery[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x08, 0x44, 0x0C};

uint16_t calculateCRC(const byte *buf, int len)
{
  uint16_t crc = 0xFFFF;
  for (int pos = 0; pos < len; pos++)
  {
    crc ^= (uint16_t)buf[pos];
    for (int i = 8; i != 0; i--)
    {
      if ((crc & 0x0001) != 0)
      {
        crc >>= 1;
        crc ^= 0xA001;
      }
      else
      {
        crc >>= 1;
      }
    }
  }
  return crc;
}

void setup()
{
  Serial.begin(9600);
  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW);
  modbusSerial.begin(9600);

  Serial.println(F("========================================"));
  Serial.println(F("  YAGO 8-in-1 Calibrated Soil Monitor   "));
  Serial.println(F("========================================"));
  delay(1000);
}

void loop()
{
  byte response[21];

  while (modbusSerial.available())
  {
    modbusSerial.read();
  }

  // Send Modbus Request
  digitalWrite(DE_RE_PIN, HIGH);
  delay(2);
  modbusSerial.write(modbusQuery, sizeof(modbusQuery));
  modbusSerial.flush();
  digitalWrite(DE_RE_PIN, LOW);

  // Read Modbus Response
  unsigned long startTime = millis();
  int bytesRead = 0;
  while ((millis() - startTime < 1000) && (bytesRead < 21))
  {
    if (modbusSerial.available())
    {
      response[bytesRead++] = modbusSerial.read();
    }
  }

  if (bytesRead >= 21)
  {
    uint16_t receivedCRC = response[bytesRead - 2] | (response[bytesRead - 1] << 8);
    uint16_t calculatedCRC = calculateCRC(response, bytesRead - 2);

    if (receivedCRC == calculatedCRC)
    {
      // Corrected Register Parsing:
      int16_t rawTemp = (response[3] << 8) | response[4];       // Reg 0
      uint16_t rawMoist = (response[5] << 8) | response[6];     // Reg 1
      uint16_t ec = (response[7] << 8) | response[8];           // Reg 2
      uint16_t salinity = (response[9] << 8) | response[10];    // Reg 3
      uint16_t nitrogen = (response[11] << 8) | response[12];   // Reg 4
      uint16_t phosphorus = (response[13] << 8) | response[14]; // Reg 5
      uint16_t potassium = (response[15] << 8) | response[16];  // Reg 6
      uint16_t rawPh = (response[17] << 8) | response[18];      // Reg 7

      float temperature = rawTemp / 10.0;
      float moisture = rawMoist / 10.0;
      float ph = rawPh / 100.0;

      Serial.println(F("\n--- Live Soil Readings ---"));
      Serial.print(F("Temperature:       "));
      Serial.print(temperature, 1);
      Serial.println(F(" °C"));
      Serial.print(F("Moisture:          "));
      Serial.print(moisture, 1);
      Serial.println(F(" %"));
      Serial.print(F("Conductivity (EC): "));
      Serial.print(ec);
      Serial.println(F(" us/cm"));
      Serial.print(F("Soil pH:           "));
      Serial.println(ph, 2);
      Serial.print(F("Salinity / TDS:    "));
      Serial.print(salinity);
      Serial.println(F(" mg/L"));
      Serial.print(F("Nitrogen (N):      "));
      Serial.print(nitrogen);
      Serial.println(F(" mg/kg"));
      Serial.print(F("Phosphorus (P):    "));
      Serial.print(phosphorus);
      Serial.println(F(" mg/kg"));
      Serial.print(F("Potassium (K):     "));
      Serial.print(potassium);
      Serial.println(F(" mg/kg"));
    }
    else
    {
      Serial.println(F("[ERROR] CRC Mismatch."));
    }
  }
  else
  {
    Serial.println(F("[ERROR] Response timeout."));
  }

  delay(2000);
}

/* PH calibrated daw, haven't tested
#include <SoftwareSerial.h>

#define RS485_RX    2
#define RS485_TX    3
#define DE_RE_PIN   4

SoftwareSerial modbusSerial(RS485_RX, RS485_TX);

// Query 8 registers starting at 0x0000
const byte modbusQuery[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x08, 0x44, 0x0C};

// ======================= CALIBRATION PARAMETERS ======================= // [HIGHLIGHT]
// Note on Register Scaling:
// Standard 8-in-1 Modbus sensors output raw pH scaled by 10 (e.g., 7.37 -> raw 737 / 10.0).
// In your original code, dividing by 100.0 produced 7.37, meaning raw was 737 and scaled by 100.0.
// Adjust the raw divisor below if your raw integer was ~73 or ~737.

// Step 1: Record the sensor's uncalibrated output in standard buffer solutions:
const float PH_REF_LOW      = 4.01;   // Known standard buffer value (Low)
const float PH_MEASURED_LOW = 5.20;   // <-- REPLACE with your uncalibrated reading in 4.01 buffer

const float PH_REF_HIGH     = 6.86;   // Known standard buffer value (High)
const float PH_MEASURED_HIGH= 7.15;   // <-- REPLACE with your uncalibrated reading in 6.86 buffer

// Two-Point Linear Interpolation Function: y = y1 + ((x - x1) * (y2 - y1)) / (x2 - x1)
float calibratePH(float rawReading) {
  float slope = (PH_REF_HIGH - PH_REF_LOW) / (PH_MEASURED_HIGH - PH_MEASURED_LOW);
  float calibrated = PH_REF_LOW + slope * (rawReading - PH_MEASURED_LOW);
  return constrain(calibrated, 0.0, 14.0); // Clamp within realistic pH bounds
}
// ====================================================================== // [HIGHLIGHT]

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
  Serial.begin(9600);
  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW);
  modbusSerial.begin(9600);

  Serial.println(F("========================================"));
  Serial.println(F("   YAGO 8-in-1 Calibrated Soil Monitor   "));
  Serial.println(F("========================================"));
  delay(1000);
}

void loop() {
  byte response[21];

  while (modbusSerial.available()) {
    modbusSerial.read();
  }

  // Send Modbus Request
  digitalWrite(DE_RE_PIN, HIGH);
  delay(2);
  modbusSerial.write(modbusQuery, sizeof(modbusQuery));
  modbusSerial.flush();
  digitalWrite(DE_RE_PIN, LOW);

  // Read Modbus Response
  unsigned long startTime = millis();
  int bytesRead = 0;
  while ((millis() - startTime < 1000) && (bytesRead < 21)) {
    if (modbusSerial.available()) {
      response[bytesRead++] = modbusSerial.read();
    }
  }

  if (bytesRead >= 21) {
    uint16_t receivedCRC = response[bytesRead - 2] | (response[bytesRead - 1] << 8);
    uint16_t calculatedCRC = calculateCRC(response, bytesRead - 2);

    if (receivedCRC == calculatedCRC) {
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

      // ==================== HIGHLIGHT: pH PROCESSING ==================== //
      float uncalibratedPh = rawPh / 100.0; // Raw sensor reading
      float ph = calibratePH(uncalibratedPh); // Calibrated output via slope/offset
      // ================================================================= //

      Serial.println(F("\n--- Live Soil Readings ---"));
      Serial.print(F("Temperature:       ")); Serial.print(temperature, 1); Serial.println(F(" °C"));
      Serial.print(F("Moisture:          ")); Serial.print(moisture, 1);    Serial.println(F(" %"));
      Serial.print(F("Conductivity (EC): ")); Serial.print(ec);             Serial.println(F(" us/cm"));

      // ================= HIGHLIGHT: OUTPUT COMPARISON ================== //
      Serial.print(F("Soil pH (Cal):     ")); Serial.println(ph, 2);
      Serial.print(F("Soil pH (Raw):     ")); Serial.println(uncalibratedPh, 2);
      // ================================================================= //

      Serial.print(F("Salinity / TDS:    ")); Serial.print(salinity);       Serial.println(F(" mg/L"));
      Serial.print(F("Nitrogen (N):      ")); Serial.print(nitrogen);       Serial.println(F(" mg/kg"));
      Serial.print(F("Phosphorus (P):    ")); Serial.print(phosphorus);     Serial.println(F(" mg/kg"));
      Serial.print(F("Potassium (K):     ")); Serial.print(potassium);      Serial.println(F(" mg/kg"));
    } else {
      Serial.println(F("[ERROR] CRC Mismatch."));
    }
  } else {
    Serial.println(F("[ERROR] Response timeout."));
  }

  delay(2000);
}*/

// ESP32
/*
#include <Arduino.h>

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
  // Laptop Serial Monitor
  Serial.begin(115200);

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

  // --- STEP 3: PARSE AND PRINT ---
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

      Serial.println("\n--- Live Soil Readings ---");
      Serial.printf("Temperature:       %.1f °C\n", temperature);
      Serial.printf("Moisture:          %.1f %%\n", moisture);
      Serial.printf("Conductivity (EC): %u us/cm\n", ec);
      Serial.printf("Soil pH:           %.2f\n", ph);
      Serial.printf("Salinity / TDS:    %u mg/L\n", salinity);
      Serial.printf("Nitrogen (N):      %u mg/kg\n", nitrogen);
      Serial.printf("Phosphorus (P):    %u mg/kg\n", phosphorus);
      Serial.printf("Potassium (K):     %u mg/kg\n", potassium);
    } else {
      Serial.println("[ERROR] CRC Mismatch.");
    }
  } else {
    Serial.printf("[ERROR] Response timeout. Received %d/21 bytes.\n", bytesRead);
  }

  delay(2000); // Poll every 2 seconds
}*/