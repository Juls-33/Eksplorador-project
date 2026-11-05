#pragma once
#include "WaypointProtocol.h"

void processNavigationPacket(const String& packet){
  WaypointProtocol::Telemetry n;if(!WaypointProtocol::telemetry(packet.c_str(),n)||!n.roverVersion){Serial.println(F("[NAV ERROR] Invalid telemetry"));return;}
  Serial.print(F("{\"type\":\"navigation\",\"protocol\":\"N1\",\"megaVersion\":"));Serial.print(n.megaVersion);
  Serial.print(F(",\"roverVersion\":"));Serial.print(n.roverVersion);
  Serial.print(F(",\"receiverVersion\":"));Serial.print(WaypointProtocol::FIRMWARE_VERSION);
  Serial.print(F(",\"bootId\":"));Serial.print(n.bootId);
  Serial.print(F(",\"navSeq\":"));Serial.print(n.sequence);
  Serial.print(F(",\"missionId\":\""));Serial.print(n.id);Serial.print(F("\",\"targetPin\":"));Serial.print(n.pin);
  Serial.print(F(",\"state\":\""));Serial.print(n.state);Serial.print(F("\",\"reason\":\""));Serial.print(n.reason);Serial.print('"');
  Serial.print(F(",\"calibrated\":"));Serial.print((n.flags&1)?"true":"false");
  Serial.print(F(",\"poseValid\":"));Serial.print((n.flags&2)?"true":"false");
  Serial.print(F(",\"headingValid\":"));Serial.print((n.flags&4)?"true":"false");
  Serial.print(F(",\"gpsValid\":"));Serial.print((n.flags&8)?"true":"false");
  Serial.print(F(",\"imuValid\":"));Serial.print((n.flags&16)?"true":"false");
  Serial.print(F(",\"rcAuthorized\":"));Serial.print((n.flags&32)?"true":"false");
  Serial.print(F(",\"staged\":"));Serial.print((n.flags&64)?"true":"false");
  Serial.print(F(",\"active\":"));Serial.print((n.flags&128)?"true":"false");
  Serial.print(F(",\"ready\":"));Serial.print(n.bootId&&(n.flags&29)==29 && !strcmp(n.reason,"READY_RC_EDGE")?"true":"false");
  Serial.print(F(",\"gpsLat\":"));Serial.print(n.gpsLat/1000000.0-90,6);
  Serial.print(F(",\"gpsLng\":"));Serial.print(n.gpsLon/1000000.0-180,6);
  Serial.print(F(",\"estimatedLat\":"));Serial.print(n.poseLat/1000000.0-90,6);
  Serial.print(F(",\"estimatedLng\":"));Serial.print(n.poseLon/1000000.0-180,6);
  Serial.print(F(",\"positionUncertaintyM\":"));Serial.print(n.uncertaintyCm/100.0,2);
  Serial.print(F(",\"headingDeg\":"));Serial.print(n.headingCdeg/100.0,2);
  Serial.print(F(",\"headingUncertaintyDeg\":"));Serial.print(n.headingErrorCdeg/100.0,2);
  Serial.print(F(",\"distanceRemainingM\":"));Serial.print(n.distanceCm/100.0,2);
  Serial.print(F(",\"encoderTravelM\":"));Serial.print(n.travelCm/100.0,2);
  Serial.print(F(",\"corrections\":"));Serial.print(n.corrections);
  Serial.print(F(",\"calibrationRevision\":"));Serial.print(n.calibration);
  Serial.print(F(",\"gyroBiasDps\":"));Serial.print(n.biasMilli/1000.0,3);
  Serial.println('}');
}
void processNavigationCalibration(const String& packet){
  WaypointProtocol::CalibrationInfo c;if(!WaypointProtocol::calibration(packet.c_str(),c)){Serial.println(F("[NAV ERROR] Invalid calibration"));return;}
  Serial.print(F("{\"type\":\"navigationCalibration\",\"protocol\":\"N1\",\"revision\":"));Serial.print(c.revision);
  Serial.print(F(",\"valid\":"));Serial.print(c.valid?"true":"false");
  Serial.print(F(",\"leftMetersPerRev\":"));Serial.print(c.leftMicro/1000000.0,6);
  Serial.print(F(",\"rightMetersPerRev\":"));Serial.print(c.rightMicro/1000000.0,6);
  Serial.print(F(",\"trackWidthM\":"));Serial.print(c.widthMicro/1000000.0,6);
  Serial.print(F(",\"gyroBiasDps\":"));Serial.print(c.biasMilli/1000.0,3);
  Serial.print(F(",\"gyroScale\":"));Serial.print(c.scaleMilli/1000.0,3);
  Serial.print(F(",\"gyroClockwiseSign\":"));Serial.print(c.clockwise);Serial.println('}');
}
