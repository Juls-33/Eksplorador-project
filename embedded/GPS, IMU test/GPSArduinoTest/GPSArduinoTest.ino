#include <TinyGPSPlus.h>

#define LED_PIN 2
#define RXD2 16  // Connect to NEO-M8N TX
#define TXD2 17  // Connect to NEO-M8N RX
#define GPS_BAUD 9600

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

unsigned long lastSerialTime = 0;
unsigned long lastBlinkTime = 0;
unsigned long lastDebugPrint = 0;
bool ledState = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, RXD2, TXD2);
  Serial.println("Testing NEO-M8N GPS with ESP32...");
}

void loop() {
  // 1. Read incoming stream from GPS
  while (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    gps.encode(c);
    lastSerialTime = millis();
  }

  bool isCommunicating = (millis() - lastSerialTime < 2000);
  bool hasLock = gps.location.isValid() && (gps.satellites.value() > 0);

  // 2. LED Behavior
  if (isCommunicating) {
    if (hasLock) {
      // Blinking = Valid Lock
      if (millis() - lastBlinkTime >= 250) {
        lastBlinkTime = millis();
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState);
      }
    } else {
      // Solid ON = Connected, actively searching indoors
      digitalWrite(LED_PIN, HIGH);
    }
  } else {
    // OFF = No data received from GPS module
    digitalWrite(LED_PIN, LOW);
  }

  // 3. Periodic Diagnostic Log (Prints every 1 second)
  if (millis() - lastDebugPrint >= 1000) {
    lastDebugPrint = millis();

    if (!isCommunicating) {
      Serial.println("[STATUS] Waiting for GPS data... (Check TX/RX wiring and baud rate)");
    } else if (!hasLock) {
      Serial.print("[SEARCHING] Data OK! | Visible Sats: ");
      Serial.print(gps.satellites.value());
      Serial.print(" | Characters processed: ");
      Serial.println(gps.charsProcessed());
    } else {
      Serial.print("[FIX LOCKED] Lat: ");
      Serial.print(gps.location.lat(), 6);
      Serial.print(" | Lon: ");
      Serial.print(gps.location.lng(), 6);
      Serial.print(" | Sats: ");
      Serial.println(gps.satellites.value());
    }
  }
}