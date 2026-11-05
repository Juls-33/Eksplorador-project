#pragma once
#include <stdint.h>

// Motor-independent production PWM capture and rearm gate. No I/O, allocation,
// logging, delays or filtering in edge(). Caller snapshots under interrupt lock.
namespace RcSafety {
constexpr uint8_t COUNT=6;
constexpr uint16_t MIN_US=850,MAX_US=2150,ARM_US=1500,MID_US=1500,DEADZONE_US=45;
constexpr uint32_t TIMEOUT_MS=250,REARM_MS=400;
enum Cause:uint8_t {NONE,STARTUP,INVALID_PULSE,UNPAIRED_EDGE,STALE_CHANNEL,DISARM_INPUT};
enum Change:uint8_t {LATCH=1,DISARM_READY=2,REARMED=4,FRESH_RESTORED=8,CHANNELS_CHANGED=16,ARM_REJECTED=32};
// Arm rejection is diagnostic only; it never weakens authorization.
enum Reject:uint8_t {REJECT_NONE=0,REJECT_NO_DISARM_HOLD=1,REJECT_STICKS_OFF_CENTER=2};
inline uint8_t channelNumber(uint8_t index){const uint8_t numbers[]={1,2,4,5,6,8};return index<COUNT?numbers[index]:0;}
inline const char* causeName(Cause c){switch(c){
 case STARTUP:return "STARTUP";case INVALID_PULSE:return "INVALID_PULSE";
 case UNPAIRED_EDGE:return "UNPAIRED_EDGE";case STALE_CHANNEL:return "STALE_CHANNEL";
 case DISARM_INPUT:return "DISARM_INPUT";default:return "NONE";}}
struct Issue {
 uint32_t atMs=0,atUs=0,width=0,ageMs=UINT32_MAX;
 uint8_t channel=255;Cause cause=NONE;
};
struct Channel {
 uint32_t riseUs=0,width=0,lastValidMs=0,fallUs=0;
 uint16_t invalidCount=0,lastValidWidth=0;
 bool high=false,seen=false,valid=false;
};
struct Snapshot {
 Channel channels[COUNT];Issue pending;
 uint32_t nowMs=0,nowUs=0;
 uint8_t pendingMask=0;
};
class Capture {
 public:
 Channel channels[COUNT];Issue pending;uint8_t pendingMask=0;
 void edge(uint8_t index,bool high,uint32_t us,uint32_t ms) volatile {
  if(index>=COUNT)return;
  volatile Channel& c=channels[index];
  if(high){
   if(c.high){
    if(pending.cause==NONE){pending.atMs=ms;pending.atUs=us;pending.width=us-c.riseUs;
     pending.ageMs=c.seen?ms-c.lastValidMs:UINT32_MAX;pending.channel=index;pending.cause=UNPAIRED_EDGE;}
    pendingMask|=(uint8_t)(1U<<index);c.valid=false;
    if(c.invalidCount!=UINT16_MAX)++c.invalidCount;
   }
   c.riseUs=us;c.high=true;return;
  }
  const bool paired=c.high;c.high=false;
  const uint32_t width=paired?us-c.riseUs:0;
  const bool good=paired&&width>=MIN_US&&width<=MAX_US;
  const bool disarm=good&&index==3&&width<ARM_US&&c.valid&&c.width>=ARM_US;
  const bool gap=good&&c.seen&&ms-c.lastValidMs>TIMEOUT_MS;
  const uint32_t oldWidth=c.lastValidWidth;
  c.width=width;c.fallUs=us;
  if(!good||disarm||gap){
   if(pending.cause==NONE){pending.atMs=ms;pending.atUs=us;pending.width=width;
    pending.ageMs=c.seen?ms-c.lastValidMs:UINT32_MAX;pending.channel=index;
    pending.cause=gap?STALE_CHANNEL:(good?DISARM_INPUT:(paired?INVALID_PULSE:UNPAIRED_EDGE));
    if(gap){pending.atMs=c.lastValidMs+TIMEOUT_MS+1;pending.atUs=us-(ms-pending.atMs)*1000UL;pending.width=oldWidth;}}
   pendingMask|=disarm&&!gap?0x40:(uint8_t)(1U<<index);
  }
  c.valid=good;
  if(good){c.lastValidMs=ms;c.lastValidWidth=width;c.seen=true;}
  else if(c.invalidCount!=UINT16_MAX)++c.invalidCount;
 }
 // Only call with interrupts disabled. Retains last-valid timestamps and full
 // invalid widths; consumes the first-edge latch only after copying evidence.
 void take(Snapshot& s,uint32_t ms,uint32_t us) volatile {
  s.nowMs=ms;s.nowUs=us;
  for(uint8_t i=0;i<COUNT;++i){const volatile Channel& c=channels[i];Channel& d=s.channels[i];
   d.riseUs=c.riseUs;d.width=c.width;d.lastValidMs=c.lastValidMs;d.fallUs=c.fallUs;
   d.invalidCount=c.invalidCount;d.lastValidWidth=c.lastValidWidth;d.high=c.high;d.seen=c.seen;d.valid=c.valid;
  }
  s.pending.atMs=pending.atMs;s.pending.atUs=pending.atUs;s.pending.width=pending.width;
  s.pending.ageMs=pending.ageMs;s.pending.channel=pending.channel;s.pending.cause=pending.cause;
  s.pendingMask=pendingMask;pending.cause=NONE;pendingMask=0;
 }
};
inline bool neutral(uint32_t width){return width>MID_US-DEADZONE_US&&width<MID_US+DEADZONE_US;}
class Gate {
 public:
 bool fresh=false,rearmRequired=true,disarmObserved=false,authorized=false;
 uint8_t badMask=0,changes=0,neutralBadMask=0,lastArmReject=REJECT_NONE;
 uint16_t disarmHoldMs=0;
 Issue lastLatch;
 void evaluate(const Snapshot& s){
  changes=0;badMask=0;Issue issue=s.pending;
  for(uint8_t i=0;i<COUNT;++i){const Channel& c=s.channels[i];Issue candidate;
   candidate.channel=i;candidate.width=c.width;candidate.ageMs=c.seen?s.nowMs-c.lastValidMs:UINT32_MAX;
   if(!c.seen){candidate.cause=STARTUP;candidate.atMs=s.nowMs;candidate.atUs=s.nowUs;}
   else if(candidate.ageMs>TIMEOUT_MS){candidate.cause=STALE_CHANNEL;candidate.atMs=c.lastValidMs+TIMEOUT_MS+1;
    candidate.atUs=s.nowUs-(s.nowMs-candidate.atMs)*1000UL;candidate.width=c.lastValidWidth;}
   else if(!c.valid){candidate.cause=INVALID_PULSE;candidate.atUs=c.fallUs;
    candidate.atMs=s.nowMs-(s.nowUs-c.fallUs)/1000;}
   if(candidate.cause!=NONE){badMask|=(uint8_t)(1U<<i);
    if(issue.cause==NONE||s.nowMs-candidate.atMs>s.nowMs-issue.atMs)issue=candidate;}
  }
  const bool wasFresh=fresh;fresh=!badMask&&!(s.pendingMask&0x3f);
  neutralBadMask=0;
  for(uint8_t i=0;i<3;++i)if(!neutral(s.channels[i].width))neutralBadMask|=(uint8_t)(1U<<i);
  const bool centered=neutralBadMask==0;
  const bool armLow=s.channels[3].width<ARM_US;
  const bool starting=!initialized;
  if(starting){initialized=true;lastLatch.atMs=s.nowMs;lastLatch.atUs=s.nowUs;
   lastLatch.cause=STARTUP;changes|=LATCH;}
  if(!fresh){
   if(!faultActive){lastLatch=issue;changes|=LATCH;}
   else if(badMask!=previousBadMask)changes|=CHANNELS_CHANGED;
   rearmRequired=true;disarmObserved=false;disarmTiming=false;disarmHoldMs=0;faultActive=true;
  }else{
   if(!wasFresh)changes|=FRESH_RESTORED;
   faultActive=false;
   if(s.pending.cause==DISARM_INPUT){lastLatch=s.pending;changes|=LATCH;
    rearmRequired=true;disarmObserved=false;disarmTiming=false;disarmHoldMs=0;}
   if(armLow){
    if(!starting&&(!wasLow||!rearmRequired)&&s.pending.cause!=DISARM_INPUT){lastLatch={};lastLatch.cause=DISARM_INPUT;
     lastLatch.channel=3;lastLatch.width=s.channels[3].width;lastLatch.ageMs=s.nowMs-s.channels[3].lastValidMs;
     lastLatch.atUs=s.channels[3].fallUs;lastLatch.atMs=s.nowMs-(s.nowUs-lastLatch.atUs)/1000;changes|=LATCH;}
    rearmRequired=true;
    if(!centered){disarmTiming=false;disarmObserved=false;disarmHoldMs=0;}
    else {if(!disarmTiming){disarmSince=s.nowMs;disarmTiming=true;}
     const uint32_t held=s.nowMs-disarmSince;disarmHoldMs=(uint16_t)(held>65535?65535:held);
     if(!disarmObserved&&held>=REARM_MS){disarmObserved=true;changes|=DISARM_READY;}}
   }else{
    // Arming with non-neutral sticks consumes the disarm observation. Holding
    // ARM high and later centering must never cause a silent delayed rearm.
    if(rearmRequired&&disarmObserved&&centered){rearmRequired=false;lastArmReject=REJECT_NONE;changes|=REARMED;}
    else if(rearmRequired&&wasLow){lastArmReject=centered?REJECT_NO_DISARM_HOLD:REJECT_STICKS_OFF_CENTER;changes|=ARM_REJECTED;}
    disarmObserved=false;disarmTiming=false;disarmHoldMs=0;
   }
  }
  wasLow=fresh&&armLow;previousBadMask=badMask;
  authorized=fresh&&!armLow&&!rearmRequired;
 }
 private:
 bool initialized=false,faultActive=false,wasLow=false,disarmTiming=false;
 uint32_t disarmSince=0;uint8_t previousBadMask=0;
};
}
