import React,{useEffect,useState} from 'react';
import {useLoRaConnection} from '../hooks/useLoRaConnection';
import {useMissionExperiment} from '../hooks/useMissionExperiment';

const fmt=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'Unavailable';
export function RouteTrack({waypoints=[],gpsTrack=[],poseTrack=[]}){
  const planned=waypoints.map(w=>w.coordinates||w),gps=gpsTrack.map(p=>p.coordinates),pose=poseTrack.map(p=>p.coordinates);
  const all=[...planned,...gps,...pose].filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));
  if(!all.length)return <p>No route or observed track yet.</p>;
  const origin=all[0],project=p=>[(p[1]-origin[1])*111195*Math.cos(origin[0]*Math.PI/180),(p[0]-origin[0])*111195];
  const projected=all.map(project),xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min(280/Math.max(2,maxX-minX),140/Math.max(2,maxY-minY));
  const xy=p=>{const [x,y]=project(p);return [20+(x-minX)*scale,160-(y-minY)*scale];};
  const points=track=>track.map(p=>xy(p).join(',')).join(' ');
  return <figure style={{margin:0}}><svg viewBox="0 0 320 180" role="img" aria-label="Expected waypoint route, observed GPS track and estimated pose track" style={{width:'100%',background:'#f8fafc',borderRadius:8}}>
    <polyline points={points(planned)} fill="none" stroke="#15803d" strokeDasharray="5 4" strokeWidth="2"/>
    <polyline points={points(pose)} fill="none" stroke="#c2410c" strokeWidth="2"/>
    <polyline points={points(gps)} fill="none" stroke="#0369a1" strokeWidth="2"/>
    {planned.map((p,i)=>{const [x,y]=xy(p);return <g key={i}><circle cx={x} cy={y} r="4" fill="#15803d"/><text x={x+6} y={y-4} fontSize="11">{i+1}</text></g>;})}
  </svg><figcaption>Dashed green: expected order · blue: observed GPS · orange: onboard estimate. Estimated uncertainty is a model limit, not validated GPS accuracy.</figcaption></figure>;
}
export default function NavigationFeedback({waypoints=[]}){
  const radio=useLoRaConnection(),run=useMissionExperiment(),[now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer);},[]);
  const n=radio.navigation;
  const fresh=radio.connected&&!radio.connectionError&&n&&now>=n.receivedAtMs&&now-n.receivedAtMs<=10000;
  const matching=n&&radio.deployment&&n.missionId===radio.deployment.mission_key?.slice(0,16);
  const target=(run.plan?.legs||waypoints.map((coordinates,index)=>({pin:index+1,coordinates})))[(n?.targetPin||1)-1];
  return <section className="card" style={{padding:16}} aria-label="Onboard waypoint navigation feedback">
    <h3>Rover navigation</h3>
    {!fresh?<p role="status">Waiting for fresh N1 navigation telemetry. Delivery can proceed; execution readiness and current movement are unverified.</p>:<>
      <p>Mission: {matching?(run.plan?.displayName||'Waypoint mission'):'Another mission report'}</p>
      <p role="status"><strong>{n.state}</strong> · {n.reason} · {matching?`Target pin ${n.targetPin||'—'}`:'Report belongs to another mission'}</p>
      <p>Measured calibration: {n.calibrated?'Valid stored profile':'Required'} · Heading: {n.headingValid?'Available':'Required'} · GPS: {n.gpsValid?'Fresh onboard observation':'Unavailable'} · {n.ready?'Ready for deliberate RC authorization':'Movement readiness not established'}</p>
      <dl style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <dt>GPS position</dt><dd>{n.gpsValid?`${fmt(n.gpsLat,6)}, ${fmt(n.gpsLng,6)}`:'Unverified'}</dd>
        <dt>Target coordinates</dt><dd>{matching&&target?target.coordinates.map(v=>fmt(v,6)).join(', '):'Unavailable'}</dd>
        <dt>Distance remaining</dt><dd>{matching&&n.poseValid?`${fmt(n.distanceRemainingM)} m`:'Unverified'}</dd>
        <dt>Position uncertainty</dt><dd>{n.poseValid?fmt(n.positionUncertaintyM):'Unverified'} m (estimate)</dd>
        <dt>Heading / confidence bound</dt><dd>{n.headingValid?`${fmt(n.headingDeg)}° ± ${fmt(n.headingUncertaintyDeg)}°`:'Unverified'}</dd>
        <dt>Encoder travel</dt><dd>{matching?fmt(n.encoderTravelM):'Unverified'} m</dd>
        <dt>Correction attempts</dt><dd>{matching?n.corrections:'Unverified'}</dd>
      </dl>
    </>}
    <RouteTrack waypoints={run.plan?.legs||waypoints} gpsTrack={run.gpsTrack||[]} poseTrack={run.poseTrack||[]}/>
    {run.dropped>0&&<p role="alert">The track recorder is full. Export the run in Developer Tools; some later observations were not recorded.</p>}
    <p>Use physical RC HOLD/DISARM for a stop. Holds never automatically resume. Automatic probe deployment is disabled.</p>
  </section>;
}
