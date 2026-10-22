#include <SPI.h>
#include <LoRa.h>

// Serial2 Pins (ESP32 to Mega)
#define RX2_PIN 25
#define TX2_PIN 33

// SX1278 Pins
#define LORA_SS 5
#define LORA_RST 14
#define LORA_DIO0 26

bool isTxMode = true; 
unsigned long lastTelemetryTime = 0;
const long telemetryInterval = 2000; 

float mockLat = 14.609;
float mockLng = 120.982;
uint32_t mockPacketID = 1;

void setup() {
  Serial.begin(115200); 
  Serial2.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  
  // Force a short timeout so dropped characters don't freeze the ESP32
  Serial2.setTimeout(50); 
  
  Serial.println("Initializing ESP32 and SX1278...");

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa Initialization Failed! Check wiring.");
    while (1); 
  }
  
  // Hardware CRC enabled: Corrupt packets are automatically dropped by the SX1278
  LoRa.setSyncWord(0xF3);
  LoRa.enableCrc();

  Serial.println("LoRa Initialized Successfully!");
  Serial.println("Starting in TX Mode: Broadcasting telemetry data...");
}

void loop() {
  // 1. Handle incoming mode commands from Arduino Mega
  if (Serial2.available() > 0) {
    String command = Serial2.readStringUntil('\n');
    command.trim(); 
    
    if (command == "SET_MODE:RX") {
      isTxMode = false;
      Serial.println("\n[MODE] Switched to RECEIVE (RX)");
      Serial2.println("ACK: LoRa set to RX mode.");
      LoRa.receive(); 
    } 
    else if (command == "SET_MODE:TX") {
      isTxMode = true;
      Serial.println("\n[MODE] Switched to TRANSMIT (TX)");
      Serial2.println("ACK: LoRa set to TX mode.");
    }
  }

  // 2. Execute TX Mode (Send Telemetry)
  if (isTxMode) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastTelemetryTime >= telemetryInterval) {
      lastTelemetryTime = currentMillis;
      mockLat += 0.0001; 
      
      String payload = "DATA:" + String(mockPacketID) + ",12,12," + String(mockLat, 6) + "," + String(mockLng, 6) + ",0.0,0.0,0.0,0.0,0.0,1,25.0,50.0,100,7.0,0,0,0,0";
      
      LoRa.beginPacket();
      LoRa.print(payload);
      LoRa.endPacket();
      
      Serial.print("[LoRa TX] Sent: ");
      Serial.println(payload);
      
      mockPacketID++;
    }
  } 
  
  // 3. Execute RX Mode (Listen for Packets & Send ACK)
  else {
    int packetSize = LoRa.parsePacket();
    if (packetSize) {
      Serial.print("\n[LoRa RX] Command Received: '");
      
      String receivedData = "";
      while (LoRa.available()) {
        receivedData += (char)LoRa.read();
      }
      
      Serial.print(receivedData);
      Serial.print("' with RSSI: ");
      Serial.println(LoRa.packetRssi());
      
      // Forward received mission commands to the Mega
      Serial2.println("RCV:" + receivedData); 
      
      // Momentarily switch to TX to fire an ACK back to the Desktop UI
      LoRa.beginPacket();
      LoRa.print("ACK:" + receivedData);
      LoRa.endPacket();
      
      // Immediately switch back to continuous listening mode
      LoRa.receive(); 
      
      Serial.println("[LoRa ACK] Sent confirmation back to Desktop.");
    }
  }
}