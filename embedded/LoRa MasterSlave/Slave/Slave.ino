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

          Serial.printf("[RX Valid | RSSI: %d dBm | SNR: %.1f dB] ID #%lu: %s\n",
                        LoRa.packetRssi(),
                        LoRa.packetSnr(),
                        (unsigned long)packetID,
                        incoming.c_str());
        } else {
          Serial.printf("[RX Duplicate Ignored] ID #%lu re-acknowledged.\n", (unsigned long)packetID);
        }
      }
    }
  }
}