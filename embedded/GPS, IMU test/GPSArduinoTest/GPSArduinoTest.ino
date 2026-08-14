#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>

// GPS Module Serial Configuration (TX from GPS to Pin 4, RX from GPS to Pin 3)
static const int RXPin = 4, TXPin = 3;
static const uint32_t GPSBaud = 9600;

// LED Pin (Pin 13 is the built-in LED on the Arduino Uno)
const int LED_PIN = 13;

// Objects
TinyGPSPlus gps;
SoftwareSerial ss(RXPin, TXPin);

// Non-blocking timer for blinking when searching
unsigned long previousMillis = 0;
const long blinkInterval = 250; // Blink rate in ms (250ms ON / 250ms OFF)
bool ledState = LOW;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  ss.begin(GPSBaud);

  Serial.println("--- NEO-8M GPS Test Initialized ---");
  Serial.println("LED Status:");
  Serial.println("- BLINKING: Searching for satellite signal...");
  Serial.println("- SOLID ON:  GPS 3D Fix Acquired (Valid Location)!");
  Serial.println("-----------------------------------");
}

void loop() {
  // Feed incoming GPS serial stream to TinyGPS++
  while (ss.available() > 0) {
    gps.encode(ss.read());
  }

  // Check if GPS has a valid fix and updated location data
  if (gps.location.isValid() && gps.location.age() < 2000) {
    // SIGNAL ACQUIRED: Keep LED solid ON
    digitalWrite(LED_PIN, HIGH);

    // Print coordinates to Serial Monitor
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 1000) {
      lastPrint = millis();
      Serial.print("Satellites: ");
      Serial.print(gps.satellites.value());
      Serial.print(" | Lat: ");
      Serial.print(gps.location.lat(), 6);
      Serial.print(" | Lng: ");
      Serial.println(gps.location.lng(), 6);
    }
  } else {
    // SEARCHING FOR SATELLITES: Blink LED
    unsigned long currentMillis = millis();
    if (currentMillis - previousMillis >= blinkInterval) {
      previousMillis = currentMillis;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState);
    }
  }
}