#include <Arduino.h>
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
  Serial.println(F("   YAGO 8-in-1 Calibrated Soil Monitor  "));
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