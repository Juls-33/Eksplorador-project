#pragma once
#include "WaypointNavigation.h"

namespace NavigationCalibration {
// Captures observations only. It never requests motor or actuator output.
// Loaded manual RC trials must be measured by an operator, twice per direction.
class Session {
 public:
  WaypointNavigation::Calibration measured;
  uint8_t straight=0,left=0,right=0;
  bool zeroReady=false,recording=false;
  const char* result="NO_CALIBRATION";
  bool begin(const char* kind,const WaypointNavigation::Input& s) {
    if(recording) return false;
    if(!strcmp(kind,"ZERO")){mode=0;zeroReady=false;zeroSum=zeroSquare=0;zeroCount=0;straight=left=right=0;measured=WaypointNavigation::Calibration();}
    else if(!strcmp(kind,"STRAIGHT")) mode=1;
    else if(!strcmp(kind,"LEFT")) mode=2;
    else if(!strcmp(kind,"RIGHT")) mode=3;
    else return false;
    if(mode && !zeroReady){result="ZERO_REQUIRED";return false;}
    if(mode>1 && straight<2){result="STRAIGHT_TRIALS_REQUIRED";return false;}
    first=s;last=s;integral=0;recording=true;result="CAPTURING_MANUAL_TRIAL";return true;
  }
  void observe(const WaypointNavigation::Input& s) {
    if(!recording) return;
    const uint32_t elapsed=s.now-last.now;
    if(!s.imuValid || s.imuAge>500 || !isfinite(s.gyroDps) || elapsed>500
      || s.badLeft-first.badLeft>12 || s.badRight-first.badRight>12){recording=false;result="INVALID_SENSOR_TRIAL";return;}
    if(!elapsed) return;
    if(mode==0) {
      if(fabsf(s.leftRev-first.leftRev)>0.002f || fabsf(s.rightRev-first.rightRev)>0.002f){recording=false;result="ZERO_NOT_STATIONARY";return;}
      zeroSum+=s.gyroDps;zeroSquare+=s.gyroDps*s.gyroDps;++zeroCount;
    } else integral+=(s.gyroDps-measured.gyroBias)*elapsed*0.001f;
    last=s;
  }
  bool end(float observed,const WaypointNavigation::Input& s) {
    if(!recording) return false;
    observe(s); if(!recording) return false;recording=false;
    if(mode==0) {
      if(zeroCount<30 || s.now-first.now<3000){result="ZERO_TOO_SHORT";return false;}
      const float mean=zeroSum/zeroCount, variance=fmaxf(0,zeroSquare/zeroCount-mean*mean);
      if(fabsf(mean)>10 || variance>0.04f){result="ZERO_NOT_STABLE";return false;}
      measured.gyroBias=mean;zeroReady=true;result="ZERO_RECORDED";return true;
    }
    const float l=s.leftRev-first.leftRev,r=s.rightRev-first.rightRev;
    if(!isfinite(observed) || fabsf(l)<0.1f || fabsf(r)<0.1f){result="MEASUREMENT_TOO_SMALL";return false;}
    if(mode==1) {
      if(observed<0.2f || observed>20 || l<=0 || r<=0){result="STRAIGHT_DIRECTION_OR_DISTANCE";return false;}
      const float lm=observed/l,rm=observed/r;
      if(lm<0.02f || lm>2 || rm<0.02f || rm>2 || (straight &&
        (fabsf(lm/measured.leftMetersPerRev-1)>0.15f || fabsf(rm/measured.rightMetersPerRev-1)>0.15f))){result="INCONSISTENT_LOADED_TRIAL";return false;}
      measured.leftMetersPerRev=(measured.leftMetersPerRev*straight+lm)/(straight+1);
      measured.rightMetersPerRev=(measured.rightMetersPerRev*straight+rm)/(straight+1);++straight;
    } else {
      const int clockwise=mode==3?1:-1;
      if(observed<30 || observed>180 || l*clockwise<=0 || r*clockwise>=0 || fabsf(integral)<10){result="TURN_DIRECTION_OR_ANGLE";return false;}
      const float width=(fabsf(l)*measured.leftMetersPerRev+fabsf(r)*measured.rightMetersPerRev)/(observed*WaypointNavigation::RAD);
      const float scale=observed/fabsf(integral);const int sign=integral*clockwise>0?1:-1;
      const uint8_t count=left+right;
      if(width<0.1f || width>3 || scale<0.5f || scale>2 || (count &&
        (sign!=measured.gyroClockwise || fabsf(width/measured.trackWidth-1)>0.15f || fabsf(scale/measured.gyroScale-1)>0.15f))){result="INCONSISTENT_TURN_TRIAL";return false;}
      measured.trackWidth=(measured.trackWidth*count+width)/(count+1);
      measured.gyroScale=(measured.gyroScale*count+scale)/(count+1);measured.gyroClockwise=sign;
      if(mode==2) ++left;else ++right;
    }
    measured.revision=1;result="MEASURED_TRIAL_RECORDED";return true;
  }
  bool ready() const {return !recording && zeroReady && straight>=2 && left>=2 && right>=2 && measured.valid();}
 private:
  WaypointNavigation::Input first,last;
  uint8_t mode=0;uint16_t zeroCount=0;
  float zeroSum=0,zeroSquare=0,integral=0;
};
struct Record {
  uint32_t magic=0, version=1;
  WaypointNavigation::Calibration value;
  uint32_t checksum=0;
};
constexpr uint32_t MAGIC=0x4e43414c;
inline uint32_t checksum(const Record& r){return MissionProtocol::crc32((const char*)&r,offsetof(Record,checksum));}
inline bool valid(const Record& r){return r.magic==MAGIC && r.version==1 && r.value.valid() && r.checksum==checksum(r);}
}
