#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <RcSafety.h>

// Execute the real Mega adapter/formatter with a bounded, simulated USB sink.
uint8_t SREG=128;uint32_t clockUs=0;const int HIGH=1;
void cli(){SREG=0;}uint32_t micros(){return clockUs;}uint32_t millis(){return clockUs/1000;}
int digitalRead(uint8_t){return 0;}
struct SerialSink {
 int room=63;std::string output;unsigned writes=0;
 int availableForWrite(){return room;}
 size_t write(const uint8_t* s,size_t n){assert(n<=63&&n<=(unsigned)room);output.append((const char*)s,n);++writes;return n;}
}Serial;
#include "../1 Final Microcontroller Firmwares (unuploaded)/mega/Mega_A3_0/RcMega.h"

using namespace RcSafety;
struct Receiver {
 Capture capture;Gate gate;Snapshot snapshot;
 uint32_t now=100;uint32_t widths[COUNT]={1500,1500,1500,1000,1000,1000};
 void pulse(unsigned i,uint32_t width){capture.edge(i,true,now*1000-width,now-width/1000);capture.edge(i,false,now*1000,now);}
 void frame(uint32_t advance=20,int skip=-1){now+=advance;for(unsigned i=0;i<COUNT;++i)if((int)i!=skip)pulse(i,widths[i]);decide();}
 void decide(){capture.take(snapshot,now,now*1000);gate.evaluate(snapshot);}
 void arm(){frame();for(int i=0;i<20;++i)frame();assert(gate.disarmObserved);widths[3]=1990;frame();assert(gate.authorized);}
};
void startupAndRecovery(){
 Receiver r;r.decide();assert(!r.gate.fresh&&r.gate.rearmRequired&&r.gate.lastLatch.cause==STARTUP);
 r.widths[3]=1990;for(int i=0;i<50;++i)r.frame();assert(!r.gate.authorized);
 r.widths[3]=1000;r.frame();for(int i=0;i<19;++i)r.frame();assert(!r.gate.disarmObserved);
 r.frame();assert(r.gate.disarmObserved);r.widths[3]=1990;r.frame();assert(r.gate.authorized);
 // Known failure: valid current CH5/CH6 cannot clear a historical latch.
 r.pulse(5,700);r.decide();assert(!r.gate.authorized&&r.gate.lastLatch.channel==5);
 for(int i=0;i<50;++i)r.frame();assert(r.gate.fresh&&r.gate.rearmRequired&&!r.gate.disarmObserved);
 assert(r.gate.lastLatch.cause==INVALID_PULSE&&r.gate.lastLatch.width==700);
 r.widths[3]=1000;r.arm();
}
void everyChannelAndEdges(){
 for(unsigned ch=0;ch<COUNT;++ch){Receiver r;r.arm();const uint32_t last=r.snapshot.channels[ch].lastValidMs;
  r.now+=5;r.pulse(ch,700);r.now+=5;r.pulse(ch,r.widths[ch]);r.decide();
  assert(!r.gate.fresh&&!r.gate.authorized&&r.gate.rearmRequired);
  assert(r.gate.lastLatch.channel==ch&&r.gate.lastLatch.width==700&&r.gate.lastLatch.ageMs==5);
  assert(r.gate.lastLatch.atMs==last+5);r.frame();assert(r.gate.fresh&&!r.gate.authorized);
 }
 Receiver r;r.arm();r.now+=5;r.pulse(1,70000);r.decide();assert(r.gate.lastLatch.width==70000); // No uint16 truncation.
 Receiver unpaired;unpaired.capture.edge(2,false,100000,100);unpaired.decide();
 assert(unpaired.snapshot.pending.cause==UNPAIRED_EDGE);
 Receiver repeated;repeated.arm();const uint32_t baseMs=repeated.now,baseUs=baseMs*1000;
 repeated.capture.edge(1,true,baseUs+1000,baseMs+1);repeated.capture.edge(1,true,baseUs+21000,baseMs+21);
 repeated.capture.edge(1,false,baseUs+22500,baseMs+22);repeated.now+=23;repeated.decide();
 assert(repeated.snapshot.pending.cause==UNPAIRED_EDGE&&repeated.gate.lastLatch.cause==UNPAIRED_EDGE&&!repeated.gate.authorized);
 Capture c;Snapshot s;for(uint16_t w:{850,2150}){c.edge(0,true,10000,10);c.edge(0,false,10000+w,12);c.take(s,12,13000);assert(s.channels[0].valid);}
 for(uint16_t w:{849,2151}){c.edge(0,true,20000,20);c.edge(0,false,20000+w,22);c.take(s,22,23000);assert(!s.channels[0].valid&&s.pending.width==w);}
 // Earliest ISR failure retained, later faults visible in the mask.
 Receiver multi;multi.arm();multi.now+=5;multi.pulse(4,700);multi.now+=1;multi.pulse(0,2200);multi.decide();
 assert(multi.gate.lastLatch.channel==4&&(multi.snapshot.pendingMask&17)==17);
}
void lossAndHeldOutput(){
 for(unsigned ch=0;ch<COUNT;++ch){Receiver r;r.arm();const uint32_t last=r.snapshot.channels[ch].lastValidMs;
  for(int i=0;i<12;++i)r.frame(20,ch);assert(r.gate.authorized);
  r.frame(10,ch);assert(r.gate.authorized);r.frame(1,ch);assert(!r.gate.authorized);
  assert(r.gate.lastLatch.channel==ch&&r.gate.lastLatch.cause==STALE_CHANNEL&&r.gate.lastLatch.atMs==last+251);
 }
 Receiver loss;loss.arm();loss.now+=251;loss.decide();assert(!loss.gate.fresh&&loss.gate.badMask==63);
 for(int i=0;i<30;++i)loss.frame();assert(!loss.gate.authorized); // RF recovery never rearms.
 // PWM held by receiver at valid armed values is physically indistinguishable
 // from an unchanged operator command. The test documents this limitation.
 Receiver held;held.arm();for(int i=0;i<500;++i)held.frame();assert(held.gate.authorized);
 held.widths[3]=1000;held.frame();assert(!held.gate.authorized&&held.gate.lastLatch.cause==DISARM_INPUT);
 // Stale gap recovered during a blocked loop is retained by capture itself.
 Receiver blocked;blocked.arm();blocked.frame(300);assert(!blocked.gate.authorized);
 assert(blocked.gate.lastLatch.cause==STALE_CHANNEL&&blocked.gate.lastLatch.ageMs==300);
 // A busy foreground loop is not itself RC loss if interrupts keep receiving
 // good pulses. Snapshotting immediately before the gate avoids stale copies.
 Receiver busy;busy.arm();for(int n=0;n<15;++n){busy.now+=20;for(unsigned i=0;i<COUNT;++i)busy.pulse(i,busy.widths[i]);}
 busy.decide();assert(busy.gate.authorized&&busy.gate.fresh);
 Receiver persistent;persistent.arm();persistent.now+=5;persistent.pulse(0,700);persistent.decide();const uint32_t first=persistent.gate.lastLatch.atMs;
 for(int n=0;n<20;++n){persistent.now+=20;persistent.pulse(0,700);persistent.decide();}
 assert(persistent.gate.lastLatch.atMs==first&&persistent.gate.lastLatch.cause==INVALID_PULSE);
 Receiver late;late.arm();const uint32_t last=late.now;late.now+=300;late.pulse(0,300000);late.decide();
 assert(late.gate.lastLatch.cause==STALE_CHANNEL&&late.gate.lastLatch.atMs==last+251&&late.gate.lastLatch.width==1500);
}
void deliberateArmAndRollover(){
 Receiver r;r.frame();for(int i=0;i<20;++i)r.frame();assert(r.gate.disarmObserved);
 r.widths[0]=1600;r.widths[3]=1990;r.frame();assert(!r.gate.authorized&&!r.gate.disarmObserved);
 r.widths[0]=1500;r.frame();assert(!r.gate.authorized);r.widths[3]=1000;r.arm();
 // Genuine brief low pulse followed by high between loops is still a disarm.
 r.now+=5;r.pulse(3,1000);r.now+=5;r.pulse(3,1990);r.decide();assert(!r.gate.authorized&&r.gate.lastLatch.cause==DISARM_INPUT);
 Receiver wrap;wrap.now=UINT32_MAX-500;wrap.arm();for(int i=0;i<60;++i)wrap.frame();assert(wrap.gate.authorized);
 Capture c;Snapshot s;c.edge(0,true,UINT32_MAX-999,0);c.edge(0,false,500,1);c.take(s,1,500);assert(s.channels[0].valid&&s.channels[0].width==1500);
 // A valid pulse received at millis()==0 is not confused with "never seen".
 Receiver zero;zero.now=0;for(unsigned i=0;i<COUNT;++i)zero.pulse(i,zero.widths[i]);zero.decide();assert(zero.gate.fresh);
}
void diagnosticBudget(){
 Receiver r;r.arm();r.now+=1;r.pulse(2,700);r.decide();rcGate=r.gate;
 rcQueueDiagnostic(LATCH,r.snapshot);Serial.room=0;rcServiceDiagnostics();assert(Serial.writes==0&&rcEventCount==1);
 Serial.room=63;for(int i=0;i<7;++i)rcServiceDiagnostics();assert(Serial.writes==7&&rcEventCount==0);
 assert(Serial.output.find("INVALID_PULSE ch=4")!=std::string::npos);
 assert(Serial.output.find("us=700 age=1")!=std::string::npos);
 for(unsigned i=0;i<RC_DIAG_CAPACITY+4;++i)rcQueueDiagnostic(LATCH,r.snapshot);assert(rcDiagnosticDrops==4);
 for(int i=0;i<100;++i)rcServiceDiagnostics();assert(rcEventCount==0);
 rcGate.lastLatch.atMs=rcGate.lastLatch.atUs=rcGate.lastLatch.width=rcGate.lastLatch.ageMs=UINT32_MAX;
 rcDecisionGapUs=rcSensorWorkUs=rcEspWorkUs=rcUsbWorkUs=rcPreviousTailUs=rcMaxDecisionGapUs=UINT32_MAX;
 rcMaxMaskedUs=rcObservedIsrMaxUs=65535;rcDiagnosticId=65535;
 rcQueueDiagnostic(LATCH,r.snapshot);for(int i=0;i<7;++i)rcServiceDiagnostics();
 assert(Serial.output.find("FORMAT_OVERFLOW")==std::string::npos);
 assert(!rcGate.authorized&&rcGate.rearmRequired); // Diagnostics never rearm.
 // Snapshot restores interrupt state even when entered with interrupts off.
 SREG=0;RcSafety::Snapshot snapshot;rcTakeSnapshot(snapshot);assert(SREG==0);SREG=128;rcTakeSnapshot(snapshot);assert(SREG==128);
}
int main(){startupAndRecovery();everyChannelAndEdges();lossAndHeldOutput();deliberateArmAndRollover();diagnosticBudget();
 puts("RC capture/rearm regression passed: six channels, glitches, loss, held outputs, recovery, rollover and bounded diagnostics.");}
