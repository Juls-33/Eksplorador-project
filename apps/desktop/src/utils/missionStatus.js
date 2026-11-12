import {missionWaypointEvidence} from './waypointMission.js';

export function missionObservation(status) {
  if (!status) return null;
  const {state, reason} = status;
  if (['HOLD_OBSTACLE','OBSTACLE_HOLD'].includes(state) || (['HOLD','HELD','HOLD_SAFETY','PAUSED'].includes(state) && /OBSTACLE/.test(reason))) return 'obstacle';
  if (['WAIT_CALIBRATION','WAITING_CALIBRATION'].includes(state)
    || (['STAGED','HOLD','HELD'].includes(state) && /NOT_CALIBRATED|CALIBRATION_REQUIRED/.test(reason))) return 'calibration';
  if (state === 'STAGED' && ['WAIT_SEMIAUTO_EDGE','READY_RC_EDGE'].includes(reason)) return 'authorization';
  if (['WAIT_RC','WAIT_RC_AUTH','WAIT_AUTHORIZATION','WAIT_SEMI_AUTO','READY'].includes(state)) return 'authorization';
  if (['RUNNING','RUNNING_ENCODER','ENCODER_MOVEMENT','NAVIGATING'].includes(state)) return 'running';
  if (['STEP_COMPLETE','STEP_COMPLETED','ENCODER_TARGET_DONE','STEP_DONE'].includes(state)) return 'encoder';
  if (state === 'PIN_CHECKED') return reason === 'GPS_WITHIN_5M' ? 'gps' : 'unknown';
  if (['WAYPOINT_VERIFIED','GPS_WAYPOINT_VERIFIED','GPS_VERIFIED','CHECKPOINT_VERIFIED'].includes(state)) return 'gps';
  if (['COMPLETE','COMPLETED','ESTIMATED_COMPLETE'].includes(state)) return 'complete';
  if (['HOLD','HELD','PAUSED','HOLD_LOCALIZATION','HOLD_SAFETY','FAULT','ABORTED','CANCELLED','MANUAL_OVERRIDE','RC_DISCONNECTED','REJECTED'].includes(state)) return 'held';
  if (state === 'STAGED') return 'staged';
  return 'unknown';
}

export function describeMissionStatus(deployment) {
  const status = deployment?.mega_status;
  if (!status) return deployment?.acknowledged
    ? 'Rover acknowledged delivery to the UART queue. Waiting for Mega mission staging or rejection. GPS arrival is unverified.'
    : 'Waiting for a matching Mega mission report. Delivery and staging are unconfirmed.';
  const descriptions = {
    staged:'Mega staged mission. Await calibration and deliberate RC semi-auto authorization.',
    calibration:'Waiting for encoder/turn calibration. Mega staged or held the mission; movement is not authorized.',
    authorization:'Waiting for deliberate RC semi-auto authorization. RC must be authorized, then the operator must transition CH6 from HOLD into SEMI_AUTO.',
    running:'Mega reports running encoder-controlled movement. Planned distances are estimates; GPS waypoint arrival is unverified.',
    encoder:'Step completed based on encoder target. This is not proof of GPS waypoint arrival.',
    gps:'Mega reports GPS waypoint verified for this checkpoint step only. Other checkpoints remain unverified without their own reports.',
    complete:'Mega reports mission completed as an estimated route. Completion does not establish that every GPS waypoint was verified.',
    obstacle:'Obstacle hold: forward movement stopped. Operator intervention or a new mission is required. Clearing the obstacle does not automatically resume the mission; no avoidance was completed.',
    held:'Mission held, cancelled, or faulted. Use RC HOLD/DISARM and inspect the reason before operator recovery.',
    unknown:`Mega reports ${status.state}. This status has no verified desktop interpretation.`,
  };
  let message = descriptions[missionObservation(status)];
  if(status.state==='STAGED'&&['WAIT_GPS','WAIT_POSITION','WAIT_HEADING','WAIT_IMU'].includes(status.reason)) message=`Mega staged coordinate targets. Onboard movement readiness is waiting: ${status.reason}. Upload does not authorize motion.`;
  if(status.state==='VERIFYING')message='Rover stopped to verify this waypoint with independent fresh GPS observations. Arrival is not yet verified.';
  if(status.state==='COMPLETE'&&status.reason==='GPS_ROUTE_VERIFIED')message='Mega reports route completion after onboard GPS verification. Missing individual waypoint reports remain unverified in the desktop record.';
  if(status.reason==='STEERING_CORRECTION')message+=' Rover is applying bounded steering correction.';
  if(status.reason==='TURN_CORRECTION')message+=' Rover is executing a bounded heading correction.';
  if (missionObservation(status) === 'gps' && !checkpointReportMatches(deployment, status)) {
    message = 'Mega sent a GPS verification report, but its step does not match a known W token. Waypoint arrival remains unverified; inspect the report and firmware step numbering.';
  }
  if (status.state === 'HOLD_LOCALIZATION' || (status.state === 'HOLD' && ['GPS_NO_VALID_ARRIVAL','WAYPOINT_NOT_REACHED'].includes(status.reason))) message += ' GPS waypoint cannot be verified: localization hold. This firmware clears the mission on HOLD; operator intervention and a new staged mission are required. Uncalibrated dead reckoning cannot establish arrival.';
  if (status.state === 'HOLD' && status.reason === 'SONAR_UNKNOWN') message += ' Forward sonar is unavailable; this does not establish that the path is clear. Intervention and a new mission are required.';
  if (status.state === 'REJECTED') message += ' Mega rejected this mission.';
  if (/(^|_)(RC|MANUAL)(_|$)/.test(status.state + '_' + status.reason)) message += ' RC loss or manual takeover requires operator intervention; the desktop does not resume movement.';
  return `${message} Reason: ${status.reason}; step: ${status.step}.`;
}

const checkpointReportMatches = (deployment, status) => missionObservation(status) === 'gps'
  && status.step >= 1 && (deployment?.sequence?.startsWith('N1,')
    ? deployment.sequence.split(',').filter(t=>t.startsWith('W'))[status.step-1]
    : deployment?.sequence?.split(',')[status.step - 1]?.startsWith('W'));

// Mega increments a30CurrentStep BEFORE execution: tokens are 1..N; STAGED
// and RUNNING/OPERATOR_STARTED use 0. Never treat step 0 as a completed token.
export function missionStepEvidence(deployment) {
  const waypointRows=missionWaypointEvidence(deployment);if(waypointRows)return waypointRows;
  const reports = deployment?.status_history?.length ? deployment.status_history : deployment?.mega_status ? [deployment.mega_status] : [];
  let pin = 0;
  return (deployment?.sequence?.split(',') || []).map((token, index) => ({token, step:index + 1, pin:token[0] === 'W' ? ++pin : null,
    evidence:token[0] === 'W'
      ? reports.some(s => s.step === index + 1 && checkpointReportMatches(deployment, s)) ? 'GPS verification reported' : 'GPS arrival unverified'
      : reports.some(s => s.step === index + 1 && missionObservation(s) === 'encoder') ? 'Encoder target completion reported' : 'Movement completion unverified',
  }));
}

export function missionEvidence(deployment) {
  const reports = deployment?.status_history?.length ? deployment.status_history : deployment?.mega_status ? [deployment.mega_status] : [];
  const observed = kind => reports.some(s => missionObservation(s) === kind);
  return [
    ['Mission transmitted', deployment?.transmitted_attempts > 0 || deployment?.radio_transmitted ? 'Radio TX done observed' : 'Unconfirmed'],
    ['Rover acknowledged delivery', deployment?.acknowledged ? 'Matching ACK2 observed; UART queue only' : 'Unconfirmed'],
    ['Mega staged mission', reports.some(s => s.state === 'STAGED') ? 'Matching STAGED report observed' : 'Unconfirmed'],
    ['Waiting for encoder/turn calibration', observed('calibration') ? 'Reported by Mega' : 'Not observed'],
    ['Waiting for deliberate RC semi-auto authorization', observed('authorization') ? 'Reported by Mega' : 'Not observed'],
    ['Running encoder-controlled movement', observed('running') ? 'Reported by Mega' : 'Not observed'],
    ['Step completed based on encoder target', observed('encoder') ? 'Reported; GPS arrival remains separate' : 'Not observed'],
    ['GPS waypoint verified', reports.some(s => checkpointReportMatches(deployment, s)) ? 'Explicit checkpoint report observed; see step history' : 'Unverified'],
    ['Mission held, cancelled, or faulted', observed('held') || observed('obstacle') ? 'Reported; operator intervention required' : 'Not observed'],
    ['Mission completed as an estimated route', observed('complete') ? 'Reported; all arrivals are not implied' : 'Unconfirmed'],
  ];
}
