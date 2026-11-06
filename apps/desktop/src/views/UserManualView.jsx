import AnimatedDisclosure from '../components/ui/AnimatedDisclosure';
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Battery,
  BookOpen, ChevronLeft, ChevronRight, ClipboardCheck, Download, Gamepad2,
  Map as MapIcon, Maximize2, Radio, ShieldCheck, Sprout, FileText, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import controller from '../assets/user-manual/controller-front.png';
import controllerDiagram from '../assets/user-manual/controller-labeled-diagram.png';
import shoulderSwitches from '../assets/user-manual/controller-shoulder-switches.png';
import controllerGuide from '../assets/user-manual/guide-controller.png';
import roverSide from '../assets/user-manual/rover-side-view.jpg';
import actuator from '../assets/user-manual/actuator-closeup.jpg';
import actuatorGuide from '../assets/user-manual/guide-actuator.png';
import powerGuide from '../assets/user-manual/guide-power-access.png';
import batteryGuide from '../assets/user-manual/guide-battery.png';
import xt90 from '../assets/user-manual/xt90-rover-connection.jpg';
import batteryCover from '../assets/user-manual/rover-battery-cover.jpg';
import balanceLead from '../assets/user-manual/lipo-balance-connector.png';
import batteryChecker from '../assets/user-manual/lipo-battery-checker.png';
import charger from '../assets/user-manual/imax-b6-charger.png';
import chargerCables from '../assets/user-manual/imax-b6-charger-cables.png';
import './UserManualView.css';
import FieldMapGuide from './FieldMapGuide';
import LiveMonitoringGuide from './LiveMonitoringGuide';
import CropAssessmentGuide from './CropAssessmentGuide';
import ReportsGuide from './ReportsGuide';
import OfflineMapGuide from './OfflineMapGuide';
import { MANUAL_GUIDES, resolveGuideId } from '../config/helpRoutes.js';

const guideIcons = { rover: Gamepad2, field: MapIcon, monitoring: Radio, crops: Sprout, reports: FileText, offline: Download };
const guides = MANUAL_GUIDES.map(guide => ({ ...guide, icon: guideIcons[guide.id] }));

const topics = [
  { id: 'start', label: 'Getting Started', summary: 'Prepare for your first operation.' },
  { id: 'controller', label: 'Controller Overview', summary: 'Know the switches, sticks and menu buttons.' },
  { id: 'manual', label: 'Manual Operation', summary: 'Drive and steer with the controller.' },
  { id: 'mission', label: 'Automatic Mission Operation', summary: 'Send a mission, restore telemetry and start safely.' },
  { id: 'actuator', label: 'Actuator Control', summary: 'Lower and raise the soil probe.' },
  { id: 'power', label: 'Battery and Power', summary: 'Connect, disconnect and remove the battery.' },
  { id: 'charging', label: 'Charging and Battery Safety', summary: 'Check the cells and review the charging setup.' },
  { id: 'safety', label: 'Troubleshooting and Safety Reminders', summary: 'Check common problems without bypassing protection.' },
];

function Notice({ title, children, caution = false }) {
  const Icon = caution ? AlertTriangle : ShieldCheck;
  return (
    <aside className={`manual-notice${caution ? ' manual-notice--caution' : ''}`}>
      <Icon size={20} aria-hidden="true" />
      <div><strong>{title}</strong><div>{children}</div></div>
    </aside>
  );
}

function Steps({ items, start = 1 }) {
  return <ol className="manual-steps" start={start}>{items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
}

function Photo({ src, alt, caption, onEnlarge, instructional = false }) {
  return (
    <figure className={`manual-photo${instructional ? ' manual-instructional-guide' : ''}`}>
      <button type="button" onClick={() => onEnlarge({ src, alt, caption })} aria-label={`Enlarge image: ${alt}`}>
        <img src={src} alt={alt} loading={instructional ? 'eager' : 'lazy'} decoding="async" />
        <span className="manual-photo-zoom" aria-hidden="true"><Maximize2 size={14} /> View larger</span>
      </button>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function InstructionalGuide(props) {
  return <Photo {...props} instructional />;
}

function GettingStarted({ photo }) {
  return (
    <>
      <div className="manual-columns">
        <div className="manual-stack">
          <p>Operate the rover with the controller, or run a semi-automatic mission sent from <strong>Field Map</strong>.</p>
          <div className="manual-inset">
            <h3><ClipboardCheck size={18} aria-hidden="true" /> Before each use</h3>
            <ul className="manual-checklist">
              <li>Check battery condition.</li>
              <li>Place the rover in a safe, open area.</li>
              <li>Ensure the actuator and soil probe are clear.</li>
              <li>Prepare the RadioMaster Pocket controller.</li>
              <li>Keep the rover disarmed until ready.</li>
            </ul>
          </div>
        </div>
        {photo(roverSide, 'Side view of the rover with its gray top cover and vertical soil-probe actuator', 'Meet the rover: the actuator sits beside the gray top cover.')}
      </div>
      <Notice title="Check the rover in person">
        <p>A switch position or green indicator alone does not mean the rover is safe. Check the surroundings and actual rover response before moving.</p>
      </Notice>
    </>
  );
}

const menuButtons = [
  ['SYS', 'Open system settings (usually the Tools page from the main screen).'],
  ['MDL', 'Open model settings / selection.'],
  ['RTN', 'Go back or cancel.'],
  ['PAGE>', 'Next page.'],
  ['PAGE<', 'Previous page.'],
  ['TELE', 'Open configured telemetry screens.'],
  ['Scroll wheel', 'Navigate menu items and change values.'],
  ['Press scroll wheel', 'Select or confirm.'],
  ['Power button', 'Turn the controller on or off using its normal startup / shutdown procedure.'],
];

function ControllerOverview({ photo, instructionalGuide }) {
  return (
    <>
      <p><strong>RadioMaster Pocket Hall Gimbal</strong>, running EdgeTX.</p>
      {instructionalGuide(controllerGuide,
        'Illustrated RadioMaster Pocket guide showing SA CH5 arm and disarm, SB CH6 modes, SD CH8 LoRa RX and TX, both sticks and menu buttons',
        'Controller basics: use the switch and stick assignments in the table below.')}
      <Notice title="Eksplorador custom assignments">
        <p>These switch assignments belong to our rover configuration. They are not universal RadioMaster defaults.</p>
      </Notice>
      <div className="manual-table-wrap" role="region" aria-label="Custom controller assignments" tabIndex={0}>
        <table className="manual-table">
          <caption>Rover controls at a glance</caption>
          <thead><tr><th scope="col">Control</th><th scope="col">Our configuration</th></tr></thead>
          <tbody>
            <tr><th scope="row">SA · CH5</th><td>Press <strong>DOWN → ARMED</strong>. Move <strong>UP → DISARMED</strong>. The configured green indicator corresponds to armed.</td></tr>
            <tr><th scope="row">SB · CH6</th><td><strong>UP → MANUAL</strong> · <strong>MIDDLE → HOLD</strong> · <strong>DOWN → SEMI_AUTO</strong>.</td></tr>
            <tr><th scope="row">SD · CH8</th><td>Green indicator <strong>ON → Rover LoRa RX</strong>. Green indicator <strong>OFF → Rover LoRa TX</strong>.</td></tr>
            <tr><th scope="row">Right stick</th><td>Forward / backward: drive. Left / right: steer.</td></tr>
            <tr><th scope="row">Left stick</th><td><strong>RIGHT → extend DOWN</strong>. <strong>LEFT → retract UP</strong>. Neutral stops the actuator. Forward / backward is unused.</td></tr>
          </tbody>
        </table>
      </div>
      <p className="manual-muted">SC and unrelated controls are not assigned to rover operation.</p>
      <AnimatedDisclosure className="manual-details" title={"Controller Menu Buttons"}>
        <p>These buttons navigate the controller’s own menus. Use the sticks and assigned switches to operate the rover.</p>
        <dl className="manual-button-list">{menuButtons.map(([button, action]) => <div key={button}><dt>{button}</dt><dd>{action}</dd></div>)}</dl>
        <p className="manual-muted">Short / long presses and destinations can differ by firmware version and current screen. Follow the manual for the installed EdgeTX version.</p>
        <p className="manual-source">Reference: <a href="https://manual.edgetx.org/v2.11/bw-radios/user-inteface" target="_blank" rel="noreferrer">Official EdgeTX menu guide (v2.11, online)</a>.</p>
      </AnimatedDisclosure>
      <AnimatedDisclosure className="manual-details" title={"View actual hardware photos"}>
        <div className="manual-photos">
          {photo(controller, 'Front photo of the RadioMaster Pocket controller, showing both sticks, screen and menu buttons', 'Controller reference photo. The pictured light is not a live rover status.')}
          {photo(controllerDiagram, 'Manufacturer diagram labeling SA, SB, SC, SD, left and right gimbals, menu buttons and ports', 'Manufacturer diagram: locate the controls, then use the custom assignments in this topic.')}
          {photo(shoulderSwitches, 'Close-up reference photo of the RadioMaster Pocket shoulder controls', 'Find the printed switch names on your controller; use the custom mapping table.')}
        </div>
      </AnimatedDisclosure>
    </>
  );
}

function ManualOperation() {
  return (
    <>
      <Notice title="Before connecting power" caution>
        <p>Keep <strong>SA UP / DISARMED</strong> until ready. Keep hands clear of the wheels, actuator and probe.</p>
      </Notice>
      <Steps items={[
        'Check the battery and power on the controller.',
        <>Place <strong>SB UP → MANUAL</strong>.</>,
        <>Connect the rover battery through <strong>XT90</strong>. See Battery and Power for cover access.</>,
        'Make sure the rover is ready and the area is clear.',
        <>Set <strong>SA DOWN → ARM</strong> only when ready.</>,
        <>Use the <strong>right stick</strong> to drive and steer.</>,
        <>Use the <strong>left stick horizontally</strong> to operate the actuator when safe.</>,
        <>Use <strong>SB MIDDLE → HOLD</strong> or <strong>SA UP → DISARM</strong> to stop operation. Check that movement has stopped.</>,
        <><strong>Disconnect XT90 after use.</strong></>,
      ]} />
      <div className="manual-control-pair">
        <div className="manual-inset"><h3>Right stick · movement</h3><p>Forward / backward → Drive</p><p>Left / right → Steer</p></div>
        <div className="manual-inset"><h3>Left stick · actuator</h3><p>Right → Extend down</p><p>Left → Retract up</p><p>Neutral → Stop</p></div>
      </div>
    </>
  );
}

function MissionOperation() {
  return (
    <>
      <h3>Semi-Automatic Mission Operation</h3>
      <p>Follow this deployment sequence. Keep the rover stopped and disarmed while the mission is being sent.</p>
      <div className="manual-flow" aria-label="Mission deployment sequence">
        <span>Plan</span><ArrowRight aria-hidden="true" size={16} /><span>Prepare rover</span><ArrowRight aria-hidden="true" size={16} /><span>Send &amp; confirm</span><ArrowRight aria-hidden="true" size={16} /><span>Restore &amp; start</span>
      </div>
      <div className="manual-phase-grid">
        <section className="manual-inset"><h3>1. Plan in the desktop app</h3><Steps items={[
          <>Open <strong>Field Map</strong>.</>,
          'Create or select a mission.',
          'Review the generated waypoints and movement sequence.',
          <>Press <strong>Send Mission</strong>.</>,
          <>Follow the <strong>Mission Deployment Assistant</strong>.</>,
        ]} /></section>
        <section className="manual-inset"><h3>2. Prepare the controller</h3><Steps start={6} items={[
          <>Set <strong>SB MIDDLE → HOLD</strong>.</>,
          <>Set <strong>SA UP → DISARM</strong>.</>,
          <>Set <strong>SD → rover RX</strong> (green indicator ON).</>,
          'Confirm the safety checklist in the assistant.',
        ]} /></section>
        <section className="manual-inset"><h3>3. Let the desktop send</h3><Steps start={10} items={[
          <>The desktop automatically switches <strong>its LoRa to TX</strong> and transmits the mission.</>,
          <>Wait for a <strong>verified matching rover-radio acknowledgment (ACK)</strong>.</>,
          <>The desktop returns to <strong>RX automatically</strong>.</>,
        ]} /></section>
        <section className="manual-inset"><h3>4. Restore telemetry, then start</h3><Steps start={13} items={[
          <>Set the rover <strong>SD → TX</strong> (green indicator OFF).</>,
          <>Wait for <strong>live rover telemetry</strong>.</>,
          <>Once the system is ready and the surroundings are safe, set <strong>SA to ARM</strong> while SB stays in HOLD. Then set <strong>SB DOWN → SEMI_AUTO</strong>.</>,
          <>Monitor movement. Be ready to switch back to <strong>HOLD or DISARM</strong>.</>,
        ]} /></section>
      </div>
      <Notice title="Radio ACK ≠ Mega storage confirmation" caution>
        <p>A matching ACK confirms that the rover radio received this mission ID and payload checksum. It does not independently confirm that the Arduino Mega stored or executed the mission.</p>
      </Notice>
      <p className="manual-muted">Navigation still needs outdoor calibration. Waypoint precision is not yet confirmed. If upload or telemetry fails, keep HOLD and DISARM selected and follow the assistant’s retry guidance.</p>
    </>
  );
}

function ActuatorControl({ photo, instructionalGuide }) {
  return (
    <>
      {instructionalGuide(actuatorGuide, 'Actuator guide showing the left gimbal moved right to extend down and moved left to retract up', 'Left gimbal, horizontal motion only. Return to neutral to stop.')}
      <div className="manual-actuator-controls">
        <div className="manual-inset"><ArrowRight aria-hidden="true" /><strong>Left stick RIGHT</strong><span><ArrowDown size={16} aria-hidden="true" /> Extend actuator DOWN</span></div>
        <div className="manual-inset"><ArrowLeft aria-hidden="true" /><strong>Left stick LEFT</strong><span><ArrowUp size={16} aria-hidden="true" /> Retract actuator UP</span></div>
        <div className="manual-inset"><span className="manual-neutral" aria-hidden="true">●</span><strong>Return to NEUTRAL</strong><span>Stop actuator movement</span></div>
      </div>
      <p>Left stick vertical movement is unused.</p>
      <AnimatedDisclosure className="manual-details" title={"View actual hardware photos"}>
        <div className="manual-photos">
          {photo(actuator, 'Close-up of the vertical actuator and lower mounting joint beside the rover body', 'Actuator close-up. Keep the probe’s path clear before moving it.')}
          {photo(roverSide, 'Side view showing where the vertical actuator is mounted on the rover', 'Actuator location on the rover.')}
        </div>
      </AnimatedDisclosure>
      <Notice title="Keep hands clear" caution><p>Keep hands away from the probe and actuator. Never force the actuator against an obstruction or bypass a safety condition.</p></Notice>
    </>
  );
}

function BatteryPower({ photo, instructionalGuide }) {
  return (
    <>
      <div className="manual-specs" aria-label="Rover battery specifications"><span><Battery size={18} aria-hidden="true" /> <strong>4S LiPo</strong></span><span>14.8V nominal</span><span>6000mAh</span><span>XT90 connector</span></div>
      {instructionalGuide(powerGuide,
        'Illustrated power access guide showing the gray cover sliding toward the rear, yellow power connectors and lower battery cover',
        'Power access overview. Follow the complete power-on and removal steps below.')}
      <section><h3>Power on</h3><Steps items={[
        <>Ensure <strong>SA is UP / DISARMED</strong>.</>,
        'Slide the gray top cover toward the rear.',
        'Remove the cover.',
        'Locate the yellow XT90 connectors.',
        'Check for damaged connectors or wires. Stop if damaged.',
        <>Join the connectors fully to <strong>power on the rover</strong>.</>,
        'Secure the cover before operating.',
      ]} /></section>
      <div className="manual-columns">
        <section className="manual-inset"><h3>Power off</h3><Steps items={[
          'Stop the rover.',
          <>Set <strong>SB to HOLD</strong> and <strong>SA to DISARM</strong>.</>,
          <><strong>Disconnect XT90.</strong></>,
          'Store the battery safely.',
        ]} /></section>
        <section className="manual-inset"><h3>Remove the battery</h3><Steps items={[
          'Open the lower battery compartment.',
          <><strong>Disconnect XT90 before pulling out the battery.</strong></>,
          'Handle the battery carefully. Hold the battery body; do not pull its wires.',
        ]} /></section>
      </div>
      <AnimatedDisclosure className="manual-details" title={"View actual hardware photos"}>
        <div className="manual-photos">
          {photo(roverSide, 'Gray top cover on the rover next to the actuator', 'Top cover: slide toward the rear, then remove for power access.')}
          {photo(xt90, 'Two disconnected yellow XT90 power connector halves inside the rover', 'Yellow XT90 connectors: join fully to power on; disconnect after use.')}
          {photo(batteryCover, 'Lower rover battery compartment opened with its white cover removed and battery visible', 'Lower compartment: battery access is separate from the gray top cover. Disconnect power before removal.')}
        </div>
      </AnimatedDisclosure>
    </>
  );
}

function BatteryCharging({ photo, instructionalGuide }) {
  return (
    <>
      <span className="manual-verification"><AlertTriangle size={15} aria-hidden="true" /> Charging setup — verify before use</span>
      <p>Have the actual charger, adapter, polarity and battery connections checked before charging. This setup is awaiting physical verification.</p>
      {instructionalGuide(batteryGuide,
        'Illustrated battery guide showing cover removal, XT90 disconnection before battery removal, the balance plug, checker and charger',
        'Battery checking and charging overview only. Actual charger wiring and safety checks still need verification.')}
      <section className="manual-stack">
        <h3>Check the battery</h3>
        <p>Our intended operating range is about <strong>40–90% charge</strong>, subject to checker accuracy. Voltage-based percentages are estimates; check each cell too.</p>
        <Steps items={[
          'Disconnect the battery from the rover.',
          'Locate the battery’s 5-wire balance connector.',
          <>Use the checker’s marked <strong>negative (−) pin</strong> and <strong>cell positions 1–4</strong> for 4S. Follow its markings and manual; do not guess plug orientation.</>,
          'Inspect individual cell voltages as well as estimated capacity.',
          <><strong>Stop using the battery</strong> if damaged, swollen or showing abnormal cell readings.</>,
        ]} />
      </section>
      <section className="manual-stack">
        <h3>Charging settings to verify</h3>
        <dl className="manual-charge-settings">
          <div><dt>Battery / program</dt><dd><strong>LiPo BALANCE</strong></dd></div>
          <div><dt>Cell count / nominal voltage</dt><dd><strong>4S / 14.8V</strong></dd></div>
          <div><dt>Full-charge voltage</dt><dd><strong>16.8V total</strong></dd></div>
          <div><dt>Initial conservative current</dt><dd><strong>1.0A</strong></dd></div>
        </dl>
        <p>Use a compatible <strong>iMAX B6 LiPo balance charger</strong>. Keep the initial current at 1.0A until the charger, battery and power adapter limits are fully confirmed.</p>
        <Steps items={[
          <>Use the <strong>12V/3A adapter to power the charger</strong>. It must not power the battery directly.</>,
          <>Follow the charger manual to connect <strong>both the main battery lead and 4S balance lead</strong>. Use a properly insulated, correctly polarized <strong>XT90 charging adapter</strong>.</>,
          <>Select the settings above and <strong>verify the displayed cell count is 4S</strong> before starting. Stop if the charger detects a different count.</>,
          <>Charge on a suitable <strong>nonflammable surface</strong>, away from combustible materials. <strong>Never leave charging unattended.</strong></>,
          <>Stop charging if the battery becomes unusually hot, swollen or damaged.</>,
        ]} />
      </section>
      <AnimatedDisclosure className="manual-details" title={"View actual hardware photos"}>
        <div className="manual-photos">
          {photo(balanceLead, '6000mAh 4S battery with the small white balance connector circled in red', 'The small white plug is the balance connector. Identify its wires and markings before connecting.')}
          {photo(batteryChecker, 'Battery capacity checker with negative and numbered lithium cell pins on its right edge', 'Use the checker’s negative pin and cell positions 1–4. The photo does not establish plug orientation.')}
          {photo(charger, 'Blue iMAX B6 charger with an example screen showing LiPo CHARGE and 7.4V 2S', 'Equipment reference only: the pictured 2S CHARGE screen is wrong for this rover. Use 4S LiPo BALANCE settings above.')}
          {photo(chargerCables, 'iMAX B6 charger pictured with several assorted charging leads and alligator clips', 'Included leads are not all approved for our battery. The actual XT90 charging connection still needs verification.')}
        </div>
      </AnimatedDisclosure>
      <Notice title="Use a secure charging connection" caution>
        <p>Do not use exposed or unsecured alligator clips as a permanent charging connection. Do not copy the example charger screen or assume every pictured lead fits this battery.</p>
      </Notice>
      <AnimatedDisclosure className="manual-details" title={"Storage and charger reference"}>
        <p>Do not store a fully charged LiPo for long periods. Follow the charger manual’s LiPo storage program and the battery maker’s storage instructions.</p>
        <p className="manual-source">Reference: <a href="https://www.skyrc.com/files/26/IMAX_B6_Manual.pdf" target="_blank" rel="noreferrer">Official SkyRC iMAX B6 manual (PDF, online)</a>. Confirm the manual matches your charger version.</p>
      </AnimatedDisclosure>
    </>
  );
}

const problems = [
  ['Rover not moving', 'Check arm state, operating mode, RC connection and obstacle detection. Keep the area clear while checking.'],
  ['Mission not received', 'Check rover RX mode, desktop LoRa connection and the deployment assistant’s retry status. Stay in HOLD and DISARM.'],
  ['No telemetry', 'Check rover TX mode and the desktop RX connection. Wait for live data before starting a mission.'],
  ['Actuator not moving', 'Check the relevant safety conditions. Keep hands clear and do not bypass protection.'],
  ['No GPS fix', 'Move outdoors to an open area when it is safe.'],
  ['Battery low or damaged', 'Stop operation and inspect the battery safely. Do not use or charge a damaged or swollen pack.'],
];

function Troubleshooting() {
  return (
    <>
      <Notice title="Stop first, then check" caution>
        <p>Use <strong>HOLD or DISARM</strong> and confirm that movement has stopped. Disconnect XT90 before handling the rover. Never bypass a safety feature to restore movement.</p>
      </Notice>
      <div className="manual-troubleshooting">{problems.map(([problem, solution]) => (
        <AnimatedDisclosure className="manual-details" key={problem} title={problem}><p>{solution}</p></AnimatedDisclosure>
      ))}</div>
      <div className="manual-inset"><h3>Keep these habits</h3><ul className="manual-bullets">
        <li>Keep people clear of the wheels, probe and actuator.</li>
        <li>Watch the rover throughout manual driving and missions.</li>
        <li>Check actual movement; a controller indicator alone is not proof of safety.</li>
        <li>Disconnect XT90 after use.</li>
      </ul></div>
    </>
  );
}

const topicContent = [GettingStarted, ControllerOverview, ManualOperation, MissionOperation, ActuatorControl, BatteryPower, BatteryCharging, Troubleshooting];

export default function UserManualView({ initialGuideId, backLabel, onBack } = {}) {
  const [guideId, setGuideId] = useState(() => resolveGuideId(initialGuideId));
  const [topicIndex, setTopicIndex] = useState(0);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [photoZoom, setPhotoZoom] = useState(1);
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const focusOnChange = useRef(Boolean(initialGuideId));
  const topic = topics[topicIndex];
  const Content = topicContent[topicIndex];

  useEffect(() => {
    if (focusOnChange.current) {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.closest('main')?.scrollTo({ top: 0 });
    }
  }, [guideId, topicIndex]);

  useEffect(() => {
    if (expandedPhoto && !dialogRef.current.open) {
      dialogRef.current.showModal();
      dialogRef.current.querySelector('.manual-lightbox-close')?.focus();
    }
  }, [expandedPhoto]);

  const selectGuide = id => {
    focusOnChange.current = true;
    setGuideId(id);
  };
  const selectTopic = index => {
    focusOnChange.current = true;
    setTopicIndex(index);
  };
  const enlargePhoto = image => {
    setPhotoZoom(1);
    setExpandedPhoto(image);
  };
  const photo = (src, alt, caption) => <Photo src={src} alt={alt} caption={caption} onEnlarge={enlargePhoto} />;
  const instructionalGuide = (src, alt, caption) => <InstructionalGuide src={src} alt={alt} caption={caption} onEnlarge={enlargePhoto} />;

  return (
    <div className="user-manual">
      <header className="manual-header">
        <div className="manual-title-icon"><BookOpen size={24} aria-hidden="true" /></div>
        <div><p className="manual-eyebrow">EKSPLORADOR HANDBOOK</p><h1>User Manual</h1><p>Get to know your rover, one step at a time.</p></div>
        {onBack && <button type="button" className="manual-back-button ui-control" onClick={onBack} aria-label={`Back to ${backLabel}`}><ArrowLeft size={16} aria-hidden="true" />Back to {backLabel}</button>}
      </header>
      <nav className="manual-guide-nav" aria-label="User manual guides">
        {guides.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={guideId === id} onClick={() => selectGuide(id)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
      </nav>
      {guideId === 'rover' ? (
        <div className="manual-layout">
          <nav className="manual-topic-nav" aria-label="Rover guide topics">
            <p className="manual-eyebrow">ROVER OPERATION GUIDE</p>
            <label className="manual-topic-select">Rover topic
              <select value={topicIndex} aria-controls="manual-topic" onChange={event => selectTopic(Number(event.target.value))}>
                {topics.map((item, index) => <option key={item.id} value={index}>{String.fromCharCode(65 + index)}. {item.label}</option>)}
              </select>
            </label>
            {topics.map((item, index) => <button type="button" key={item.id} aria-current={index === topicIndex ? 'step' : undefined} aria-controls="manual-topic" onClick={() => selectTopic(index)}><span className="manual-topic-letter">{String.fromCharCode(65 + index)}</span><span>{item.label}</span>{index === topicIndex && <ChevronRight size={16} aria-hidden="true" />}</button>)}
            <div className="manual-topic-note"><ShieldCheck size={18} aria-hidden="true" /><span>Keep HOLD and DISARM within reach.</span></div>
          </nav>
          <article className="manual-article" id="manual-topic" aria-labelledby="manual-topic-heading">
            <header className="manual-article-header"><p className="manual-eyebrow">ROVER OPERATION · {String(topicIndex + 1).padStart(2, '0')} / 08</p><h2 id="manual-topic-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
            <div className="manual-topic-content" key={topic.id}><Content photo={photo} instructionalGuide={instructionalGuide} /></div>
            <footer className="manual-page-nav" aria-label="Read next or previous topic">
              <button type="button" disabled={topicIndex === 0} onClick={() => selectTopic(topicIndex - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>
              {topicIndex < topics.length - 1 ? <button type="button" onClick={() => selectTopic(topicIndex + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => selectTopic(0)}>Back to Getting Started<ChevronRight size={16} aria-hidden="true" /></button>}
            </footer>
          </article>
        </div>
      ) : guideId === 'field' ? (
        <FieldMapGuide Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} />
      ) : guideId === 'monitoring' ? (
        <LiveMonitoringGuide Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} />
      ) : guideId === 'crops' ? (
        <CropAssessmentGuide Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} />
      ) : guideId === 'reports' ? (
        <ReportsGuide Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} />
      ) : (
        <OfflineMapGuide Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} />
      )}
      <dialog className="manual-lightbox" ref={dialogRef} aria-labelledby="manual-photo-caption" onClose={() => setExpandedPhoto(null)} onClick={event => { if (event.target === event.currentTarget) dialogRef.current.close(); }}>
        {expandedPhoto && <div className="manual-lightbox-content">
          <div className="manual-lightbox-toolbar">
            <div className="manual-lightbox-zoom" role="group" aria-label="Image zoom">
              <button type="button" aria-label="Zoom out" disabled={photoZoom === 1} onClick={() => setPhotoZoom(value => Math.max(1, value - 0.5))}><ZoomOut size={18} aria-hidden="true" /></button>
              <button type="button" onClick={() => setPhotoZoom(1)} aria-label="Reset image to fit width">Fit width</button>
              <output aria-live="polite" aria-label="Image zoom level">{photoZoom * 100}%</output>
              <button type="button" aria-label="Zoom in" disabled={photoZoom === 3} onClick={() => setPhotoZoom(value => Math.min(3, value + 0.5))}><ZoomIn size={18} aria-hidden="true" /></button>
            </div>
            <button type="button" className="manual-lightbox-close" aria-label="Close enlarged image" onClick={() => dialogRef.current.close()} autoFocus><X size={22} aria-hidden="true" /></button>
          </div>
          <div className={`manual-lightbox-viewport${photoZoom > 1 ? ' is-zoomed' : ''}`} tabIndex={0} role="region" aria-label="Enlarged image; scroll to explore when zoomed">
            <img src={expandedPhoto.src} alt={expandedPhoto.alt} style={photoZoom > 1 ? { width: `${photoZoom * 100}%` } : undefined} />
          </div>
          <p id="manual-photo-caption">{expandedPhoto.caption}</p>
        </div>}
      </dialog>
    </div>
  );
}
