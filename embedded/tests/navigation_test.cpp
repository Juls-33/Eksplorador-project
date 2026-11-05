#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <string>
#include <sstream>
#include <iomanip>
#include "../shared/WaypointNavigation.h"
#include "../shared/NavigationCalibration.h"
#define F(text) text
using String=std::string;
struct CapturedSerial {
 std::ostringstream text;
 template<typename T> void print(T value){text<<value;}
 void print(double value,int digits){std::ostringstream number;number<<std::fixed<<std::setprecision(digits)<<value;text<<number.str();}
 template<typename T> void println(T value){print(value);text<<'\n';}
} Serial;
// Execute the actual receiver JSON conversion, not a JS reimplementation.
#include "../1 Final Microcontroller Firmwares (unuploaded)/desktop/Receiver_A3_0/NavigationReceiver.h"
using namespace WaypointNavigation;

// Synthetic measured fixture values ONLY. Never written into real firmware.
Calibration fixtureCalibration(){Calibration c;c.revision=1;c.leftMetersPerRev=.4f;c.rightMetersPerRev=.4f;
 c.trackWidth=.5f;c.gyroBias=.2f;c.gyroScale=1;c.gyroClockwise=-1;return c;}
WaypointProtocol::Point point(float north,float east){WaypointProtocol::Point p;
 p.lat=14609000+(int32_t)lroundf(north/.111195f);p.lon=120989000+(int32_t)lroundf(east/(.111195f*cosf(14.609f*RAD)));return p;}
struct Rover {
 Controller nav;Input s;float actualX=0,actualY=0,actualHeading=0;uint32_t fixes=0;
 bool gps=true,stuckEncoder=false;float drift=0;unsigned maxCorrections=0;
 Rover(unsigned count){nav.calibration=fixtureCalibration();WaypointProtocol::Plan plan;plan.count=count;plan.hasHeading=true;plan.heading=0;
   const float n[]={8,8,0,0},e[]={0,8,8,0};for(unsigned i=0;i<count;++i)plan.points[i]=point(n[i],e[i]);nav.stage(plan);
   s.rcAllowed=true;s.imuValid=true;s.tiltSafe=true;s.obstacle=1;s.satellites=8;s.hdop=50;s.gpsValid=true;s.lat=14609000;s.lon=120989000;s.gyroDps=.2f;
   s.gpsSequence=++fixes;assert(nav.start(s));}
 void tick(){const float dt=.1f;const float dl=nav.output.left*.25f*dt,dr=nav.output.right*.25f*dt;
   const float turn=(dl-dr)/.5f/RAD;actualX+=(dl+dr)*.5f*sinf((actualHeading+turn*.5f)*RAD);
   actualY+=(dl+dr)*.5f*cosf((actualHeading+turn*.5f)*RAD);actualHeading=wrap(actualHeading+turn);
   if(!stuckEncoder)s.leftRev+=dl/.4f;s.rightRev+=dr/.4f;s.gyroDps=-turn/dt+.2f;s.now+=100;
   s.gpsValid=gps;
   if(gps&&s.now%1000==0){const WaypointProtocol::Point p=point(actualY,actualX+drift);s.lat=p.lat;s.lon=p.lon;s.gpsAge=0;s.gpsSequence=++fixes;}
   else s.gpsAge+=100;
   nav.tick(s);if(nav.corrections>maxCorrections)maxCorrections=nav.corrections;
 }
 void run(unsigned ticks=10000){for(unsigned i=0;i<ticks&&nav.active;++i)tick();}
};
void protocol(){
 assert(WaypointProtocol::sampleAge(UINT32_MAX-5,10)==UINT32_MAX);
 assert(WaypointProtocol::sampleAge(100,200)==300);
 assert(!WaypointProtocol::freshSequence(10,10)&&!WaypointProtocol::freshSequence(9,10));
 assert(WaypointProtocol::freshSequence(0,UINT32_MAX));
 WaypointProtocol::Plan plan;assert(WaypointProtocol::parse("N1,W104609000.300989000,W104609500.300989328",plan));
 assert(plan.count==2&&!plan.hasHeading);assert(WaypointProtocol::parse("N1,H359.5,W104609000.300989000",plan));assert(plan.hasHeading);
 for(const char* bad:{"N1","N1,","N1,H360,W0.0","N1,W180000001.0","N1,W0.360000001","N1,W0.0,","F1,W0.0","TIME:F1","N1,HNaN,W0.0","N1,F1,W0.0"})assert(!WaypointProtocol::parse(bad,plan));
 WaypointProtocol::MissionStatus ms;const char* checked="MS:0123456789ABCDEF:5:PIN_CHECKED:2:GPS_WITHIN_5M";
 assert(WaypointProtocol::status(checked,ms));assert(!strcmp(ms.reason,"GPS_WITHIN_5M")&&ms.step==2);
 // The very same parser is called at BOTH ESP32 hops; reproduce the full relay.
 char relay[110];snprintf(relay,sizeof(relay),"MS:%s:%lu:%s:%u:%s",ms.id,(unsigned long)ms.revision,ms.state,ms.step,ms.reason);
 WaypointProtocol::MissionStatus ground;assert(WaypointProtocol::status(relay,ground));assert(!strcmp(ms.reason,ground.reason));
 assert(!WaypointProtocol::status("MS:0123456789ABCDEF:5:PIN_CHECKED:2:GPS_WITHIN_5M:BAD",ground));
 const char* seq="N1,H0,W104609000.300989000,W104609500.300989328";
 char frame[256];const uint32_t crc=MissionProtocol::crc32(seq,strlen(seq));snprintf(frame,sizeof(frame),"M2:0123456789ABCDEF:%08lX:%s",(unsigned long)crc,seq);
 MissionProtocol::Frame f;assert(MissionProtocol::parse(frame,f));MissionProtocol::Record record=MissionProtocol::reserve(f);
 assert(MissionProtocol::classify(f,record)==MissionProtocol::Delivery::UNCERTAIN);record.stage=MissionProtocol::UART_QUEUED;
 assert(MissionProtocol::classify(f,record)==MissionProtocol::Delivery::DUPLICATE);frame[strlen(frame)-1]='9';assert(!MissionProtocol::parse(frame,f));
 char route[227]="N1";for(int i=0;i<10;++i)strcat(route,",W104609000.300989000");assert(WaypointProtocol::parse(route,plan));
 char oversized[256];snprintf(oversized,sizeof(oversized),"%s,W104609000.300989000",route);assert(!WaypointProtocol::parse(oversized,plan));
 WaypointProtocol::Telemetry tele;assert(WaypointProtocol::telemetry("NT1:30100:30100:100:1:0123456789ABCDEF:1:RUNNING:STEERING_CORRECTION:255:104609000:300989000:104609001:300989001:250:9000:500:800:50:1:1:200",tele));
 char relayed[256];assert(WaypointProtocol::relayTelemetry("NT1:30100:0:100:1:0123456789ABCDEF:1:RUNNING:STEERING_CORRECTION:255:104609000:300989000:104609001:300989001:250:9000:500:800:50:1:1:200",relayed,sizeof(relayed)));
 assert(WaypointProtocol::telemetry(relayed,tele)&&tele.megaVersion==30100&&tele.roverVersion==30100);
 WaypointProtocol::CalibrationInfo cal;assert(WaypointProtocol::calibration("NC1:1:1:400000:400000:500000:200:1000:-1",cal));
 assert(!WaypointProtocol::calibration("NC1:1:1:0:400000:500000:200:1000:-1",cal));
}
void missions(){for(unsigned count:{2,3,4}){Rover r(count);r.run();
 if(strcmp(r.nav.state,"COMPLETE"))fprintf(stderr,"route %u stopped %s:%s x=%.2f y=%.2f pin=%u uncertainty=%.2f headingunc=%.2f\n",count,r.nav.state,r.nav.reason,r.actualX,r.actualY,r.nav.pin,r.nav.uncertainty,r.nav.headingUncertainty);
 assert(!strcmp(r.nav.state,"COMPLETE"));assert(r.maxCorrections>0);assert(r.nav.travel<100);assert(!r.nav.output.left&&!r.nav.output.right);}
 Rover longRoute(2);WaypointProtocol::Plan plan;plan.count=2;plan.hasHeading=true;plan.heading=0;
 plan.points[0]=point(49.5f,0);plan.points[1]=point(49.5f,32.8f);longRoute.nav.stage(plan);assert(longRoute.nav.start(longRoute.s));longRoute.run();
 assert(!strcmp(longRoute.nav.state,"COMPLETE"));assert(longRoute.nav.travel<100);
}
void faults(){
 {ExecutionGate gate;assert(!gate.poll(true,false,1900,true,true));assert(!gate.poll(true,true,1900,true,true));
  assert(!gate.poll(true,true,1500,true,true));assert(gate.poll(true,true,1900,true,true));assert(!gate.poll(true,true,1900,true,true));
  gate.reset();assert(!gate.poll(true,false,1500,true,true));assert(!gate.poll(true,false,1900,true,true));assert(!gate.poll(true,true,1900,true,true));
  assert(!gate.poll(false,false,1500,true,true));assert(!gate.poll(true,true,1900,true,true));
  assert(!gate.poll(true,true,1500,true,true));assert(gate.poll(true,true,1900,true,true));}
 {Rover r(2);for(int i=0;i<40;++i)r.tick();r.gps=false;for(int i=0;i<20;++i)r.tick();assert(r.nav.active);r.gps=true;r.run();assert(!strcmp(r.nav.state,"COMPLETE"));}
 {Rover r(2);r.gps=false;r.run(100);assert(!r.nav.active&&!strcmp(r.nav.reason,"DR_LIMIT"));r.gps=true;for(int i=0;i<10;++i)r.tick();assert(!r.nav.active);}
 {Rover r(2);r.drift=.7f;r.run();assert(!strcmp(r.nav.state,"COMPLETE"));assert(r.maxCorrections>0);}
 {Rover r(2);r.drift=25;r.run();assert(!strcmp(r.nav.reason,"GPS_INNOVATION"));}
 {Rover r(2);r.stuckEncoder=true;r.run();assert(!r.nav.active);assert(!strcmp(r.nav.reason,"POSE_UNCERTAIN")||!strcmp(r.nav.reason,"ENCODER_DISAGREEMENT"));}
 {Rover r(2);r.tick();r.tick();r.s.obstacle=2;r.tick();assert(!strcmp(r.nav.reason,"OBSTACLE_DETECTED"));r.s.obstacle=1;r.run(20);assert(!r.nav.active&&!r.nav.output.left);}
 {Rover r(2);r.s.rcAllowed=false;r.tick();assert(!strcmp(r.nav.reason,"RC_SIGNAL_LOST")&&!r.nav.output.left);}
 {Rover r(2);r.s.manual=true;r.tick();assert(!strcmp(r.nav.reason,"MANUAL_TAKEOVER")&&!r.nav.output.left);}
 {Rover r(2);r.s.tiltSafe=false;r.tick();assert(!strcmp(r.nav.reason,"TILT_SAFETY"));}
 {Rover r(2);r.nav.heading=120;r.run();assert(!r.nav.active);assert(strcmp(r.nav.state,"COMPLETE")==0||strcmp(r.nav.state,"HOLD")==0||strcmp(r.nav.state,"FAULT")==0);assert(r.nav.travel<=200);}
 {Controller c;WaypointProtocol::Plan p;assert(WaypointProtocol::parse("N1,H0,W104609000.300989000",p));c.stage(p);Input s;s.rcAllowed=true;s.gpsValid=true;s.imuValid=true;s.hdop=50;s.satellites=8;assert(!c.start(s));assert(!strcmp(c.reason,"CALIBRATION_REQUIRED"));
 c.calibration=fixtureCalibration();c.headingValid=false;assert(!c.start(s));assert(!strcmp(c.reason,"WAIT_HEADING"));c.setHeading(0);s.gpsValid=false;assert(!c.start(s));assert(!strcmp(c.reason,"WAIT_GPS"));}
}
void calibration(){
 using namespace NavigationCalibration;Session session;Input s;s.imuValid=true;s.gyroDps=.2f;
 assert(!session.ready());assert(session.begin("ZERO",s));for(int i=0;i<40;++i){s.now+=100;session.observe(s);}assert(session.end(0,s));
 for(int t=0;t<2;++t){assert(session.begin("STRAIGHT",s));for(int i=0;i<50;++i){s.now+=100;s.leftRev+=.05f;s.rightRev+=.05f;session.observe(s);}assert(session.end(1,s));}
 for(const char* side:{"LEFT","RIGHT"})for(int t=0;t<2;++t){assert(session.begin(side,s));const float sign=!strcmp(side,"RIGHT")?1.f:-1.f;
  for(int i=0;i<50;++i){s.now+=100;s.leftRev+=sign*(.5f*(90.f*RAD)/2.f/.4f)/50;s.rightRev-=sign*(.5f*(90.f*RAD)/2.f/.4f)/50;s.gyroDps=.2f-sign*18;session.observe(s);}assert(session.end(90,s));}
 assert(session.ready());assert(fabsf(session.measured.leftMetersPerRev-.4f)<.001f);assert(fabsf(session.measured.trackWidth-.5f)<.001f);assert(session.measured.gyroClockwise==-1);
 Record record;record.magic=MAGIC;record.value=session.measured;record.checksum=checksum(record);assert(valid(record));
 record.value.leftMetersPerRev+=.01f;assert(!valid(record));record.magic=0;assert(!valid(record));
 Session bad;assert(bad.begin("ZERO",s));s.now+=100;s.leftRev+=.1f;bad.observe(s);assert(!bad.zeroReady&&!bad.recording);
}
int main(int argc,char** argv){
 if(argc==2&&!strcmp(argv[1],"--navigation-json")){
  processNavigationPacket("NT1:30100:30100:100:1:0123456789ABCDEF:1:STAGED:READY_RC_EDGE:93:104609000:300989000:104609000:300989000:250:0:500:800:0:0:1:200");
  processNavigationPacket("NT1:30100:30100:100:2:0123456789ABCDEF:1:RUNNING:STEERING_CORRECTION:191:104609000:300989000:104609001:300989001:250:500:550:700:100:1:1:200");
  processNavigationCalibration("NC1:1:1:400000:400000:500000:200:1000:-1");
  fputs(Serial.text.str().c_str(),stdout);return 0;
 }
 if(argc==2&&!strcmp(argv[1],"--status-json")){
  for(const char* raw:{"MS:0123456789ABCDEF:1:STAGED:0:WAIT_HEADING","MS:0123456789ABCDEF:2:RUNNING:1:FORWARD_ENCODER", "MS:0123456789ABCDEF:3:STEP_DONE:1:ENCODER_ESTIMATE", "MS:0123456789ABCDEF:4:PIN_CHECKED:1:GPS_WITHIN_5M", "MS:0123456789ABCDEF:5:PIN_CHECKED:2:GPS_WITHIN_5M", "MS:0123456789ABCDEF:6:COMPLETE:2:GPS_ROUTE_VERIFIED"}){
   WaypointProtocol::MissionStatus rover,receiver;assert(WaypointProtocol::status(raw,rover));
   char line[110];snprintf(line,sizeof(line),"MS:%s:%lu:%s:%u:%s",rover.id,(unsigned long)rover.revision,rover.state,rover.step,rover.reason);
   assert(WaypointProtocol::status(line,receiver));char json[256];assert(WaypointProtocol::statusJson(receiver,-42,8.6f,json,sizeof(json)));puts(json);
  }return 0;
 }
 protocol();missions();faults();calibration();puts("Waypoint protocol, exact relay parser, estimator/controller and measured calibration tests passed.");
}
