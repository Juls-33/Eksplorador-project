#include <Arduino.h>

void setup()
{
    Serial.begin(115200);
    Serial.println("ESP32 Rover Initialization Started...");
}

void loop()
{
    Serial.println("ESP32 active and running...");
    delay(2000);
}