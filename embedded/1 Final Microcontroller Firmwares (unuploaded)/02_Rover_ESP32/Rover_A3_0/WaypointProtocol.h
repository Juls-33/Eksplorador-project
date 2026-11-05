#pragma once
#include "MissionProtocol.h"
#include <stdlib.h>
#include <math.h>

// N1 explicitly selects feedback navigation. W is a TARGET in this format,
// never an immediate checkpoint or a request to replay timed motor commands.
namespace WaypointProtocol {
constexpr uint8_t MAX_WAYPOINTS = 10; // 226-byte V2 payload is still authoritative.
constexpr uint32_t FIRMWARE_VERSION = 30100; // 3.1.0, compiled into each board
inline uint32_t sampleAge(uint32_t reported,uint32_t elapsed){return reported>UINT32_MAX-elapsed?UINT32_MAX:reported+elapsed;}
inline bool freshSequence(uint32_t next,uint32_t previous){const uint32_t delta=next-previous;return delta&&delta<0x80000000UL;}
struct Point { int32_t lat, lon; }; // signed microdegrees, no AVR absolute-float loss
struct Plan {
  Point points[MAX_WAYPOINTS];
  uint8_t count = 0;
  bool hasHeading = false;
  float heading = 0;
};
inline bool digits(const char* s, size_t n) {
  if (!n || n > 9) return false;
  for (size_t i=0; i<n; ++i) if (s[i]<'0' || s[i]>'9') return false;
  return true;
}
inline bool waypoint(const char* s, size_t n, Point& p) {
  if (n<4 || n>20 || s[0]!='W') return false;
  const char* dot=(const char*)memchr(s+1,'.',n-1);
  if (!dot || !digits(s+1,dot-s-1) || !digits(dot+1,s+n-dot-1)) return false;
  const unsigned long lat=strtoul(s+1,nullptr,10), lon=strtoul(dot+1,nullptr,10);
  if (lat>180000000UL || lon>360000000UL) return false;
  p.lat=(int32_t)lat-90000000L; p.lon=(int32_t)lon-180000000L;
  return true;
}
inline bool parse(const char* sequence, Plan& out) {
  if (!sequence || strlen(sequence)>MissionProtocol::MAX_SEQUENCE || strncmp(sequence,"N1,",3)) return false;
  Plan plan;
  const char* cursor=sequence+3;
  if (*cursor=='H') {
    const char* comma=strchr(cursor,',');
    if (!comma || comma-cursor<2 || comma-cursor>8) return false;
    bool dot=false;
    for (const char* p=cursor+1;p<comma;++p) {
      if (*p=='.' && !dot) dot=true;
      else if (*p<'0' || *p>'9') return false;
    }
    char* end=nullptr; const double heading=strtod(cursor+1,&end);
    if (end!=comma || !isfinite(heading) || heading<0 || heading>=360) return false;
    plan.hasHeading=true; plan.heading=(float)heading; cursor=comma+1;
  }
  while (*cursor) {
    const char* comma=strchr(cursor,',');
    const size_t length=comma?(size_t)(comma-cursor):strlen(cursor);
    if (plan.count>=MAX_WAYPOINTS || !waypoint(cursor,length,plan.points[plan.count])) return false;
    ++plan.count;
    if (!comma) break;
    cursor=comma+1; if (!*cursor) return false;
  }
  if (!plan.count) return false;
  out=plan; return true;
}

// One shared relay parser prevents Mega->rover->receiver grammar drift.
struct MissionStatus {
  char id[17]={}, state[22]={}, reason[34]={};
  uint32_t revision=0; uint8_t step=0;
};
inline bool status(const char* text, MissionStatus& out) {
  if (!text || strlen(text)>=110) return false;
  unsigned long revision=0; unsigned step=0; int end=0;
  MissionStatus s;
  const int count=sscanf(text,"MS:%16[0-9A-F]:%lu:%21[A-Z_]:%u:%33[A-Z0-9_]%n",
    s.id,&revision,s.state,&step,s.reason,&end);
  uint64_t id=0;
  if (count!=5 || end!=(int)strlen(text) || strlen(s.id)!=16 || !revision || step>40
      || !MissionProtocol::hex(s.id,16,id) || !id) return false;
  s.revision=(uint32_t)revision; s.step=(uint8_t)step; out=s; return true;
}
inline bool statusJson(const MissionStatus& s,int rssi,float snr,char* out,size_t size){
  if(rssi< -200||rssi>0||!isfinite(snr)||snr< -30||snr>30)return false;
  const int n=snprintf(out,size,"{\"type\":\"missionStatus\",\"missionId\":\"%s\",\"statusSeq\":%lu,\"state\":\"%s\",\"step\":%u,\"reason\":\"%s\",\"rssi\":%d,\"snr\":%.1f}",
    s.id,(unsigned long)s.revision,s.state,(unsigned)s.step,s.reason,rssi,(double)snr);
  return n>0&&(size_t)n<size;
}

// Fixed integer, bounded telemetry: no sprintf floats on AVR and no JSON in the
// motor loop. Firmware versions are reported by each board, not UI checkboxes.
struct Telemetry {
  unsigned long megaVersion=0,roverVersion=0,bootId=0;
  unsigned long sequence=0, flags=0, gpsLat=0, gpsLon=0, poseLat=0, poseLon=0;
  unsigned long uncertaintyCm=0, headingCdeg=0, headingErrorCdeg=0, distanceCm=0, travelCm=0, corrections=0, calibration=0;
  long biasMilli=0;
  unsigned pin=0;
  char id[17]={}, state[22]={}, reason[34]={};
};
inline bool telemetry(const char* text, Telemetry& t) {
  if (!text || strlen(text)>MissionProtocol::MAX_PACKET) return false;
  int end=0;
  const int n=sscanf(text,"NT1:%lu:%lu:%lu:%lu:%16[0-9A-F]:%u:%21[A-Z_]:%33[A-Z0-9_]:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%ld%n",
    &t.megaVersion,&t.roverVersion,&t.bootId,&t.sequence,t.id,&t.pin,t.state,t.reason,&t.flags,&t.gpsLat,&t.gpsLon,&t.poseLat,&t.poseLon,
    &t.uncertaintyCm,&t.headingCdeg,&t.headingErrorCdeg,&t.distanceCm,&t.travelCm,&t.corrections,&t.calibration,&t.biasMilli,&end);
  uint64_t id;
  return n==21 && end==(int)strlen(text) && t.megaVersion>=30100 && t.megaVersion<40000
    && (t.roverVersion==0 || (t.roverVersion>=30100 && t.roverVersion<40000))
    && strlen(t.id)==16 && MissionProtocol::hex(t.id,16,id)
    && t.pin<=MAX_WAYPOINTS && t.flags<=255 && t.gpsLat<=180000000UL && t.gpsLon<=360000000UL
    && t.poseLat<=180000000UL && t.poseLon<=360000000UL && t.headingCdeg<36000
    && t.headingErrorCdeg<=18000 && t.uncertaintyCm<=100000 && t.distanceCm<=1000000 && t.travelCm<=1000000
    && t.corrections<=1000 && labs(t.biasMilli)<=100000;
}
inline bool formatTelemetry(const Telemetry& t,char* out,size_t size){
  const int n=snprintf(out,size,"NT1:%lu:%lu:%lu:%lu:%s:%u:%s:%s:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%lu:%ld",
    t.megaVersion,t.roverVersion,t.bootId,t.sequence,t.id,t.pin,t.state,t.reason,t.flags,t.gpsLat,t.gpsLon,t.poseLat,t.poseLon,
    t.uncertaintyCm,t.headingCdeg,t.headingErrorCdeg,t.distanceCm,t.travelCm,t.corrections,t.calibration,t.biasMilli);
  return n>0&&(size_t)n<size;
}
inline bool relayTelemetry(const char* megaFrame,char* out,size_t size){
  Telemetry t;if(!telemetry(megaFrame,t))return false;t.roverVersion=FIRMWARE_VERSION;return formatTelemetry(t,out,size);
}
struct CalibrationInfo {
  unsigned long revision=0, valid=0, leftMicro=0, rightMicro=0, widthMicro=0, scaleMilli=0;
  long biasMilli=0; int clockwise=0;
};
inline bool calibration(const char* text, CalibrationInfo& c) {
  int end=0;
  const int n=sscanf(text,"NC1:%lu:%lu:%lu:%lu:%lu:%ld:%lu:%d%n",&c.revision,&c.valid,&c.leftMicro,&c.rightMicro,&c.widthMicro,&c.biasMilli,&c.scaleMilli,&c.clockwise,&end);
  return n==8 && end==(int)strlen(text) && c.valid<=1 && c.leftMicro<=2000000UL && c.rightMicro<=2000000UL
    && c.widthMicro<=3000000UL && labs(c.biasMilli)<=10000 && c.scaleMilli<=2000
    && (c.clockwise==0 || c.clockwise==1 || c.clockwise==-1)
    && (!c.valid || (c.revision && c.leftMicro>=20000 && c.rightMicro>=20000 && c.widthMicro>=100000 && c.scaleMilli>=500 && c.clockwise));
}
}
