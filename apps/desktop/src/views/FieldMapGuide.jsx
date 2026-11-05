import AnimatedDisclosure from '../components/ui/AnimatedDisclosure';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import overview from '../assets/user-manual/field-map/overview.png';
import directory from '../assets/user-manual/field-map/mission-directory.png';
import mapControls from '../assets/user-manual/field-map/map-controls.png';
import legend from '../assets/user-manual/field-map/layer-legend.png';
import handoff from '../assets/user-manual/field-map/mission-handoff.svg';
import movement from '../assets/user-manual/field-map/movement-sequence.svg';

const topics = [
  { id: 'fields', label: 'Fields and Missions', summary: 'Choose a saved mission or prepare a new one.' },
  { id: 'map', label: 'Find Your Way on the Map', summary: 'Pan, zoom, search and return to the rover marker.' },
  { id: 'pins', label: 'Plan Your Waypoints', summary: 'Place the route in order and check every pin.' },
  { id: 'sequence', label: 'Read the Movement Sequence', summary: 'Send coordinates and let the rover update movement targets.' },
  { id: 'send', label: 'Send a Mission', summary: 'Use the Mission Deployment Assistant to upload safely.' },
  { id: 'status', label: 'Communication and ACKs', summary: 'Know what each confirmation actually proves.' },
  { id: 'start', label: 'Restore Telemetry and Supervise the Test', summary: 'Verify staging and calibration, then deliberately authorize RC semi-auto.' },
  { id: 'samples', label: 'Heatmaps and Sample Records', summary: 'Read saved measurements and understand logging.' },
  { id: 'help', label: 'Troubleshooting', summary: 'Check common problems while keeping the rover stopped.' },
];

function Fields({ Steps, Notice, instructionalGuide }) {
  return <>
    <p>A <strong>field</strong> stores the boundary. A <strong>mission</strong> stores a visit’s pins and sample records.</p>
    <div style={{ width: '100%', maxWidth: 460 }}>{instructionalGuide(directory, 'Actual Mission Directory with the All fields filter and a selected saved mission', 'Actual app capture: filter by field, then click a mission card. “Active” is a saved mission status; it does not mean the rover is moving.')}</div>
    <section><h3>Open an existing mission</h3><Steps items={[
      <>Open <strong>Field Map</strong> from the sidebar.</>,
      <>Use the field filter in <strong>Mission Directory</strong>. Choose a field or <strong>All fields</strong>.</>,
      'Click the mission card. Check its name, field and date in Mission Overview.',
      <>For an active saved mission, use <strong>Start Logging</strong> when you intend to record new samples. Selecting a mission does not start logging.</>,
    ]} /></section>
    <section><h3>Add a field</h3><Steps items={[
      <>Click <strong>Add Field</strong>, enter a unique field name, then choose <strong>Next: Draw Field Boundary</strong>.</>,
      <>Click around the field edge in order. Add at least <strong>3 points</strong>. Use <strong>Undo Point</strong> to remove the last one.</>,
      <>Choose <strong>Save Field</strong> to keep the boundary, or <strong>Save &amp; Start Mission</strong> to continue to mission setup.</>,
    ]} /></section>
    <section><h3>Create a mission</h3><Steps items={[
      <>Click <strong>Start New Mission</strong>. Enter the <strong>Mission Name</strong>, choose the <strong>Field</strong> and review the <strong>Scheduled Date</strong>.</>,
      <>If earlier pins exist, choose <strong>Use the same … pins</strong>, <strong>Start from those pins and edit them</strong>, or <strong>Place new pins</strong>. The form may default to reusing earlier pins; check before continuing.</>,
      <>Continue with <strong>Next: Place Pins</strong>, or <strong>Next: Draw Field Boundary</strong> if the field has no boundary. Reusing unchanged pins can go straight to <strong>Launch Mission</strong>.</>,
    ]} /></section>
    <Notice title="Launch and send are separate"><p><strong>Launch Mission</strong> saves the mission and starts its logging state. It does not upload the route or start rover movement. The scheduled date does not automatically deploy a mission.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"Manage field names"}><p>Open Start New Mission → <strong>Manage Fields</strong>. Use the pencil to rename a field, then the check mark to save. A field with missions cannot be deleted. Cancel the form if you are only reviewing it.</p></AnimatedDisclosure>
  </>;
}

function MapNavigation({ Steps, Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(mapControls, 'Actual map toolbar with layer selection, zoom buttons, place search and downloaded-map selector', 'Actual app capture: these controls move the view or change the displayed layer. They do not drive the rover.')}
    <Steps items={[
      <>Drag the map to look around. Use <strong>+</strong>, <strong>−</strong>, or the mouse wheel to zoom.</>,
      <>To find a place, type at least <strong>3 characters</strong> in <strong>Search a place or landmark</strong>. Press <strong>Go</strong> or Enter, then select a result.</>,
      <>For saved map areas, use <strong>Jump to downloaded map…</strong> when the list is available.</>,
      <>Dragging, choosing a search result or jumping to an area turns off automatic following. Use <strong>Follow Rover</strong> to center on the rover marker again.</>,
    ]} />
    <Notice title="Check the source of the position" caution><p>A marker or IMU Yaw value alone does not prove that GPS or heading is live. Field Map can show an initial or last known position. Confirm fresh rover telemetry before relying on the route.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"Internet and offline maps"}><p>Place search needs internet. Saved tiles can display offline, but only for covered areas and zoom levels. Use <strong>Offline Maps</strong> to prepare coverage. The current map is limited to the supported region from Nueva Ecija to Batangas; it is not a worldwide search view.</p></AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"See the full Field Map screen"}>{instructionalGuide(overview, 'Actual Field Map showing the mission directory, saved boundary, numbered waypoints, legend and right-hand information cards', 'Real app capture with a saved mission and no connected receiver. Readings are blank. The marker, heading and calculated distances are not confirmation of a live rover position. Scroll the right column to see more cards.')}</AnimatedDisclosure>
  </>;
}

function Waypoints({ Steps, Notice }) {
  return <>
    <p>Waypoints are the numbered places you want the rover to visit. Place them in the order you want to travel.</p>
    <Steps items={[
      <>After mission setup, confirm the saved boundary or draw and choose <strong>Save Boundary &amp; Place Pins</strong>.</>,
      <>Click <strong>inside the field boundary</strong> to add each pin. The map links the pins in placement order.</>,
      <>Review the full route, including turns and obstacles. The boundary keeps pins inside the field; it does not check every route segment for hazards or keep a line inside an irregular boundary.</>,
      <>Use <strong>Undo Pin</strong> for the last pin. For a specific pin, choose <strong>Remove a Pin</strong>, click that pin, then choose <strong>Done Removing</strong> before adding more.</>,
      <>Use <strong>Clear Pins</strong> to restart the draft. At least one pin is needed to <strong>Launch Mission</strong>.</>,
    ]} />
    <div className="manual-control-pair"><div className="manual-inset"><h3>Brown numbered pins</h3><p>Planned waypoints. The dashed route connects them in order.</p></div><div className="manual-inset"><h3>Red × pins</h3><p>Removal mode is on. Click a pin to delete it from the draft.</p></div></div>
    <Notice title="Review before launch" caution><p><strong>Edit Field Boundary</strong> returns to boundary drawing. Confirming the changed boundary clears the draft pins. Saved missions are not edited by clicking their pins; create a new mission and choose to reuse or modify earlier pins.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"Cancel or change a draft"}><p><strong>Cancel</strong> exits the current drawing or pin-placement step. A boundary saved in an earlier step remains saved. After removing pins, check the new numbering and route before launching.</p></AnimatedDisclosure>
  </>;
}

function MovementSequence({Steps,Notice,instructionalGuide}){
 return <>
  {instructionalGuide(movement,'Waypoint targets sent to onboard pose estimation and bounded movement correction','N1 transmits coordinates. The rover calculates and updates its movement targets.')}
  <Steps items={[
   'Review every selected pin in order in Send Mission. Up to ten normal coordinates fit the existing 226-byte Mission V2 packet; oversized lists are rejected without omissions.',
   'The desktop sends N1 waypoint targets, not hundreds of precomputed F/L/R commands. Live GPS is not required for transmission.',
   'Use Rover navigation feedback to inspect target pin, GPS/estimated position, remaining distance, uncertainty, heading and correction actions.',
  ]}/>
  <Notice title="Arrival and sampling are separate"><p>PIN_CHECKED establishes reported GPS arrival for the matching waypoint. STEP_DONE only completes an onboard encoder movement segment. Guide marks and soil sample matching do not create navigation arrival evidence. Automatic probe deployment remains disabled.</p></Notice>
 </>;
}

function Sending({Steps,Notice,instructionalGuide}){
 return <>
  {instructionalGuide(handoff,'Review pins, send coordinates, verify delivery/staging and authorize movement separately','Upload and powered execution are separate operations.')}
  <Steps items={[
   'Keep the rover stopped: CH6 HOLD and CH5 DISARM. Set rover CH8 to RX for upload.',
   <>Review the ordered pins, then press <strong>Send Mission</strong>. No GPS, firmware-compatibility checkbox or calibration checkbox blocks coordinate delivery.</>,
   'The desktop prepares radio TX, sends Mission V2 with identity/CRC/retries, restores RX and waits for fresh feedback.',
   'After desktop RX is confirmed, set rover CH8 to TX. Read rover delivery and Mega staging separately.',
  ]}/>
  <Notice title="A sent packet cannot be recalled" caution><p>Closing cancels unsent upload work. It is not a rover stop command. Keep physical RC controls available and use HOLD/DISARM to stop movement.</p></Notice>
 </>;
}

const evidence = [
  ['Desktop LoRa connected', 'The desktop sees its receiver. This does not prove communication with the rover.'],
  ['Local packet: Submitted', 'The desktop submitted a command locally; rover receipt is not yet confirmed.'],
  ['Ground station: Accepted', 'The ground station accepted the command; this is still not a rover ACK.'],
  ['Current radio packet: Transmitted', 'The local radio reported transmission; it does not prove rover receipt.'],
  ['Rover acknowledged delivery', 'ACK2 confirms the matching mission ID and checksum were queued for UART delivery.'],
  ['Mega: STAGED or REJECTED', 'A separate matching Mega report confirms staging or rejection. STAGED does not mean execution.'],
  ['Upload recovery: Complete', 'RX and telemetry recovery finished. This does not mean the mission completed.'],
];

function Communication({ Steps, Notice }) {
  return <>
    <Steps items={[
      <>Read the receiver card first. <strong>Searching for desktop LoRa…</strong> is a waiting state. <strong>Desktop LoRa disconnected</strong> means a previously seen receiver is unavailable.</>,
      <>In the assistant, follow <strong>Transmitting mission</strong>, <strong>Waiting for rover acknowledgment</strong> and any retry messages. Attempt counts come from the current deployment.</>,
      <>Check <strong>Mission communication evidence</strong> and <strong>Communication details</strong>. Read the exact error if a step fails.</>,
    ]} />
    <div className="manual-table-wrap" role="region" aria-label="Meaning of mission communication evidence" tabIndex={0}><table className="manual-table"><caption>What the assistant’s labels mean</caption><thead><tr><th scope="col">Label</th><th scope="col">What it confirms</th></tr></thead><tbody>{evidence.map(([label, meaning]) => <tr key={label}><th scope="row">{label}</th><td>{meaning}</td></tr>)}</tbody></table></div>
    <Notice title="Rover-radio ACK is not Mega storage confirmation" caution><p>A matching ACK confirms radio receipt of this payload. It does not independently confirm Mega storage, mission execution or waypoint arrival. The labels above are explanations, not current hardware statuses.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"When an upload fails"}><p>Keep <strong>HOLD and DISARM</strong>. An upload without a confirmed ACK may still have reached the rover. If Retry upload is offered, check the physical setup first. The retry retains the same mission ID. Retry can remain unavailable until the desktop is connected and back in RX, or when a rejection needs operator recovery.</p></AnimatedDisclosure>
  </>;
}

function RestoreAndStart({Steps,Notice}){
 return <>
  <Steps items={[
   'After desktop RX recovery, switch rover CH8 to TX and wait for fresh N1 navigation telemetry.',
   'Inspect actual firmware versions, stored calibration and readiness in Developer Tools. The main view shows the current navigation gate without manual compatibility assertions.',
   'Establish the initial true-north heading through Developer Tools before upload, or through the disarmed Mega USB console after staging. A valid GPS fix and usable heading are required before motion, not before sending.',
   'Once ready, inspect the area, authorize RC and deliberately transition HOLD to SEMI_AUTO.',
   'Observe bounded encoder movements, steering/turn corrections, GPS waypoint verification and any uncertainty, obstacle or fault hold.',
  ]}/>
  <Notice title="Bounded navigation, supervised testing" caution><p>The actual estimator/controller runs onboard. Its uncertainty model and policy limits still need physical validation. Temporary GPS loss permits limited calibrated encoder/gyro dead reckoning; an unverified arrival never advances the waypoint. Obstacle holds never perform blind detours or resume automatically.</p></Notice>
  <p>Use physical RC HOLD/DISARM to stop. Soil logging controls and closing pages do not stop the rover. Export current and archived run data in Developer Tools.</p>
 </>;
}

function Heatmaps({ Steps, Notice, instructionalGuide }) {
  return <>
    <p>The heatmap uses recorded samples from the selected mission. It estimates colors between measurements; it does not measure every spot in the field.</p>
    <div style={{ width: '100%', maxWidth: 460 }}>{instructionalGuide(legend, 'Actual Overall Soil Health legend showing the app’s five color bands and score labels', 'Actual legend from the current app. This lists display bands, not measured readings. Each selected layer has its own legend.')}</div>
    <Steps items={[
      'Select the mission you want to review in Mission Directory.',
      <>Choose <strong>Overall Soil Health</strong>, <strong>Soil Moisture</strong>, <strong>Soil pH</strong> or <strong>NPK Ratio</strong> from the layer menu. Read that layer’s legend; the same color does not mean the same thing in every layer.</>,
      <>Scroll the right column to <strong>Mission Samples</strong>. Review the recorded rows. Use <strong>Show pins</strong> to show saved sampling locations, or <strong>Hide pins</strong> to hide them.</>,
      'Match the green sample number on the map to the same row number. These sample numbers follow recording order; they are separate from the brown planned waypoint numbers.',
    ]} />
    <section className="manual-inset"><h3>Record new samples</h3><Steps items={[
      <>Use an <strong>Active</strong> mission and turn logging on. A newly launched mission starts logging; a selected saved active mission needs <strong>Start Logging</strong>. Use <strong>Resume</strong> after Pause Logging.</>,
      'Recording needs valid GPS coordinates, a probe-engaged report and a location inside the saved boundary. One insertion produces one saved sample after a successful save.',
      'Lift the probe before the next insertion. A sample does not have to be near a waypoint to be recorded inside the field.',
    ]} /></section>
    <Notice title="Read the saved values too"><p>No colored area can mean no suitable samples or no value for that layer. Overall Soil Health and NPK Ratio are summaries calculated by the app. Heatmap colors are estimates, not proof of soil-test accuracy or a crop recommendation.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"Finish, resume and compare"}><p><strong>Mark Finished</strong> updates the saved mission status and ends its logging state. <strong>Resume Mission</strong> reopens a finished mission for logging; it does not resume rover motion or resend the route. <strong>Change Since Earlier Mission</strong> compares available earlier records on the same field. Samples remain saved when you switch missions; select the intended mission before starting logging again.</p></AnimatedDisclosure>
  </>;
}

const problems = [
  ['I cannot continue mission setup', 'Enter a mission name and choose a field. A boundary needs at least 3 points; a mission needs at least 1 pin. Read any database-save error before continuing.'],
  ['A pin is rejected or clicking removes pins', 'Place pins inside the boundary. If removal mode is on, choose Done Removing before adding pins. Boundary drawing and pin placement are separate steps.'],
  ['The map is blank or the place is not found', 'Check internet for search, enter at least 3 characters and press Go. Offline maps need saved coverage at the current zoom. The supported map region is Nueva Ecija to Batangas.'],
  ['The map keeps returning to the marker', 'Drag the map to stop following. Selecting a search result or a downloaded area also stops following. Use Follow Rover only when you want to center on the marker.'],
  ['Send Mission is unavailable', 'Select valid ordered pins within 226 bytes and ten waypoints. GPS and calibration do not gate upload. Check the receiver for delivery and onboard readiness for movement.'],
  ['The assistant is waiting or no ACK arrives', 'Keep HOLD and DISARM. Check the desktop receiver USB/COM connection, rover power and SD in rover RX. Read retry/error details. No ACK does not prove the rover received nothing.'],
  ['RX recovery fails or telemetry does not return', 'Keep HOLD and DISARM. Follow the assistant’s recovery message. Only after desktop RX is confirmed, return SD to rover TX and wait for fresh telemetry. Do not start on an old marker or reading.'],
  ['The rover rejects the mission or requests a protocol update', 'Do not arm or bypass the error. Keep HOLD and DISARM, note the exact message and ask the project team to check compatibility.'],
  ['There are no new samples or heatmap colors', 'Check the selected mission, Active status, logging state, fresh GPS, probe report and saved boundary. Check database errors. Lift the probe before another insertion. Choose a layer with recorded values.'],
  ['A pin says reached, but there is no matching sample', 'Reached can be marked by hand and does not create a record. Review Mission Samples separately. The progress matching radius does not certify GPS accuracy or physical arrival.'],
];

function Troubleshooting({ Notice }) {
  return <>
    <Notice title="Stop and check safely" caution><p>Use HOLD or DISARM and verify that the rover has stopped before checking a problem. Do not bypass protections or assume a successful upload means safe navigation.</p></Notice>
    <div className="manual-troubleshooting">{problems.map(([problem, solution]) => <AnimatedDisclosure className="manual-details" key={problem} title={problem}><p>{solution}</p></AnimatedDisclosure>)}</div>
    <p className="manual-muted">This guide follows the current desktop code. Physical radio delivery, Mega storage and outdoor waypoint performance must be checked on the actual system. No precise GPS arrival is promised.</p>
  </>;
}

const content = [Fields, MapNavigation, Waypoints, MovementSequence, Sending, Communication, RestoreAndStart, Heatmaps, Troubleshooting];

export default function FieldMapGuide({ Steps, Notice, instructionalGuide }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const headingRef = useRef(null);
  const topic = topics[topicIndex];
  const Content = content[topicIndex];
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [topicIndex]);

  return <div className="manual-layout field-map-manual">
    <nav className="manual-topic-nav" aria-label="Field Map guide topics">
      <p className="manual-eyebrow">FIELD MAP GUIDE</p>
      <label className="manual-topic-select">Field Map topic<select value={topicIndex} aria-controls="field-manual-topic" onChange={event => setTopicIndex(Number(event.target.value))}>{topics.map((item, index) => <option key={item.id} value={index}>{String.fromCharCode(65 + index)}. {item.label}</option>)}</select></label>
      {topics.map((item, index) => <button type="button" key={item.id} aria-current={index === topicIndex ? 'step' : undefined} aria-controls="field-manual-topic" onClick={() => setTopicIndex(index)}><span className="manual-topic-letter">{String.fromCharCode(65 + index)}</span><span>{item.label}</span>{index === topicIndex && <ChevronRight size={16} aria-hidden="true" />}</button>)}
      <div className="manual-topic-note"><ShieldCheck size={18} aria-hidden="true" /><span>Plan → review → upload → restore telemetry → verify staging.</span></div>
    </nav>
    <article className="manual-article" id="field-manual-topic" aria-labelledby="field-manual-heading">
      <header className="manual-article-header"><p className="manual-eyebrow">FIELD MAP · {String(topicIndex + 1).padStart(2, '0')} / 09</p><h2 id="field-manual-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
      <div className="manual-topic-content" key={topic.id}><Content Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} /></div>
      <footer className="manual-page-nav" aria-label="Read next or previous Field Map topic"><button type="button" disabled={topicIndex === 0} onClick={() => setTopicIndex(index => index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{topicIndex < topics.length - 1 ? <button type="button" onClick={() => setTopicIndex(index => index + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => setTopicIndex(0)}>Back to Fields and Missions<ChevronRight size={16} aria-hidden="true" /></button>}</footer>
    </article>
  </div>;
}
