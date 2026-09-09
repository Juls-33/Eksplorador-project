#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>

#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  2

uint32_t lastProcessedID = 0;

void sendAck(uint32_t id) {
  delay(10); // Small turnaround delay before switching to TX
  LoRa.beginPacket();
  LoRa.print("ACK:" + String(id));
  LoRa.endPacket();
}

// Splits the body of a DATA: packet (after the "DATA:" prefix has been
// stripped) into its 19 comma-separated fields.
// Returns true if all 19 fields were found.
bool splitFields(const String &body, String out[], int expected) {
  int fieldIndex = 0;
  int start = 0;
  for (int i = 0; i < (int)body.length() && fieldIndex < expected; i++) {
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

void setup() {
  Serial.begin(115200);
  while (!Serial);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println(F("[ERROR] LoRa Receiver init failed."));
    while (1);
  }
  LoRa.setSyncWord(0xF3);
  LoRa.enableCrc(); // Hardware CRC check rejects corrupted packets
  Serial.println(F("[OK] LoRa Receiver Running with ARQ & Hardware CRC"));
}

void loop() {
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String incoming = "";
    while (LoRa.available()) {
      incoming += (char)LoRa.read();
    }
    incoming.trim();

    if (incoming.startsWith("DATA:")) {
      int commaIndex = incoming.indexOf(',');
      if (commaIndex != -1) {
        uint32_t packetID = incoming.substring(5, commaIndex).toInt();

        // 1. Send ACK back immediately
        sendAck(packetID);

        // 2. De-duplicate: Process only if it is a new packet ID
        if (packetID != lastProcessedID) {
          lastProcessedID = packetID;

          int rssi = LoRa.packetRssi();
          float snr = LoRa.packetSnr();

          // --- Parse the 19 fields and emit JSON for the Tauri app ---
          String body = incoming.substring(5); // strip "DATA:"
          String fields[19];

          if (splitFields(body, fields, 19)) {
            // Field order matches the sender's snprintf exactly:
            // seqID,satsLocked,satsView,lat,lng,speedKmph,ax,ay,az,gz,soilValid,
            // temperature,moisture,ec,ph,salinity,nitrogen,phosphorus,potassium
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
          } else {
            // Field count didn't match — log it but don't crash or emit bad JSON
            Serial.printf("{\"error\":\"field count mismatch\",\"raw\":\"%s\"}\n", incoming.c_str());
          }

        } else {
          Serial.printf("[RX Duplicate Ignored] ID #%lu re-acknowledged.\n", (unsigned long)packetID);
        }
      }
    }
  }
}
