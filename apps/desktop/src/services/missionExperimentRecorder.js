import { compareWaypointGps, gpsObservation } from '../utils/missionPlanning.js';

// Session memory only. This recorder has no drive, database or mission API.
export function createMissionExperimentRecorder({ listen, clock = Date.now, limit = 10000 }) {
  let plan = null, records = [], dropped = 0, recording = false, stops = [], missionId = null;
  let generation = 0;
  let archives=[],archiveDrops=0,gpsTrack=[],poseTrack=[],trackDrops=0,lastGpsSequence=null,lastNavSequence=null;
  let snapshot = { plan:null, count:0, dropped:0, recording:false, missionId:null, gpsTrack,poseTrack };
  const subscribers = new Set();
  const publish = () => {
    snapshot = {plan, count:records.length, dropped, recording, missionId,gpsTrack,poseTrack,trackDrops,archives:archives.length,archiveDrops};
    subscribers.forEach(fn => fn());
  };
  const add = (source, payload) => {
    if (!recording) return;
    if (records.length === limit) { dropped += 1; publish(); return; }
    const observedAt = clock();
    const append=(track,point)=>{if(track.length===2000){track=track.slice(1);trackDrops++;}return [...track,point];};
    if(source==='fusion-data' && payload.fusionSeq!==lastGpsSequence){
      const gps=gpsObservation(payload,payload.receivedAtMs??observedAt);
      if(compareWaypointGps(plan.legs[0].coordinates,gps,observedAt,3).result!=='GPS_UNVERIFIED'){
        gpsTrack=append(gpsTrack,{coordinates:gps.position,observedAt,sequence:payload.fusionSeq});lastGpsSequence=payload.fusionSeq;
      }
    }
    const nav=source==='rx-board-connection'?payload.navigation:null;
    const key=missionId===null?null:BigInt(missionId).toString(16).toUpperCase().padStart(16,'0');
    const navKey=nav?`${nav.bootId}:${nav.navSeq}`:null;
    if(nav?.poseValid&&nav.missionId===key&&navKey!==lastNavSequence){
      poseTrack=append(poseTrack,{coordinates:[nav.estimatedLat,nav.estimatedLng],observedAt,bootId:nav.bootId,sequence:nav.navSeq,uncertaintyM:nav.positionUncertaintyM});lastNavSequence=navKey;
    }
    const comparison = source === 'fusion-data' ? plan.legs.map(w => ({pin:w.pin,
      ...compareWaypointGps(w.coordinates, gpsObservation(payload, payload.receivedAtMs ?? observedAt), observedAt, 3)})) : undefined;
    const captured=source==='rx-board-connection'?{...payload,deployment:payload.deployment?{
      id:payload.deployment.id,phase:payload.deployment.phase,acknowledged:payload.deployment.acknowledged,
      mega_status:payload.deployment.mega_status,status_packets_missing:payload.deployment.status_packets_missing,
      status_history_dropped:payload.deployment.status_history_dropped,
    }:null}:payload;
    // Retain each current mission event, not thousands of repeated copies of
    // the entire cached history/evidence arrays in every radio snapshot.
    records.push({source, observedAt, payload:JSON.parse(JSON.stringify(captured)), comparison});
    publish();
  };
  return {
    getSnapshot:() => snapshot,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    async start(nextPlan) {
      if(plan){
        generation++;recording=false;stops.forEach(stop=>stop());stops=[];
        if(archives.length===5){archives.shift();archiveDrops++;}
        archives.push({plan,missionId,records,droppedRecords:dropped,gpsTrack,poseTrack,trackDrops});
      }
      const epoch = ++generation;
      plan = JSON.parse(JSON.stringify(nextPlan)); records = []; dropped = 0; recording = true; missionId = null;
      gpsTrack=[];poseTrack=[];trackDrops=0;lastGpsSequence=lastNavSequence=null;
      publish();
      // allSettled ensures a partial listener failure cannot leak subscriptions.
      const results = await Promise.allSettled(['sensor-data','encoder-data','fusion-data','rx-board-connection']
        .map(source => listen(source, event => add(source, event.payload))));
      const installed = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (epoch !== generation || !recording) {
        installed.forEach(stop => stop());
        throw new Error('Calibration recording was stopped before subscriptions completed. Reopen the deployment guide.');
      }
      if (results.some(r => r.status === 'rejected')) {
        installed.forEach(stop => stop()); recording = false; publish();
        throw new Error('Calibration recording could not subscribe to all telemetry sources. Clear the recording and retry.');
      }
      stops = installed;
    },
    bindDeployment(id) { missionId = id; publish(); },
    stop() { generation += 1; recording = false; stops.forEach(stop => stop()); stops = []; publish(); },
    clear() {
      if (recording) throw new Error('Stop recording before clearing.');
      generation += 1;
      plan = null; records = []; dropped = 0; missionId = null;gpsTrack=[];poseTrack=[];trackDrops=0;archives=[];archiveDrops=0;publish();
    },
    export() {
      return {schema:'eksplorador-feedback-navigation-v1', exportedAt:clock(), plan, missionId, recording,
        statusStepBase:1,stagingStep:0,statusStepMeaning:plan?.protocol==='N1'?'WAYPOINT_INDEX':'LEGACY_TOKEN_INDEX',gpsSource:'fusion',
        gpsTrack,poseTrack,trackDrops,archivedRuns:archives,droppedArchivedRuns:archiveDrops,
        comparisonRadiusM:3, droppedRecords:dropped,
        notes:'Comparison radius is illustrative, not calibrated accuracy. Raw observations may be stale, duplicated or missing. Only explicit matching Mega W verification establishes reported checkpoint arrival; encoder completion and ACK2 do not. Receipt time does not measure radio transit delay. Session-memory recording must be exported before closing the app.',
        records:JSON.parse(JSON.stringify(records))};
    },
  };
}
