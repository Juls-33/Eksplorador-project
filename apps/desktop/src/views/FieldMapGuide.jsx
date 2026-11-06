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
  { id: 'sequence', label: 'Read the Movement Sequence', summary: 'Understand the route before sending it.' },
  { id: 'send', label: 'Send a Mission', summary: 'Use the Mission Deployment Assistant to upload safely.' },
  { id: 'status', label: 'Communication and ACKs', summary: 'Know what each confirmation actually proves.' },
  { id: 'start', label: 'Restore Telemetry and Start', summary: 'Wait for fresh data before selecting SEMI_AUTO.' },
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

function MovementSequence({ Steps, Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(movement, 'Schematic showing position and heading leading to pin 1, then pin 2, with L and R turns and F forward commands', 'Process illustration, not a screenshot or measured route. It explains the actual sequence generator without example performance figures.')}
    <Steps items={[
      <>Find the <strong>Operator RC Movement Guide</strong> in the right column. Scroll that column if needed.</>,
      'Review the current target pin, estimated distance, heading and turn instruction. Confirm that the position and heading used by the app are current.',
      <>Read <strong>Generated Movement Sequence</strong>. <strong>L</strong> means turn left, <strong>R</strong> means turn right (degrees), and <strong>F</strong> means forward (meters).</>,
      <>Check the full sequence before <strong>Send Mission</strong>. The first leg uses the app’s current rover position and heading; later legs follow the saved pin order. Position or heading updates can change the preview.</>,
    ]} />
    <Notice title="Planned movement is not confirmed arrival" caution><p>Outdoor navigation and heading calibration are still needed. Map distances, turn instructions and <strong>IN RANGE</strong> indicators do not guarantee actual arrival or safe movement.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"What does Reached do?"}><p><strong>Reached</strong> advances the guide’s target by hand. It does not drive the rover, upload a changed route or save a soil sample. The app can also mark a pin reached when a recorded sample is within its configured 5 m matching radius. That is a progress rule, not a GPS accuracy claim.</p><p>The generated upload still uses the full pin list, including pins already marked reached. Recheck the whole payload before sending again.</p></AnimatedDisclosure>
  </>;
}

function Sending({ Steps, Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(handoff, 'Mission deployment process diagram separating saving the plan, preparing HOLD DISARM and rover RX, matching the radio ACK and restoring telemetry', 'Process diagram based on the current Mission Deployment Assistant. It does not show a live connection, acknowledgment or successful mission.')}
    <Steps items={[
      <>Review the saved mission and movement sequence. Click <strong>Send Mission</strong> in the Operator RC Movement Guide.</>,
      <>Follow the <strong>Mission Deployment Assistant</strong>. If it is waiting for the desktop receiver, check the USB/COM connection.</>,
      <>Set <strong>SB MIDDLE → HOLD</strong> and confirm the motors have stopped. Set <strong>SA UP → DISARM</strong>.</>,
      <>Set <strong>SD → rover RX</strong> (configured green indicator ON), so the rover can receive the mission.</>,
      <>The assistant prepares <strong>desktop LoRa TX</strong> automatically. Check all three operator confirmations, then press <strong>Confirm rover ready · Send mission</strong> when available.</>,
      <>Keep <strong>HOLD, DISARM and rover RX</strong> during transmission and automatic retries. Wait for the matching rover-radio ACK and desktop RX restoration.</>,
    ]} />
    <Notice title="The checklist is your confirmation" caution><p>The app does not electronically verify controller switch positions. Check the physical rover and surroundings. Opening the assistant alone does not mean the mission has been delivered.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"Cancel or close the assistant"}><p>Cancel stops unsent work and asks the desktop to restore RX. Wait for recovery to finish or report a failure. A radio packet already sent cannot be recalled. Keep HOLD and DISARM selected.</p></AnimatedDisclosure>
  </>;
}

const evidence = [
  ['Desktop LoRa connected', 'The desktop sees its receiver. This does not prove communication with the rover.'],
  ['Local packet: Submitted', 'The desktop submitted a command locally; rover receipt is not yet confirmed.'],
  ['Ground station: Accepted', 'The ground station accepted the command; this is still not a rover ACK.'],
  ['Current radio packet: Transmitted', 'The local radio reported transmission; it does not prove rover receipt.'],
  ['Rover radio ACK confirmed', 'The rover ESP32 acknowledged the matching mission ID and payload checksum.'],
  ['Mega storage: Unverified', 'The desktop has no independent confirmation that the Mega stored the mission.'],
  ['Mission execution: Not verified by desktop', 'Radio delivery is not proof that the rover executed the route.'],
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
    <AnimatedDisclosure className="manual-details" title={"When an upload fails"}><p>Keep <strong>HOLD and DISARM</strong>. An upload without a confirmed ACK may still have reached the rover. If <strong>Retry Mission — reconfirm safety</strong> is offered, check the physical setup and repeat the checklist. The retry retains the same mission ID. Retry can remain unavailable until the desktop is connected and back in RX, or when a rejection needs operator recovery.</p></AnimatedDisclosure>
  </>;
}

function RestoreAndStart({ Steps, Notice }) {
  return <>
    <div className="manual-control-pair"><div className="manual-inset"><h3>During upload</h3><p>SB: HOLD · SA: DISARM</p><p>Rover SD: RX · desktop: TX</p></div><div className="manual-inset"><h3>After desktop RX returns</h3><p>SB: HOLD · SA: DISARM</p><p>Rover SD: TX · desktop: RX</p></div></div>
    <Steps items={[
      <>Wait until the assistant confirms <strong>desktop RX</strong> and shows <strong>Restore telemetry and start when safe</strong>.</>,
      <>Set <strong>SD → rover TX</strong> (configured green indicator OFF). The desktop changes its own radio; it does not change this rover switch.</>,
      <>Keep <strong>SB in HOLD</strong> and <strong>SA DISARMED</strong> until the assistant receives a fresh rover telemetry packet after desktop RX restoration.</>,
      <>Review the restored data and check the actual surroundings. If the rover is ready and it is safe to proceed, set <strong>SA DOWN → ARM</strong> while SB stays in HOLD.</>,
      <>Deliberately set <strong>SB DOWN → SEMI_AUTO</strong>. Watch the rover and be ready to return to <strong>HOLD or DISARM</strong>.</>,
    ]} />
    <Notice title="Logging controls do not stop the rover" caution><p><strong>Pause Logging</strong>, <strong>Mark Finished</strong> and closing a desktop page are not rover stop commands. Use the physical controller’s HOLD or DISARM and check that movement has stopped. Telemetry restoration alone does not verify calibration or safe execution.</p></Notice>
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
  ['Send Mission is unavailable', 'Review the selected mission’s pins and Generated Movement Sequence. A route with no generated movement cannot be sent. Wait if an assistant is already open.'],
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
      <div className="manual-topic-note"><ShieldCheck size={18} aria-hidden="true" /><span>Plan → review → upload → restore telemetry → start safely.</span></div>
    </nav>
    <article className="manual-article" id="field-manual-topic" aria-labelledby="field-manual-heading">
      <header className="manual-article-header"><p className="manual-eyebrow">FIELD MAP · {String(topicIndex + 1).padStart(2, '0')} / 09</p><h2 id="field-manual-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
      <div className="manual-topic-content" key={topic.id}><Content Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} /></div>
      <footer className="manual-page-nav" aria-label="Read next or previous Field Map topic"><button type="button" disabled={topicIndex === 0} onClick={() => setTopicIndex(index => index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{topicIndex < topics.length - 1 ? <button type="button" onClick={() => setTopicIndex(index => index + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => setTopicIndex(0)}>Back to Fields and Missions<ChevronRight size={16} aria-hidden="true" /></button>}</footer>
    </article>
  </div>;
}
