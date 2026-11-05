#pragma once
#include <EEPROM.h>
#include "WaypointNavigation.h"
#include "NavigationCalibration.h"

void stopAllOutputs();void stopActuator();void stopDriveMotors();
void setMotorSpeed(uint8_t,uint8_t,int);

// Existing measured encoder CPR, polarity, manual RC, tilt and actuator
// interlocks are used unchanged. No invented distance/turn constants.
WaypointNavigation::Controller a31Navigation;
WaypointNavigation::ExecutionGate a31ExecutionGate;
NavigationCalibration::Session a31Calibration;
bool a30MissionReady=false,a30WasSemiAuto=false,a30StepActive=false;
uint8_t a30CurrentStep=0;
uint32_t a31GpsSeq=0,a31GpsReceived=0,a31GpsAge=0,a31GyroSeq=0,a31GyroReceived=0,a31GyroAge=0;
int32_t a31GpsLat=0,a31GpsLon=0;
uint16_t a31GpsHdop=9999;uint8_t a31GpsSats=0;
bool a31GpsValid=false,a31GyroValid=false;
float a31GyroDps=0;
uint32_t a31LastTelemetry=0,a31TelemetrySeq=0,a31LastPublishedRevision=0;
uint32_t a31BootId=0;
char a31Tx[256];uint16_t a31TxOffset=0,a31TxLength=0;
const char* a31LastState="";const char* a31LastReason="";uint8_t a31LastPin=255;
float a31StageLeft=0,a31StageRight=0,a31StageTurn=0;uint32_t a31StageImuAt=0;

WaypointNavigation::Input a31Input() {
  WaypointNavigation::Input s; const DriveEncoderSnapshot c=readDriveEncoders();s.now=millis();
  s.leftRev=(float)c.left*ENC_LEFT_FORWARD_SIGN/ENC_LEFT_CPR;
  s.rightRev=(float)c.right*ENC_RIGHT_FORWARD_SIGN/ENC_RIGHT_CPR;s.badLeft=c.invalidL;s.badRight=c.invalidR;
  s.gpsValid=a31GpsValid;s.gpsSequence=a31GpsSeq;s.lat=a31GpsLat;s.lon=a31GpsLon;s.hdop=a31GpsHdop;s.satellites=a31GpsSats;
  s.gpsAge=WaypointProtocol::sampleAge(a31GpsAge,s.now-a31GpsReceived);
  s.imuValid=a31GyroValid;s.imuAge=WaypointProtocol::sampleAge(a31GyroAge,s.now-a31GyroReceived);s.gyroDps=a31GyroDps;
  s.rcAllowed=rcOutputAuthorized && !rcRearmRequired;s.manual=currentState==STATE_MANUAL;
  s.tiltSafe=a31BootId && !safetyLatched && !driveSyncFaultLatched && !actuatorOverload && imuFresh();
  s.obstacle=ULTRASONIC_ENABLED?(sonarValid?(currentObstacleDist<=35?2:1):0):0;
  return s;
}
void a31AbortTelemetry() {
  if(a31TelemetryBusy){espSerial.write('\n');a31TelemetryBusy=false;a31TxOffset=a31TxLength=0;}
}
void a31AnchorStaged(){const WaypointNavigation::Input s=a31Input();a31StageLeft=s.leftRev;a31StageRight=s.rightRev;a31StageTurn=0;a31StageImuAt=s.now;a31ExecutionGate.reset();}
void a31CheckStagedMovement(){
  if(!a31Navigation.staged)return;const WaypointNavigation::Input s=a31Input();
  if(fabsf(s.leftRev-a31StageLeft)>0.005f||fabsf(s.rightRev-a31StageRight)>0.005f||fabsf(a31StageTurn)>3)a31Navigation.headingValid=false;
}
bool a30CalibrationReady(){return a31Navigation.calibration.valid();}
void a31PublishState() {
  const uint8_t step=a31Navigation.staged?0:(a31Navigation.plan.count?a31Navigation.pin+1:0);
  a30CurrentStep=step;
  if(strcmp(a31LastState,a31Navigation.state)||strcmp(a31LastReason,a31Navigation.reason)||a31LastPin!=step){
    a29PublishMissionStatus(a29MissionId,a31Navigation.state,step,a31Navigation.reason);
    a31LastState=a31Navigation.state;a31LastReason=a31Navigation.reason;a31LastPin=step;
  }
}
void a30Cancel(const char* state,const char* reason){
  stopAllOutputs();a31Navigation.cancel(reason,state);missionActive=false;a30MissionReady=false;a30StepActive=false;
  currentCommand="";missionSequence="";a31PublishState();
}
void a30RunAutoStep(){
  stopActuator();
  if(!missionActive || !a31Navigation.active){stopDriveMotors();return;}
  const WaypointNavigation::Output out=a31Navigation.tick(a31Input());
  missionActive=a31Navigation.active;a30StepActive=missionActive;
  // Existing hardware-output interlock independently checks RC/tilt/faults.
  const int left=out.left==0?0:(out.left>0?1:-1)*constrain((int)lroundf(fabsf(out.left)*130),90,130);
  const int right=out.right==0?0:(out.right>0?1:-1)*constrain((int)lroundf(fabsf(out.right)*130),90,130);
  setMotorSpeed(PIN_L_RPWM,PIN_L_LPWM,-left);
  setMotorSpeed(PIN_R_RPWM,PIN_R_LPWM,right);a31PublishState();
}
void a30HandleArmAndMode(bool rcFresh,bool neutral,uint16_t physicalModePulse){
  a31CheckStagedMovement();
  const bool requested=a31ExecutionGate.poll(rcFresh,rcOutputAuthorized&&!rcRearmRequired,physicalModePulse,neutral,a30MissionReady);
  const bool semi=currentState==STATE_SEMI_AUTO;
  if(!rcFresh){if(missionActive||a30MissionReady||a31Navigation.active||a31Navigation.staged)a30Cancel("CANCELLED","RC_SIGNAL_LOST");a30WasSemiAuto=false;return;}
  if(a31Navigation.active&&(!missionActive||safetyLatched||driveSyncFaultLatched||actuatorOverload))
    a30Cancel("FAULT",safetyLatched?"TILT_SAFETY":"SAFETY_INTERLOCK");
  if(rcRearmRequired || !semi){
    if(missionActive)a30Cancel("CANCELLED",rcRearmRequired?"RC_NOT_AUTHORIZED":"MANUAL_OR_HOLD_OVERRIDE");
    a30WasSemiAuto=false;return;
  }
  if(requested && a30MissionReady && neutral && rcOutputAuthorized){
    if(a31Navigation.start(a31Input())){missionActive=true;a30MissionReady=false;a30StepActive=true;}
    a31PublishState();
  }
  a30WasSemiAuto=true;
}
void a31LoadCalibration(){
  struct BootRecord {uint32_t value,checksum;};BootRecord a,b;
  EEPROM.get(256,a);EEPROM.get(272,b);
  const bool av=a.value&&a.checksum==MissionProtocol::crc32((const char*)&a.value,4);
  const bool bv=b.value&&b.checksum==MissionProtocol::crc32((const char*)&b.value,4);
  BootRecord next;next.value=(bv&&(!av||b.value>a.value)?b.value:(av?a.value:0))+1;
  next.checksum=MissionProtocol::crc32((const char*)&next.value,4);
  if(next.value){const int address=(next.value&1)?272:256;uint32_t invalid=0;EEPROM.put(address,invalid);
    EEPROM.put(address+4,next.checksum);EEPROM.put(address,next.value);
    BootRecord check;EEPROM.get(address,check);if(check.value==next.value&&check.checksum==next.checksum)a31BootId=next.value;
  }
  NavigationCalibration::Record first,second;EEPROM.get(0,first);EEPROM.get(128,second);
  const bool firstValid=NavigationCalibration::valid(first),secondValid=NavigationCalibration::valid(second);
  if(firstValid||secondValid)a31Navigation.calibration=(secondValid&&(!firstValid||second.value.revision>first.value.revision))?second.value:first.value;
}
bool a31SaveCalibration(){
  if(rcOutputAuthorized || missionActive || !a31Calibration.ready())return false;
  NavigationCalibration::Record record;record.magic=NavigationCalibration::MAGIC;
  record.value=a31Calibration.measured;record.value.revision=a31Navigation.calibration.revision+1;
  if(!record.value.revision)return false;
  record.checksum=NavigationCalibration::checksum(record);
  const int address=(record.value.revision&1)?128:0;
  // Invalidate destination first; retain the previous valid slot across a torn
  // update. Only publish the new calibration after readback and CRC validation.
  uint32_t invalid=0;EEPROM.put(address,invalid);
  const uint8_t* bytes=(const uint8_t*)&record;
  for(size_t i=4;i<sizeof(record);++i)EEPROM.update(address+i,bytes[i]);
  EEPROM.put(address,record.magic);
  NavigationCalibration::Record check;EEPROM.get(address,check);
  if(!NavigationCalibration::valid(check))return false;
  a31Navigation.calibration=check.value;return true;
}
void a31UsbCommand(const char* line){
  if(!strncmp(line,"CAL ",4) || !strncmp(line,"NAV HEADING ",12)){
    if(rcOutputAuthorized || missionActive){Serial.println(F("[NAV SETUP] Select HOLD and DISARM before setup commands."));return;}
    if(!strcmp(line,"CAL ZERO")){
      if(a30MissionReady)a30Cancel("CANCELLED","CALIBRATION_SESSION");
      Serial.println(a31Calibration.begin("ZERO",a31Input())?F("[CAL] Keep loaded rover stationary for >=3 s; then CAL END 0."):F("[CAL] Trial rejected."));
    }else if(!strncmp(line,"CAL BEGIN ",10)){
      if(a30MissionReady)a30Cancel("CANCELLED","CALIBRATION_SESSION");
      Serial.println(a31Calibration.begin(line+10,a31Input())?F("[CAL] Manual RC trial started. Measure loaded movement; HOLD/DISARM then CAL END <meters or degrees>."):F("[CAL] Need stable zero and two straight trials before turns."));
    }else if(!strncmp(line,"CAL END ",8)){
      char* end=nullptr;const float value=strtod(line+8,&end);
      if(!end || *end || end==line+8){Serial.println(F("[CAL] Invalid measured value."));return;}
      a31Calibration.end(value,a31Input());Serial.print(F("[CAL] "));Serial.println(a31Calibration.result);
    }else if(!strcmp(line,"CAL SAVE"))Serial.println(a31SaveCalibration()?F("[CAL] Validated measurements stored with CRC; reboot readback required."):F("[CAL] Save refused; need zero + 2 straight + 2 left + 2 right consistent loaded trials."));
    else if(!strcmp(line,"CAL STATUS")){
      const WaypointNavigation::Calibration& c=a31Navigation.calibration;
      Serial.print(F("[CAL] revision="));Serial.print(c.revision);Serial.print(F(" valid="));Serial.print(c.valid());
      Serial.print(F(" left_m_rev="));Serial.print(c.leftMetersPerRev,6);Serial.print(F(" right_m_rev="));Serial.print(c.rightMetersPerRev,6);
      Serial.print(F(" width_m="));Serial.print(c.trackWidth,6);Serial.print(F(" gyro_bias="));Serial.print(c.gyroBias,6);
      Serial.print(F(" gyro_scale="));Serial.print(c.gyroScale,6);Serial.print(F(" gyro_clockwise="));Serial.println(c.gyroClockwise);
    }else if(!strncmp(line,"NAV HEADING ",12)){
      char* end=nullptr;const float value=strtod(line+12,&end);
      const bool accepted=end && end!=line+12 && !*end && a31Navigation.setHeading(value);
      if(accepted)a31AnchorStaged();
      Serial.println(accepted?F("[NAV] Operator true-north heading set for staged mission."):F("[NAV] Invalid heading or active mission."));
    }else Serial.println(F("[NAV SETUP] Unknown command."));
  }
}
void a31ReadUsb(){
  static char buffer[64];static uint8_t length=0;static bool discard=false;
  uint8_t budget=64;
  while(Serial.available() && budget--){char c=Serial.read();if(c=='\r')continue;
    if(c=='\n'){if(!discard&&length){buffer[length]=0;a31UsbCommand(buffer);}length=0;discard=false;}
    else if(length<sizeof(buffer)-1&&!discard)buffer[length++]=c;else discard=true;
  }
}
bool a31SensorLine(const char* line){
  if(!strncmp(line,"NG1:",4)){
    unsigned long sequence,age;unsigned fix,sats,hdop;long lat,lon;int end=0;
    if(sscanf(line,"NG1:%lu,%u,%ld,%ld,%u,%u,%lu%n",&sequence,&fix,&lat,&lon,&sats,&hdop,&age,&end)==7
      && end==(int)strlen(line)&&fix<=1&&sats<=99&&hdop<=9999&&lat>=-90000000L&&lat<=90000000L&&lon>=-180000000L&&lon<=180000000L){
      if(!fix)a31GpsValid=false;
      if(a31GpsReceived&&!WaypointProtocol::freshSequence(sequence,a31GpsSeq)
        &&(sequence==a31GpsSeq||missionActive||millis()-a31GpsReceived<=2000))return true;
      a31GpsSeq=sequence;a31GpsValid=fix;a31GpsLat=lat;a31GpsLon=lon;a31GpsSats=sats;a31GpsHdop=hdop;a31GpsAge=age;a31GpsReceived=millis();
    }return true;
  }
  if(!strncmp(line,"NI1:",4)){
    // strtod is used: AVR scanf does not parse floating-point fields by default.
    char* end=nullptr;const char* p=line+4;const unsigned long seq=strtoul(p,&end,10);if(end==p||*end!=',')return true;p=end+1;
    const unsigned long valid=strtoul(p,&end,10);if(end==p||*end!=','||valid>1)return true;p=end+1;
    const float rate=strtod(p,&end);if(end==p||*end!=','||!isfinite(rate)||fabsf(rate)>2000)return true;p=end+1;
    const unsigned long age=strtoul(p,&end,10);if(end==p||*end)return true;
    if(a31GyroReceived && (uint32_t)(seq-a31GyroSeq)>=0x80000000UL && (missionActive||millis()-a31GyroReceived<=2000))return true;
    if(a31GyroReceived && seq==a31GyroSeq)return true;
    a31GyroSeq=seq;a31GyroValid=valid;a31GyroDps=rate;a31GyroAge=age;a31GyroReceived=millis();
    if(a31Navigation.staged&&a30CalibrationReady()){
      const uint32_t now=millis(),dt=now-a31StageImuAt;
      if(dt<=500&&valid)a31StageTurn+=(rate-a31Navigation.calibration.gyroBias)*a31Navigation.calibration.gyroScale*a31Navigation.calibration.gyroClockwise*dt*0.001f;
      a31StageImuAt=now;a31CheckStagedMovement();
    }
    a31Calibration.observe(a31Input());return true;
  }return false;
}
void a31ServiceTelemetry(){
  if(a31TelemetryBusy){const int room=espSerial.availableForWrite();if(room<=0)return;
    const uint16_t count=min((uint16_t)16,min((uint16_t)room,(uint16_t)(a31TxLength-a31TxOffset)));
    a31TxOffset+=espSerial.write((const uint8_t*)a31Tx+a31TxOffset,count);
    if(a31TxOffset==a31TxLength)a31TelemetryBusy=false;return;
  }
  if(millis()-a31LastTelemetry<1500)return;a31LastTelemetry=millis();
  const WaypointNavigation::Input s=a31Input();
  if((a31TelemetrySeq+1)%4==0){
    const WaypointNavigation::Calibration& c=a31Navigation.calibration;
    const int n=snprintf(a31Tx,sizeof(a31Tx),"NC1:%lu:%u:%lu:%lu:%lu:%ld:%lu:%d\n",(unsigned long)c.revision,(unsigned)c.valid(),
      (unsigned long)lroundf(c.leftMetersPerRev*1000000),(unsigned long)lroundf(c.rightMetersPerRev*1000000),
      (unsigned long)lroundf(c.trackWidth*1000000),(long)lroundf(c.gyroBias*1000),(unsigned long)lroundf(c.gyroScale*1000),(int)c.gyroClockwise);
    ++a31TelemetrySeq;if(n>0&&n<(int)sizeof(a31Tx)){a31TxLength=n;a31TxOffset=0;a31TelemetryBusy=true;}return;
  }
  const bool controlOwner=missionActive||a30MissionReady;
  unsigned flags=(a30CalibrationReady()?1:0)|(a31Navigation.poseValid&&controlOwner?2:0)|(a31Navigation.headingValid&&controlOwner?4:0)
    |(a31Navigation.gpsFresh(s)?8:0)|(s.imuValid&&s.imuAge<=500?16:0)|(s.rcAllowed?32:0)|(a30MissionReady?64:0)|(missionActive?128:0);
  const char* reason=a30MissionReady?a31Navigation.readiness(s):a31Navigation.reason;
  int32_t plat=a31Navigation.poseValid?a31Navigation.estimatedLat():0,plon=a31Navigation.poseValid?a31Navigation.estimatedLon():0;
  const int n=snprintf(a31Tx,sizeof(a31Tx),"NT1:%lu:0:%lu:%lu:%s:%u:%s:%s:%u:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%u:%lu:%ld\n",
    (unsigned long)WaypointProtocol::FIRMWARE_VERSION,(unsigned long)a31BootId,(unsigned long)++a31TelemetrySeq,a29MissionId,(unsigned)(a31Navigation.plan.count?a31Navigation.pin+1:0),a31Navigation.state,reason,flags,
    (unsigned long)(s.lat+90000000L),(unsigned long)(s.lon+180000000L),(unsigned long)(plat+90000000L),(unsigned long)(plon+180000000L),
    (unsigned long)lroundf(WaypointNavigation::clamp(a31Navigation.uncertainty*100,0,100000)),
    (unsigned long)lroundf(WaypointNavigation::wrap(a31Navigation.heading)*100)%36000UL,
    (unsigned long)lroundf(WaypointNavigation::clamp(a31Navigation.headingUncertainty*100,0,18000)),
    (unsigned long)lroundf(WaypointNavigation::clamp(a31Navigation.remaining*100,0,1000000)),
    (unsigned long)lroundf(WaypointNavigation::clamp(a31Navigation.travel*100,0,1000000)),a31Navigation.corrections,
    (unsigned long)a31Navigation.calibration.revision,(long)lroundf(a31Navigation.calibration.gyroBias*1000));
  if(n>0&&n<(int)sizeof(a31Tx)){a31TxLength=n;a31TxOffset=0;a31TelemetryBusy=true;}
}
