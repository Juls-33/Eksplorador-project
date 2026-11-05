#pragma once
#include "RcSafety.h"
#include <stdio.h>
#include <string.h>

volatile RcSafety::Capture rcCapture;
RcSafety::Gate rcGate;
bool rcOutputAuthorized=false,rcDisarmObserved=false,rcRearmRequired=true;
// Microsecond durations are local observations, not a measurement of external
// interrupt latency. A logic analyzer is required to establish edge latency.
uint32_t rcDecisionAtUs=0,rcDecisionGapUs=0,rcMaxDecisionGapUs=0;
uint32_t rcSensorWorkUs=0,rcEspWorkUs=0,rcUsbWorkUs=0,rcPreviousTailUs=0;
uint16_t rcMaxMaskedUs=0;
volatile uint16_t rcEdgeIsrMaxUs=0;
uint16_t rcObservedIsrMaxUs=0;
struct RcDiagnostic {
 RcSafety::Issue issue;
 uint32_t decisionMs,gapUs,sensorUs,espUs,usbUs,tailUs;
 uint16_t maskedUs,isrUs,invalidCount;
 uint8_t changes,badMask,pendingMask,neutralBadMask,armReject;
 uint16_t holdMs;
 bool fresh,rearm,disarm;
};
constexpr uint8_t RC_DIAG_CAPACITY=6;
RcDiagnostic rcEvents[RC_DIAG_CAPACITY];uint8_t rcEventHead=0,rcEventCount=0;
uint16_t rcDiagnosticDrops=0;
char rcDiagnosticLine[64];uint8_t rcDiagnosticLength=0,rcDiagnosticPart=0;
uint16_t rcDiagnosticId=0;
uint32_t rcLastSummaryMs=0;

void rcRecordMasked(uint32_t duration){if(duration>rcMaxMaskedUs)rcMaxMaskedUs=duration>65535?65535:duration;}
void rcInputEdge(uint8_t index,uint8_t pin){
 const bool high=digitalRead(pin)==HIGH;
 const uint32_t us=micros();const uint32_t ms=millis();
 rcCapture.edge(index,high,us,ms);
 const uint32_t duration=micros()-us;
 if(duration>rcEdgeIsrMaxUs)rcEdgeIsrMaxUs=duration>65535?65535:duration;
}
void rcTakeSnapshot(RcSafety::Snapshot& s){
 const uint8_t saved=SREG;cli();const uint32_t start=micros();
 rcCapture.take(s,millis(),start);
 rcObservedIsrMaxUs=rcEdgeIsrMaxUs;
 const uint32_t duration=micros()-start;SREG=saved;rcRecordMasked(duration);
 rcDecisionGapUs=rcDecisionAtUs?s.nowUs-rcDecisionAtUs:0;rcDecisionAtUs=s.nowUs;
 if(rcDecisionGapUs>rcMaxDecisionGapUs)rcMaxDecisionGapUs=rcDecisionGapUs;
}
void rcQueueDiagnostic(uint8_t changes,const RcSafety::Snapshot& s){
 if(rcEventCount==RC_DIAG_CAPACITY){if(rcDiagnosticDrops!=65535)++rcDiagnosticDrops;return;}
 RcDiagnostic& d=rcEvents[(rcEventHead+rcEventCount)%RC_DIAG_CAPACITY];
 d.issue=rcGate.lastLatch;d.decisionMs=s.nowMs;d.changes=changes;d.badMask=rcGate.badMask;d.pendingMask=s.pendingMask;
 d.gapUs=rcDecisionGapUs;d.sensorUs=rcSensorWorkUs;d.espUs=rcEspWorkUs;d.usbUs=rcUsbWorkUs;d.tailUs=rcPreviousTailUs;d.maskedUs=rcMaxMaskedUs;
 d.isrUs=rcObservedIsrMaxUs;d.invalidCount=d.issue.channel<RcSafety::COUNT?s.channels[d.issue.channel].invalidCount:0;
 d.fresh=rcGate.fresh;d.rearm=rcGate.rearmRequired;d.disarm=rcGate.disarmObserved;
 d.holdMs=rcGate.disarmHoldMs;d.neutralBadMask=rcGate.neutralBadMask;d.armReject=rcGate.lastArmReject;++rcEventCount;
}
// Only called after motor control. Never print from an ISR or wait for Serial.
// Write one complete <=63-byte part only if TX has room. Existing debug prints
// may occur BETWEEN numbered parts, never inside a partial diagnostic line.
void rcServiceDiagnostics(){
 if(!rcEventCount)return;
 if(!rcDiagnosticLength){
  const RcDiagnostic& d=rcEvents[rcEventHead];
  int n=0;
  switch(rcDiagnosticPart){
   case 0:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/0] t=%lu c=%s ch=%u\n",rcDiagnosticId,(unsigned long)d.decisionMs,RcSafety::causeName(d.issue.cause),RcSafety::channelNumber(d.issue.channel));break;
   case 1:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/1] us=%lu age=%lu at=%lu\n",rcDiagnosticId,(unsigned long)d.issue.width,(unsigned long)d.issue.ageMs,(unsigned long)d.issue.atMs);break;
   case 2:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/2] edge_us=%lu bad=%u pend=%u ev=%u\n",rcDiagnosticId,(unsigned long)d.issue.atUs,d.badMask,d.pendingMask,d.changes);break;
   case 3:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/3] fresh=%u rear=%u low=%u hold=%u badN=%u rej=%u\n",rcDiagnosticId,(unsigned)d.fresh,(unsigned)d.rearm,(unsigned)d.disarm,(unsigned)d.holdMs,(unsigned)d.neutralBadMask,(unsigned)d.armReject);break;
   case 4:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/4] gap=%lu sensor=%lu esp=%lu\n",rcDiagnosticId,(unsigned long)d.gapUs,(unsigned long)d.sensorUs,(unsigned long)d.espUs);break;
   case 5:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/5] tail=%lu irqoff=%u isr=%u\n",rcDiagnosticId,(unsigned long)d.tailUs,d.maskedUs,d.isrUs);break;
   case 6:n=snprintf(rcDiagnosticLine,sizeof(rcDiagnosticLine),"[RC %u/6] usb=%lu maxgap=%lu err=%u\n",rcDiagnosticId,(unsigned long)d.usbUs,(unsigned long)rcMaxDecisionGapUs,d.invalidCount);break;
  }
  if(n<0||n>=(int)sizeof(rcDiagnosticLine)){
   const char marker[]="[RC_DIAG] FORMAT_OVERFLOW\n";memcpy(rcDiagnosticLine,marker,sizeof(marker));
   rcDiagnosticLength=sizeof(marker)-1;
  }else rcDiagnosticLength=n;
 }
 if(Serial.availableForWrite()<rcDiagnosticLength)return;
 Serial.write((const uint8_t*)rcDiagnosticLine,rcDiagnosticLength);rcDiagnosticLength=0;
 if(++rcDiagnosticPart==7){rcDiagnosticPart=0;rcEventHead=(rcEventHead+1)%RC_DIAG_CAPACITY;--rcEventCount;++rcDiagnosticId;}
}
