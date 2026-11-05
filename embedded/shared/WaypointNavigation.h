#pragma once
#include "WaypointProtocol.h"

// Actual motor-independent estimator/controller used by Mega and host tests.
// Limits are safety policies, NOT measured calibration or an accuracy claim.
namespace WaypointNavigation {
inline float clamp(float v,float lo,float hi){return v<lo?lo:v>hi?hi:v;}
inline float wrap(float v){while(v>=360)v-=360;while(v<0)v+=360;return v;}
inline float angle(float v){return wrap(v+180)-180;}
constexpr float RAD=0.01745329252f;
struct Calibration {
  uint32_t revision=0;
  float leftMetersPerRev=0, rightMetersPerRev=0, trackWidth=0;
  float gyroBias=0, gyroScale=0;
  int8_t gyroClockwise=0;
  bool valid() const {
    return revision && isfinite(leftMetersPerRev) && leftMetersPerRev>=0.02f && leftMetersPerRev<=2
      && isfinite(rightMetersPerRev) && rightMetersPerRev>=0.02f && rightMetersPerRev<=2
      && isfinite(trackWidth) && trackWidth>=0.1f && trackWidth<=3
      && isfinite(gyroBias) && fabsf(gyroBias)<=10 && isfinite(gyroScale) && gyroScale>=0.5f && gyroScale<=2
      && (gyroClockwise==1 || gyroClockwise==-1);
  }
};
struct Input {
  uint32_t now=0, gpsSequence=0, gpsAge=0, imuAge=0;
  int32_t lat=0, lon=0;
  uint16_t hdop=9999;
  uint8_t satellites=0;
  float leftRev=0,rightRev=0,gyroDps=0;
  uint32_t badLeft=0,badRight=0;
  bool gpsValid=false,imuValid=false,rcAllowed=false,tiltSafe=true,manual=false;
  uint8_t obstacle=0; // 0 unknown, 1 clear, 2 blocked; no blind detours
};
struct Output {float left=0,right=0;};
// Gate uses the physical CH6 pulse, not currentState (which also changes when
// CH5 arms). Arming with CH6 already SEMI_AUTO must never masquerade as an edge.
class ExecutionGate {
 public:
  void reset(){holdObserved=false;wasSemi=true;}
  bool poll(bool fresh,bool authorized,uint16_t modePulse,bool neutral,bool staged){
    if(!fresh){reset();return false;}
    const bool semi=modePulse>1700;
    if(modePulse>=1300&&modePulse<=1700&&neutral&&staged)holdObserved=true;
    const bool edge=semi&&!wasSemi;wasSemi=semi;
    if(edge){const bool start=staged&&holdObserved&&authorized&&neutral;holdObserved=false;return start;}
    return false;
  }
 private:bool holdObserved=false,wasSemi=true;
};
class Controller {
 public:
  Calibration calibration;
  WaypointProtocol::Plan plan;
  bool staged=false,active=false,poseValid=false,headingValid=false;
  uint8_t pin=0;
  float x=0,y=0,heading=0,uncertainty=100,headingUncertainty=180,remaining=0,travel=0;
  uint16_t corrections=0,segments=0;
  const char* state="IDLE"; const char* reason="NO_MISSION";
  Output output;
  void stage(const WaypointProtocol::Plan& p) {
    plan=p; staged=true; active=false; poseValid=false; pin=0; travel=0; corrections=0; segments=0;
    headingValid=p.hasHeading; heading=p.heading; motion=0; verified=0; lastGpsKnown=false;
    state="STAGED"; reason=calibration.valid()?(headingValid?"WAIT_POSITION":"WAIT_HEADING"):"CALIBRATION_REQUIRED"; stop();
  }
  bool setHeading(float degrees) {
    if(active || !isfinite(degrees) || degrees<0 || degrees>=360) return false;
    heading=degrees; headingValid=true; return true;
  }
  bool gpsFresh(const Input& s) const {
    return s.gpsValid && s.gpsAge<=3000 && s.satellites>=5 && s.hdop>0 && s.hdop<=300
      && s.lat>=-90000000L && s.lat<=90000000L && s.lon>=-180000000L && s.lon<=180000000L;
  }
  const char* readiness(const Input& s) const {
    if(!calibration.valid()) return "CALIBRATION_REQUIRED";
    if(!headingValid) return "WAIT_HEADING";
    if(!s.imuValid || s.imuAge>500 || !isfinite(s.gyroDps)) return "WAIT_IMU";
    if(!gpsFresh(s)) return "WAIT_GPS";
    if(labs(s.lat)>85000000L) return "REGION_UNSUPPORTED";
    for(uint8_t i=0;i<plan.count;++i){
      const float dx=(plan.points[i].lon-s.lon)*0.111195f*cosf(s.lat*0.000001f*RAD);
      const float dy=(plan.points[i].lat-s.lat)*0.111195f;
      if(hypotf(dx,dy)>200) return "WAYPOINT_RANGE_LIMIT";
    }
    if(!s.tiltSafe) return "SAFETY_INTERLOCK";
    if(s.obstacle!=1)return s.obstacle==2?"OBSTACLE_DETECTED":"WAIT_SONAR";
    return "READY_RC_EDGE";
  }
  bool start(const Input& s) {
    stop();
    if(!staged || !s.rcAllowed || s.manual) return false;
    const char* gate=readiness(s);
    if(strcmp(gate,"READY_RC_EDGE")){state="STAGED";reason=gate;return false;}
    originLat=s.lat; originLon=s.lon; x=0;y=0;poseValid=true;headingUncertainty=5;
    uncertainty=gpsUncertainty(s); prevLeft=s.leftRev;prevRight=s.rightRev;
    badBaseL=s.badLeft;badBaseR=s.badRight;lastNow=s.now; started=s.now; waypointStarted=s.now;
    lastGps=s.gpsSequence; lastGpsKnown=true; gpsAt=s.now-s.gpsAge; gpsTravel=0;
    lastGpsX=lastGpsY=0; courseX=courseY=0; courseTravel=0;
    waypointTravel=0; corrections=0;segments=0; active=true;staged=false;motion=0;verified=0;
    state="RUNNING";reason="OPERATOR_STARTED"; return true;
  }
  void cancel(const char* why,const char* reported="HOLD") {
    stop();active=false;staged=false;motion=0;headingValid=false;poseValid=false;state=reported;reason=why;
  }
  Output tick(const Input& s) {
    stop(); if(!active) return output;
    if(!s.rcAllowed){cancel("RC_SIGNAL_LOST","CANCELLED");return output;}
    if(s.manual){cancel("MANUAL_TAKEOVER","CANCELLED");return output;}
    if(!s.tiltSafe){cancel("TILT_SAFETY","FAULT");return output;}
    if(s.obstacle!=1){cancel(s.obstacle==2?"OBSTACLE_DETECTED":"SONAR_UNKNOWN");return output;}
    if(!calibration.valid()){cancel("CALIBRATION_REQUIRED");return output;}
    if(!s.imuValid || s.imuAge>500 || !isfinite(s.gyroDps)){cancel("IMU_UNAVAILABLE");return output;}
    const uint32_t elapsed=s.now-lastNow;
    if(elapsed>1000){cancel("CONTROL_STALE");return output;}
    if(!elapsed) return output;
    const float dt=elapsed*0.001f;
    const float dl=(s.leftRev-prevLeft)*calibration.leftMetersPerRev;
    const float dr=(s.rightRev-prevRight)*calibration.rightMetersPerRev;
    if(!isfinite(dl)||!isfinite(dr)||fabsf(dl)>1.5f||fabsf(dr)>1.5f
      || s.badLeft-badBaseL>12 || s.badRight-badBaseR>12){cancel("ENCODER_NOISE","FAULT");return output;}
    prevLeft=s.leftRev;prevRight=s.rightRev;lastNow=s.now;
    const float encoderTurn=(dl-dr)/calibration.trackWidth/RAD;
    const float gyroTurn=(s.gyroDps-calibration.gyroBias)*calibration.gyroClockwise*calibration.gyroScale*dt;
    const float disagreement=fabsf(encoderTurn-gyroTurn);
    if(disagreement>20){cancel("GYRO_ENCODER_DISAGREE");return output;}
    const float turn=0.7f*gyroTurn+0.3f*encoderTurn, ds=(dl+dr)*0.5f;
    const float mid=wrap(heading+turn*0.5f)*RAD;
    x+=ds*sinf(mid);y+=ds*cosf(mid);heading=wrap(heading+turn);
    const float movement=(fabsf(dl)+fabsf(dr))*0.5f;
    travel+=movement;waypointTravel+=movement;gpsTravel+=movement;courseTravel+=fabsf(ds);
    uncertainty+=fabsf(ds)*0.35f+fabsf(turn)*0.005f+disagreement*0.02f;
    headingUncertainty+=dt*0.05f+disagreement*0.25f;
    const bool newGps=gpsFresh(s) && (!lastGpsKnown || s.gpsSequence!=lastGps);
    if(newGps) {
      const float gx=(s.lon-originLon)*0.111195f*cosf(originLat*0.000001f*RAD);
      const float gy=(s.lat-originLat)*0.111195f;
      const float obs=gpsUncertainty(s), innovation=hypotf(gx-x,gy-y);
      if(innovation>uncertainty+obs+2){cancel("GPS_INNOVATION");return output;}
      const float gain=clamp(uncertainty/(uncertainty+obs),0.15f,0.7f);
      x+=gain*(gx-x);y+=gain*(gy-y);uncertainty=fmaxf(2,uncertainty*(1-gain)+obs*gain);
      // GPS course can refine an ALREADY initialized heading only after a
      // sufficiently long straight observed baseline. Never initialize from it.
      if(motion==2 && courseTravel>obs*2 && hypotf(gx-courseX,gy-courseY)>obs*2) {
        const float observed=wrap(atan2f(gx-courseX,gy-courseY)/RAD);
        const float error=angle(observed-heading);
        if(fabsf(error)>45){cancel("HEADING_INCONSISTENT");return output;}
        heading=wrap(heading+clamp(error,-5,5)*0.3f);headingUncertainty=fminf(headingUncertainty,10);
        courseX=gx;courseY=gy;courseTravel=0;
      }
      lastGpsX=gx;lastGpsY=gy;lastGps=s.gpsSequence;lastGpsKnown=true;gpsAt=s.now-s.gpsAge;gpsTravel=0;
    }
    if(uncertainty>5 || headingUncertainty>20){cancel("POSE_UNCERTAIN");return output;}
    if(!gpsFresh(s) && (s.now-gpsAt>5000 || gpsTravel>1.5f)){cancel("DR_LIMIT");return output;}
    if(s.now-started>1200000UL || s.now-waypointStarted>600000UL || travel>200 || waypointTravel>200
      || corrections>32 || segments>256){cancel("NAVIGATION_LIMIT");return output;}
    if(!strcmp(state,"PIN_CHECKED")) {
      if(s.now-checkedAt<2000) return output;
      if(pin+1>=plan.count){active=false;state="COMPLETE";reason="GPS_ROUTE_VERIFIED";return output;}
      ++pin;waypointTravel=0;waypointStarted=s.now;corrections=0;segments=0;verified=0;motion=0;
    }
    const WaypointProtocol::Point& target=plan.points[pin];
    const float tx=(target.lon-originLon)*0.111195f*cosf(originLat*0.000001f*RAD),ty=(target.lat-originLat)*0.111195f;
    remaining=hypotf(tx-x,ty-y);
    if(newGps) {
      const float gpsDistance=hypotf(tx-lastGpsX,ty-lastGpsY);
      if(gpsDistance+gpsUncertainty(s)<=5 && remaining+uncertainty<=5) ++verified;
      else verified=0;
    }
    if(verified>=2) {motion=0;state="PIN_CHECKED";reason="GPS_WITHIN_5M";checkedAt=s.now;return output;}
    if((gpsFresh(s) && hypotf(tx-lastGpsX,ty-lastGpsY)+gpsUncertainty(s)<=5) || remaining<0.3f) {
      motion=0;state="VERIFYING";reason="WAIT_GPS_CONFIRMATION";return output;
    }
    if(motion) {
      const float left=(s.leftRev-motionLeft)*calibration.leftMetersPerRev;
      const float right=(s.rightRev-motionRight)*calibration.rightMetersPerRev;
      if(s.now-motionAt>15000){cancel("SEGMENT_TIMEOUT","FAULT");return output;}
      if(s.now-motionAt>700 && movement>0.0001f) lastMotion=s.now;
      if(s.now-motionAt>1000 && s.now-lastMotion>900){cancel("ENCODER_STALL","FAULT");return output;}
      if(motion==1) {
        const float error=angle(turnTarget-heading);
        const float progress=(fabsf(left)+fabsf(right))*0.5f;
        if(progress>motionDistance*1.6f+0.05f){cancel("TURN_OVERSHOOT","FAULT");return output;}
        if(fabsf(error)<=3 && progress>=motionDistance*0.25f){finish();return output;}
        output.left=turnSign*0.7f;output.right=-turnSign*0.7f;
      } else {
        if(s.obstacle!=1){cancel(s.obstacle==2?"OBSTACLE_DETECTED":"SONAR_UNKNOWN");return output;}
        if(left< -0.02f || right< -0.02f || fabsf(left-right)>0.25f+motionDistance*0.4f){cancel("ENCODER_DISAGREEMENT","FAULT");return output;}
        if(left>motionDistance+0.3f || right>motionDistance+0.3f){cancel("ENCODER_OVERSHOOT","FAULT");return output;}
        if((left+right)*0.5f>=motionDistance && left>=motionDistance*0.7f && right>=motionDistance*0.7f){finish();return output;}
        const float error=angle(turnTarget-heading);
        if(fabsf(error)>18){cancel("HEADING_ERROR");return output;}
        const float correction=clamp(error*0.012f,-0.18f,0.18f);
        output.left=0.82f+correction;output.right=0.82f-correction;
        state="RUNNING";reason=fabsf(error)>3?"STEERING_CORRECTION":"FORWARD_ENCODER";
      }
      return output;
    }
    const float bearing=wrap(atan2f(tx-x,ty-y)/RAD), error=angle(bearing-heading);
    motionLeft=s.leftRev;motionRight=s.rightRev;motionAt=s.now;lastMotion=s.now;
    ++segments;
    if(fabsf(error)>8) {
      ++corrections;const float requestedTurn=clamp(error,-30,30);turnSign=requestedTurn>0?1:-1;
      turnTarget=wrap(heading+requestedTurn);motionDistance=fabsf(requestedTurn)*RAD*calibration.trackWidth*0.5f;motion=1;
      courseX=lastGpsX;courseY=lastGpsY;courseTravel=0;state="RUNNING";reason="TURN_CORRECTION";
    } else {
      motionDistance=clamp(remaining-1,0.1f,0.5f);turnTarget=bearing;motion=2;
      state="RUNNING";reason="FORWARD_ENCODER";
    }
    return output; // A new target is staged for one cycle before motor output.
  }
  float headingError() const {return fabsf(angle(turnTarget-heading));}
  int32_t estimatedLat() const {return originLat+(int32_t)lroundf(y/0.111195f);}
  int32_t estimatedLon() const {return originLon+(int32_t)lroundf(x/(0.111195f*cosf(originLat*0.000001f*RAD)));}
 private:
  int32_t originLat=0,originLon=0;
  float prevLeft=0,prevRight=0,motionLeft=0,motionRight=0,motionDistance=0,turnTarget=0;
  float gpsTravel=0,waypointTravel=0,lastGpsX=0,lastGpsY=0,courseX=0,courseY=0,courseTravel=0;
  int8_t turnSign=1; uint8_t motion=0,verified=0;
  uint32_t lastNow=0,started=0,waypointStarted=0,gpsAt=0,lastGps=0,motionAt=0,lastMotion=0,checkedAt=0,badBaseL=0,badBaseR=0;
  bool lastGpsKnown=false;
  float gpsUncertainty(const Input& s) const {return 2+s.hdop*0.01f;}
  void stop(){output.left=0;output.right=0;}
  void finish(){motion=0;state="STEP_DONE";reason="ENCODER_ESTIMATE";stop();}
};
}
