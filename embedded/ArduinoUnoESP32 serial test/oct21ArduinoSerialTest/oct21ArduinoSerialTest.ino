#include <SoftwareSerial.h>

SoftwareSerial espSerial(2, 3); // RX = 2, TX = 3

bool isRxMode = false;
String rxBuffer = "";

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);

  Serial.println(F("Arduino Uno Initialized."));
  Serial.println(F("Rover is currently in TX Mode (Sending Telemetry)."));
  Serial.println(F("Type 'T' and press enter to toggle to RX (Receive) mode."));
}

void loop() {
  // 1. Toggle from the Serial Monitor
  while (Serial.available() > 0) {
    char input = Serial.read();

    // Debug: show exactly what the Uno received
    Serial.print(F("Got char code: "));
    Serial.println((int)input);

    if (input == 'T' || input == 't') {
      isRxMode = !isRxMode;

      if (isRxMode) {
        Serial.println(F("Toggle: Rover entering RX (Receive/Standby) Mode"));
        espSerial.println(F("SET_MODE:RX"));
      } else {
        Serial.println(F("Toggle: Rover entering TX (Telemetry Execution) Mode"));
        espSerial.println(F("SET_MODE:TX"));
      }
    }
  }

  // 2. Non-blocking read from the ESP32
  while (espSerial.available() > 0) {
    char c = espSerial.read();
    if (c == '\n') {
      rxBuffer.trim();
      if (rxBuffer.length() > 0) {
        Serial.print(F("[ESP32]: "));
        Serial.println(rxBuffer);
      }
      rxBuffer = "";
    } else if (rxBuffer.length() < 100) {
      rxBuffer += c;
    }
  }
}