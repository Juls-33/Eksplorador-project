import AnimatedDisclosure from '../components/ui/AnimatedDisclosure';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Compass, Navigation, Radio, ShieldCheck } from 'lucide-react';
import overview from '../assets/user-manual/live-monitoring/overview.png';
import connectionCards from '../assets/user-manual/live-monitoring/connection-cards.png';
import gpsWarning from '../assets/user-manual/live-monitoring/gps-warning.png';
import moisturePh from '../assets/user-manual/live-monitoring/soil-moisture-ph.png';
import ecNpk from '../assets/user-manual/live-monitoring/soil-ec-npk.png';
import queue from '../assets/user-manual/live-monitoring/sampling-queue.png';
import recentSamples from '../assets/user-manual/live-monitoring/recent-samples.png';

const topics = [
  { id: 'start', label: 'Getting Started', summary: 'Connect the receiver and check for new rover packets.' },
  { id: 'connection', label: 'Connection Status', summary: 'Separate the USB connection from wireless reception and sensor validity.' },
  { id: 'gps', label: 'GPS Monitoring', summary: 'Read the GPS indicators and know when location is unavailable.' },
  { id: 'soil', label: 'Soil Sensor Monitoring', summary: 'Understand the four soil cards and their displayed units.' },
  { id: 'orientation', label: 'IMU and Rover Orientation', summary: 'Know which orientation information this screen does not show.' },
  { id: 'freshness', label: 'Reading Live Data', summary: 'Check freshness before using values, maps or saved records.' },
  { id: 'help', label: 'Troubleshooting', summary: 'Check common problems without bypassing rover protections.' },
];

function GettingStarted({ Steps, Notice, instructionalGuide }) {
  return <>
    <p>Use <strong>Live Monitoring Board</strong> to watch incoming packets and review saved samples. A packet is a bundle of readings sent by the rover. This page does not drive or arm the rover.</p>
    <Steps items={[
      <>Open <strong>Live Monitoring</strong> from the sidebar.</>,
      <>Connect the desktop LoRa receiver through <strong>USB</strong>. The app searches for a compatible receiver automatically.</>,
      'Make sure the rover is powered on. Keep it in a safe area with HOLD and DISARM selected while checking connections.',
      <>Set <strong>SD (CH8) → rover TX</strong> so the rover can send telemetry. In the reviewed controller configuration, its green indicator is OFF for rover TX.</>,
      <>Check that the desktop receiver is connected and reports <strong>Mode: RX</strong>. Normal telemetry needs <strong>rover TX → desktop RX</strong>.</>,
      <>Look for <strong>Rover telemetry live</strong> and check whether the packet number in <strong>Live Sampling Queue</strong> advances as new packets arrive. Then check GPS and probe status.</>,
    ]} />
    <Notice title="A USB connection is only the first step"><p><strong>Desktop LoRa connected</strong> does not prove that the rover is sending packets or that every sensor value is valid. Use the connection, GPS and probe indicators together.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"See the actual dashboard layout"}>
      {instructionalGuide(overview, 'Actual Live Monitoring Board showing receiver and GPS indicators, four soil cards, map, sampling queue, recent samples and Crop Suitability', 'Actual running app with no receiver or live sensor packets at capture time. Dashes and empty panels are the real waiting state. This screenshot is a reference, not current telemetry.')}
    </AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Desktop still shows TX after mission upload?"}><p>The Mission Deployment Assistant normally restores desktop RX. Follow its recovery instructions if restoration failed. This Live Monitoring screen has no manual TX/RX switch button. Do not expect telemetry while the desktop remains in TX.</p></AnimatedDisclosure>
  </>;
}

const connectionRows = [
  ['Searching for desktop LoRa…', 'No compatible desktop receiver has been found yet. Check its USB connection.'],
  ['Desktop LoRa connected', 'The desktop receiver is available. Its detected COM port and mode appear in the receiver card. Wireless rover reception is separate.'],
  ['Desktop LoRa disconnected', 'A previously detected receiver is unavailable. The app continues searching.'],
  ['Unable to read desktop LoRa connection status', 'The app could not read receiver status. Read the shown error; do not assume the receiver is working.'],
  ['Rover telemetry live', 'The dashboard recently received a packet without an error. This does not separately check every sensor value.'],
  ['Waiting for rover telemetry', 'No recent accepted packet is available. The desktop receiver may still be connected through USB.'],
];

function ConnectionStatus({ Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(connectionCards, 'Actual receiver searching card beside Waiting for rover telemetry, with Probe dashes below', 'Actual disconnected capture: receiver detection, rover packet reception and probe status are separate indicators.')}
    <div className="manual-table-wrap" role="region" aria-label="Live Monitoring connection labels" tabIndex={0}><table className="manual-table"><caption>What the screen’s labels mean</caption><thead><tr><th scope="col">Label</th><th scope="col">Meaning</th></tr></thead><tbody>{connectionRows.map(([label, meaning]) => <tr key={label}><th scope="row">{label}</th><td>{meaning}</td></tr>)}</tbody></table></div>
    <div className="manual-control-pair">
      <div className="manual-inset"><h3><Radio size={18} aria-hidden="true" /> LoRa RSSI and SNR</h3><p>RSSI is the received signal strength, shown in <strong>dBm</strong>. SNR compares signal with radio noise. These belong to the last displayed packet and may remain when packets stop.</p></div>
      <div className="manual-inset"><h3><ShieldCheck size={18} aria-hidden="true" /> Probe status</h3><p><strong>Probe OK</strong> means the last packet marked the soil reading as valid. <strong>Probe Not Responding</strong> means it did not. <strong>Probe --</strong> appears before a packet is available.</p></div>
    </div>
    <Notice title="Packet receipt and good sensor data are different"><p>Probe status does not identify the exact cause of an invalid reading. A live packet may still have no GPS fix, invalid soil data or missing fields. The labels above explain the interface; they are not live status indicators inside this guide.</p></Notice>
  </>;
}

function GpsMonitoring({ Steps, Notice, instructionalGuide }) {
  return <>
    <div style={{ width: '100%', maxWidth: 540 }}>{instructionalGuide(gpsWarning, 'Actual GPS not locked map warning saying the app is waiting for rover telemetry and GPS position', 'Actual waiting-state warning. A visible base map is not proof of a live rover position.')}</div>
    <Steps items={[
      <>Check <strong>Rover telemetry live</strong> before using the GPS indicator.</>,
      <>Read <strong>GPS Fix</strong> and its satellites count. <strong>No Fix</strong> shows satellites in view, not a usable live fix. <strong>GPS --</strong> appears when recent telemetry is unavailable.</>,
      <>Read the map’s <strong>GPS not locked</strong> warning when present. It may say that telemetry, locked satellites or valid coordinates are missing.</>,
      'For weak indoor reception, move to an open outdoor area when it is safe. Wait for fresh telemetry and a usable fix.',
    ]} />
    <div className="manual-control-pair"><div className="manual-inset"><h3><Navigation size={18} aria-hidden="true" /> Satellites</h3><p><strong>Locked</strong> satellites help form the app’s usable fix. Satellites merely <strong>in view</strong> do not mean the coordinates are ready or accurate.</p></div><div className="manual-inset"><h3>Latitude / longitude</h3><p><strong>Lat / Lng</strong> in Recent Geo-tagged Samples belongs to a saved record. Coordinates use decimal degrees. They are not a separate live-coordinate panel.</p></div></div>
    <Notice title="A saved map position is not a live fix" caution><p>The dashboard hides the live rover marker when its fresh GPS checks fail. The map can still show a default area or saved locations. A record’s <strong>No fix</strong> label means it has no usable saved location. Displayed decimal places do not prove GPS accuracy.</p></Notice>
    <p className="manual-muted">This page has no separate live latitude/longitude card or movement-speed readout. A GPS Fix indicator is not a guarantee of precise waypoint arrival.</p>
  </>;
}

const soilRows = [
  ['Soil Moisture', '%', 'The reported soil moisture percentage.'],
  ['Soil pH', 'pH value; no physical unit', 'An indication of how acidic or alkaline the soil reading is.'],
  ['Conductivity (EC)', 'uS/cm', 'Electrical conductivity: how easily an electrical current passes through the measured soil. The label means microsiemens per centimetre.'],
  ['NPK Ratio', 'mg/kg', 'Reported nitrogen (N), phosphorus (P) and potassium (K), in that order. These are three amounts, even though the card title says Ratio.'],
];

function SoilMonitoring({ Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(moisturePh, 'Actual Soil Moisture and Soil pH cards showing dashes and No valid reading', 'Actual waiting state: -- means no accepted soil reading is available. It does not mean zero moisture or zero pH.')}
    <div className="manual-table-wrap" role="region" aria-label="Soil measurements and units shown on Live Monitoring" tabIndex={0}><table className="manual-table"><caption>The four soil cards</caption><thead><tr><th scope="col">Card</th><th scope="col">Displayed unit</th><th scope="col">Simple meaning</th></tr></thead><tbody>{soilRows.map(([label, unit, meaning]) => <tr key={label}><th scope="row">{label}</th><td>{unit}</td><td>{meaning}</td></tr>)}</tbody></table></div>
    <Notice title="Green card wording is not a soil recommendation" caution><p><strong>Within range</strong>, <strong>Optimal</strong> and <strong>Balanced</strong> appear when the packet marks the soil reading as valid. These captions are not separate range tests or proof that the soil suits a crop. Do not use them as fertilizer instructions.</p></Notice>
    <section><h3>Missing, invalid, stale or zero?</h3><div className="manual-table-wrap" role="region" aria-label="How to interpret missing or zero soil values" tabIndex={0}><table className="manual-table"><thead><tr><th scope="col">What you see</th><th scope="col">How to read it</th></tr></thead><tbody>
      <tr><th scope="row">-- / No valid reading</th><td>The last packet did not mark the soil reading as valid, or no packet is available. This is not a measurement of zero.</td></tr>
      <tr><th scope="row">Blank or incomplete value</th><td>A packet may omit a field. The dashboard does not mark every missing field separately. Treat incomplete values as unavailable.</td></tr>
      <tr><th scope="row">Numbers remain while telemetry is waiting</th><td>They may be old. Check packet freshness before using them; some cards retain the last accepted values.</td></tr>
      <tr><th scope="row">A displayed 0</th><td>It may be a real zero, an unsupported reading or a missing value saved as zero. This screen alone cannot tell which. Confirm fresh, valid sensor data before treating it as a measurement.</td></tr>
    </tbody></table></div></section>
    <AnimatedDisclosure className="manual-details" title={"See the EC and NPK cards"}>{instructionalGuide(ecNpk, 'Actual Conductivity EC and NPK Ratio cards with uS/cm and mg/kg labels and no valid readings', 'Actual waiting state: units remain visible even though no valid values have arrived.')}</AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Units and fields to check on the actual sensor"}><p>This guide follows the Live Monitoring page’s <strong>uS/cm</strong> EC label. Confirm the sensor’s output units and calibration before comparing readings with another page or instrument. Soil temperature and salinity are not displayed on this dashboard.</p></AnimatedDisclosure>
  </>;
}

function Orientation({ Notice }) {
  return <>
    <div className="manual-inset"><h3><Compass size={18} aria-hidden="true" /> No IMU panel on this screen</h3><p>The current Live Monitoring Board does not show pitch, roll, heading/yaw or tilt alerts. There is no IMU display switch to enable here.</p></div>
    <div className="manual-control-pair"><div className="manual-inset"><h3>GPS is location information</h3><p>A GPS fix and a map marker do not confirm the rover’s tilt or heading accuracy.</p></div><div className="manual-inset"><h3>Watch the actual rover</h3><p>Use HOLD or DISARM and check that movement has stopped if the rover appears unsafe. Do not wait for an on-screen tilt warning that this page does not provide.</p></div></div>
    <Notice title="Keep orientation checks separate"><p>Do not assume a sensor supported by the firmware is visible or verified on this dashboard. An IMU reading elsewhere would still need calibration; it would not prove the rover’s location.</p></Notice>
  </>;
}

function ReadingLiveData({ Steps, Notice, instructionalGuide }) {
  return <>
    <Steps items={[
      <>Check <strong>Rover telemetry live</strong>. Look for new packet numbers in <strong>Live Sampling Queue</strong>.</>,
      'Check GPS and probe validity separately. A packet can arrive without a usable location or soil reading.',
      'If packets stop, treat the retained numbers and radio values as old until new packets arrive. Soil values can stay the same even while fresh packets are coming in.',
    ]} />
    {instructionalGuide(queue, 'Actual Live Sampling Queue showing Awaiting next telemetry ping from rover', 'Actual queue before a packet is received. Its message changes after receipt; this screenshot does not simulate live data.')}
    <Notice title="“Received just now” is not a running freshness clock" caution><p>The queue’s last-packet text can remain unchanged after communication stops. Soil cards, Probe status, radio values and Crop Suitability can also retain older information. Use the telemetry badge and evidence of new packets, not that phrase or a green card alone.</p></Notice>
    <section className="manual-inset"><h3>How this version updates</h3><ul className="manual-bullets">
      <li>The cards update when the app receives a new non-error packet. This page does not promise a fixed packet rate.</li>
      <li>After more than <strong>15 seconds</strong> without one, the app returns to <strong>Waiting for rover telemetry</strong>. It checks for this every <strong>2 seconds</strong>, so the change is not instant.</li>
      <li>Saved records are checked every <strong>10 seconds</strong>. Saving is also buffered, so table rows can appear later than the live cards.</li>
      <li>The backend searches for the desktop receiver again after loss. Automatic USB recovery does not guarantee the rover’s wireless link or change its SD switch.</li>
    </ul></section>
    <AnimatedDisclosure className="manual-details" title={"Map layers and live locations"}><p><strong>Field Heatmap Spatial View</strong> offers Soil Moisture, Soil pH, Electrical Conductivity, Nitrogen, Phosphorus and Potassium. Live points are added only when the app has a usable GPS fix and the packet marks the soil reading as valid. The colored display uses available measurements; it is not a new reading from every spot on the map.</p><p>Dragging the map, place search and downloaded-area selection change the view. The <strong>Online map</strong> label describes map tiles, not a working LoRa link.</p></AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Recent Geo-tagged Samples and historical selection"}>
      {instructionalGuide(recentSamples, 'Actual empty Recent Geo-tagged Samples table showing Time, Lat and Lng, pH, moisture, EC and NPK columns', 'Actual empty table. The Time column belongs to saved records; it is not a live packet-age counter.')}
      <Steps items={[
        'Review Time and Lat / Lng with the saved soil values. The recent table is session-based; an empty table does not prove the full database is empty.',
        'Choose a row or checkbox with a usable saved location. It becomes the anchor for an automatic group, rather than independently adding one checkbox at a time.',
        'The app selects up to 20 records within 100 m and ±2 hours of the anchor. These are grouping rules, not GPS accuracy or sensor-quality claims.',
        <>With at least <strong>10</strong> selected records, <strong>Assess historical records</strong> becomes available. Check the source text under Crop Suitability to see whether it uses the current packet or a selected historical average.</>,
        <>Use <strong>Clear selection</strong> to leave the historical group and return to the live heatmap. Saved records are not deleted.</>,
      ]} />
      <p className="manual-muted">Selecting history changes the map and assessment source, not the live soil cards. A historical map position is not the rover’s current position. Crop Suitability is an app summary, not a verified crop or fertilizer recommendation.</p>
    </AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Export Data, Import Data and Merge Data"}><p><strong>Export Data</strong> saves a backup of the full database. <strong>Import Data</strong> replaces the database from a backup; it is not a refresh button. <strong>Merge Data</strong> combines backup data with the current database. Back up existing records before replacing them. These controls do not restore a radio link.</p></AnimatedDisclosure>
  </>;
}

const problems = [
  ['Desktop LoRa not detected', 'Check the USB data cable and receiver power. When detected, its COM port is shown in the receiver card. The app searches automatically; this page has no manual COM-port selector. Read any status error before assuming it is connected.'],
  ['No rover telemetry', 'Check rover power, SD (CH8) in rover TX and desktop Mode: RX. Desktop USB connection alone is not wireless rover reception. If a deployment left desktop TX active, follow the Mission Deployment Assistant’s RX recovery steps.'],
  ['GPS unavailable', 'Confirm that new packets arrive. Move outdoors to an open area when safe. Wait for a usable GPS fix; do not rely on an old saved location or the base map alone.'],
  ['Soil sensor not updating', 'Check fresh packets and Probe status. Probe Not Responding means the last packet did not mark the soil reading as valid; it does not diagnose the cause. Stop the rover before inspecting sensor contact and connections. Do not bypass protection.'],
  ['Readings stopped changing', 'Check the telemetry badge and whether packet numbers advance. Soil values can remain steady, while the queue’s received just now text can remain after packets stop. Saved record times are not live freshness indicators.'],
  ['Unexpected values, blanks or zeros', 'Inspect the actual sensor and its connection safely. Check validity, freshness and displayed units. Do not assume every zero is measured: unsupported or missing fields can appear as zero in saved data. Ask the project team to verify the payload and calibration if unsure.'],
  ['Live cards change, but no table rows appear', 'The table shows saved records, not every packet. It is session-based and refreshes separately. Soil validity, location and database saving affect which records appear. Allow for saving delays and read any database error.'],
];

function Troubleshooting({ Notice }) {
  return <>
    <Notice title="Check the rover safely" caution><p>Use HOLD or DISARM and confirm that movement has stopped before checking hardware. Disconnect rover power before handling wiring. Never bypass a safety protection to restore readings.</p></Notice>
    <div className="manual-troubleshooting">{problems.map(([problem, solution]) => <AnimatedDisclosure className="manual-details" key={problem} title={problem}><p>{solution}</p></AnimatedDisclosure>)}</div>
    <p className="manual-muted">Actual sensor units, calibration, valid zero readings, USB recovery and outdoor GPS behavior still need checks on the physical system.</p>
  </>;
}

const content = [GettingStarted, ConnectionStatus, GpsMonitoring, SoilMonitoring, Orientation, ReadingLiveData, Troubleshooting];

export default function LiveMonitoringGuide({ Steps, Notice, instructionalGuide }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const headingRef = useRef(null);
  const topic = topics[topicIndex];
  const Content = content[topicIndex];
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [topicIndex]);

  return <div className="manual-layout live-monitoring-manual">
    <nav className="manual-topic-nav" aria-label="Live Monitoring guide topics">
      <p className="manual-eyebrow">LIVE MONITORING GUIDE</p>
      <label className="manual-topic-select">Live Monitoring topic<select value={topicIndex} aria-controls="monitoring-manual-topic" onChange={event => setTopicIndex(Number(event.target.value))}>{topics.map((item, index) => <option key={item.id} value={index}>{String.fromCharCode(65 + index)}. {item.label}</option>)}</select></label>
      {topics.map((item, index) => <button type="button" key={item.id} aria-current={index === topicIndex ? 'step' : undefined} aria-controls="monitoring-manual-topic" onClick={() => setTopicIndex(index)}><span className="manual-topic-letter">{String.fromCharCode(65 + index)}</span><span>{item.label}</span>{index === topicIndex && <ChevronRight size={16} aria-hidden="true" />}</button>)}
      <div className="manual-topic-note"><ShieldCheck size={18} aria-hidden="true" /><span>Check the connection, packet freshness and sensor validity separately.</span></div>
    </nav>
    <article className="manual-article" id="monitoring-manual-topic" aria-labelledby="monitoring-manual-heading">
      <header className="manual-article-header"><p className="manual-eyebrow">LIVE MONITORING · {String(topicIndex + 1).padStart(2, '0')} / 07</p><h2 id="monitoring-manual-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
      <div className="manual-topic-content" key={topic.id}><Content Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} /></div>
      <footer className="manual-page-nav" aria-label="Read next or previous Live Monitoring topic"><button type="button" disabled={topicIndex === 0} onClick={() => setTopicIndex(index => index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{topicIndex < topics.length - 1 ? <button type="button" onClick={() => setTopicIndex(index => index + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => setTopicIndex(0)}>Back to Getting Started<ChevronRight size={16} aria-hidden="true" /></button>}</footer>
    </article>
  </div>;
}
