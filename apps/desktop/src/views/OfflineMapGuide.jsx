import AnimatedDisclosure from '../components/ui/AnimatedDisclosure';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, MapPin, Undo2 } from 'lucide-react';
import searchMap from '../assets/user-manual/offline-map/search-map.png';
import selectedArea from '../assets/user-manual/offline-map/selected-area.png';
import areaSettings from '../assets/user-manual/offline-map/area-settings.png';
import savedAreas from '../assets/user-manual/offline-map/saved-areas.png';

const topics = [
  { id: 'why', label: 'Why Download a Map?', summary: 'Prepare map coverage before going to the farm.' },
  { id: 'search', label: 'Search for the Location', summary: 'Search for a landmark near your farm.' },
  { id: 'boundary', label: 'Draw the Map Boundaries', summary: 'Mark corners and check the download rectangle.' },
  { id: 'estimate', label: 'Name and Estimate the Area', summary: 'Name the area and check the estimated download size.' },
  { id: 'download', label: 'Download the Offline Map', summary: 'Wait for completion and check for failed tiles.' },
  { id: 'offline', label: 'Open a Saved Map Without Internet', summary: 'Check the saved area before traveling.' },
  { id: 'help', label: 'Troubleshooting', summary: 'Check search, selection, download and saved-map problems.' },
];

function WhyDownload({ Notice }) {
  return <>
    <p>Download the map before going to the farm. This lets you view the saved area even when there is no internet.</p>
    <div className="manual-flow" aria-label="Offline map preparation">
      <span>Search</span><ChevronRight size={16} aria-hidden="true" /><span>Mark corners</span><ChevronRight size={16} aria-hidden="true" /><span>Name &amp; estimate</span><ChevronRight size={16} aria-hidden="true" /><span>Download &amp; check</span>
    </div>
    <div className="manual-inset"><h3><MapPin size={18} aria-hidden="true" /> What is saved?</h3><p>The app saves map image tiles on this device. It can show those tiles without internet in <strong>Offline Maps</strong>, <strong>Field Map</strong> and the map in <strong>Live Monitoring</strong>. Only the saved area and saved zoom levels are covered. Some maps may already be shipped with the app.</p></div>
    <Notice title="Map coverage has limits"><p>Searching for a new place and downloading more map detail need internet. Saving a map does not make every app feature work offline or provide rover GPS, soil readings or a radio connection.</p></Notice>
    <p className="manual-muted">Use the desktop app on the same device for downloading and fieldwork. Downloaded maps are stored locally and are not automatically shared with another computer.</p>
  </>;
}

function SearchLocation({ Steps, Notice, instructionalGuide }) {
  return <>
    <Steps items={[
      <>Connect to the internet. Open <strong>Offline Maps</strong> in the sidebar; the page title is <strong>Offline Map Coverage</strong>.</>,
      <>Scroll to <strong>Download a New Area</strong>. Find <strong>Search a place or landmark</strong> at the map’s upper left, beside the zoom buttons.</>,
      <>Enter a nearby landmark, barangay, municipality or known place. Type at least <strong>3 characters</strong>, then click <strong>Go</strong> or press Enter.</>,
      'Read the result names and nearby location details. Click the correct result to move the map there.',
      <>Drag the map to find your farmland. Use <strong>+</strong> and <strong>−</strong> to zoom in or out. Drag to move the view; a single map click marks a download corner.</>,
    ]} />
    {instructionalGuide(searchMap, 'Actual Offline Maps map with zoom buttons at the upper left, Search a place or landmark and Go beside them, and the saved-map menu at the upper right', 'Where to click: search beside + / − at the upper left. The menu at the upper right opens saved coverage. This existing capture shows a campus landmark, not a downloaded farm.')}
    <Notice title="Search while connected"><p>Place search needs internet. If no result appears, try a nearby town or landmark. The map supports the region from Nueva Ecija to Batangas; results outside that region cannot be selected.</p></Notice>
  </>;
}

function DrawBoundaries({ Steps, Notice, instructionalGuide }) {
  return <>
    <p>In <strong>Offline Maps → Download a New Area</strong>, corner marking is already active. There is no separate drawing-tool button to select.</p>
    <Steps items={[
      <>Click one corner of the area you need. A numbered pin appears. If <strong>Done removing</strong> is showing below the map, click it first to return to adding corners.</>,
      'Click the opposite corner so the area has both width and height. You may mark more corners if needed.',
      'Stop adding pins when the rectangle covers the farmland or testing area. The app forms the box automatically; there is no Finish button and no need to click the first pin again.',
      'Review the dashed rectangle before downloading. It includes the space between the outermost corners, even if the farm has an uneven shape.',
    ]} />
    {instructionalGuide(selectedArea, 'Actual Download a New Area panel showing two numbered opposite-corner pins, a dashed rectangular selection and Undo last pin, Remove a pin and Clear all below the map', 'Two clicks make the download rectangle. The existing capture shows a campus selection only; it does not show a completed download. Correction buttons sit directly below the map.')}
    <div className="manual-inset"><h3><Undo2 size={18} aria-hidden="true" /> Correct the selection</h3><ul className="manual-bullets">
      <li><strong>Undo last pin</strong>: remove the most recent corner.</li>
      <li><strong>Remove a pin</strong>: click a red × on the map to remove that pin. Click <strong>Done removing</strong> to add corners again.</li>
      <li><strong>Clear all</strong>: remove all corners and draw again.</li>
    </ul></div>
    <Notice title="Download coverage is a rectangle"><p>This selects map coverage. It does not save a Field Map field boundary or create mission waypoints. To change a corner, remove it and click its new position; there is no pin-dragging control here.</p></Notice>
  </>;
}

function NameAndEstimate({ Steps, Notice, instructionalGuide }) {
  return <>
    <Steps items={[
      <>Below the map, enter a clear <strong>Area name</strong> that you can recognize later. Use a different name for each area you want to keep listed.</>,
      <>Check that the <strong>South</strong>, <strong>West</strong>, <strong>North</strong> and <strong>East</strong> boxes have been filled by your map clicks. You can also enter known coordinates directly.</>,
      <>Review <strong>Min zoom</strong> and <strong>Max zoom</strong>, which start at 13 and 18. Higher zoom numbers show closer detail. Moving the map’s + / − buttons does not change these download settings.</>,
      <>Click <strong>Estimate</strong>. Read the tile count, approximate storage in <strong>GB</strong> and approximate time in <strong>min</strong>.</>,
      <>If the download is too large, choose a smaller rectangle or lower <strong>Max zoom</strong>. Keep Min zoom no higher than Max zoom. Click <strong>Estimate</strong> again after changing any coordinates or settings, then review the new estimate.</>,
    ]} />
    {instructionalGuide(areaSettings, 'Actual Offline Maps form with Area name, four coordinate boxes, Min zoom, Max zoom, Estimate and a disabled Download button', 'Where to click: Area name is above the coordinate boxes; Estimate and Download are below the zoom settings. This capture was taken before naming or estimating, so it shows no storage estimate or download result. Use your own location, not the pictured coordinates.')}
    <Notice title="Storage size is not land size"><p>This page does not show hectares, square metres or another land-area measurement. <strong>Tiles</strong> are map images, <strong>GB</strong> estimates download/storage size, and <strong>min</strong> estimates download time. These are approximate; they are not the size of the farm or a promise of actual storage or speed.</p></Notice>
    <p className="manual-muted">The map viewer supports zoom levels 10–18. Download the levels you need to check in the field. Zooming outside the saved range may leave the map blank when offline.</p>
  </>;
}

function DownloadMap({ Steps, Notice }) {
  return <>
    <Steps items={[
      <>Review the rectangle, <strong>Area name</strong>, zoom range and latest <strong>Estimate</strong>. The <strong>Download</strong> button becomes available after an estimate.</>,
      <>Click <strong>Download</strong>. If the selection exceeds the recommended tile limit, the app asks for confirmation. Prefer reducing the area or Max zoom and estimating again. If you decide to continue, check <strong>Yes, I understand and want to proceed</strong>, then click <strong>Confirm Download</strong>.</>,
      <>Watch <strong>Download in progress</strong> near the top of the page. It shows a progress bar and counts for downloaded, skipped and failed tiles. Skipped tiles were already saved.</>,
      <>Wait for <strong>Download complete</strong>. Read the result counts. If it says tiles <strong>failed — try again later</strong>, repeat the same area and zoom range while connected to fill the gaps.</>,
      <>Check <strong>Covered Areas</strong> for your area name, zoom range and <strong>Downloaded here</strong> label. Then test it without internet using the next topic.</>,
    ]} />
    <Notice title="Check more than the completion message" caution><p><strong>Download complete</strong> and a Covered Areas entry can still appear when some tiles failed. They do not prove the whole area is available. Check the failed count and view the required area and detail offline before leaving.</p></Notice>
    <Notice title="Keep the app open and stay connected"><p>Keep internet connected until the download finishes. You can switch to another page in the app; the sidebar’s <strong>Offline Maps</strong> item shows progress. Closing the app stops the download.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"If you need to stop"}><p>Use <strong>Cancel download</strong> and wait for <strong>Download cancelled</strong>. Tiles already saved are kept, but a canceled new area is not added to Covered Areas. There is no Resume button or automatic restart after closing the app. To continue later, enter the same area and zoom range, choose <strong>Estimate</strong>, then <strong>Download</strong>; saved tiles are skipped.</p><p>Record the area name, coordinates and zoom range before leaving the page if you need to repeat it. The draft form is not kept when you switch pages. <strong>Dismiss</strong> only clears a finished status message.</p></AnimatedDisclosure>
  </>;
}

function OpenSavedMap({ Steps, Notice, instructionalGuide }) {
  return <>
    <Steps items={[
      <>Finish the download and check its failed-tile count. In <strong>Offline Maps → Covered Areas</strong>, confirm the area name and saved zoom range. <strong>Downloaded here</strong> means downloaded on this device; <strong>Shipped with app</strong> means bundled coverage.</>,
      'Temporarily disconnect this computer from the internet after the download has finished.',
      <>Open <strong>Field Map</strong>. On its map, use <strong>Jump to downloaded map…</strong> at the upper right and select your area. The same menu is available on the map in <strong>Offline Maps</strong>.</>,
      <>Use <strong>+</strong> or <strong>−</strong> to reach the zoom levels you saved. The first view may be wider than the saved zoom range. Drag across the area and check the roads, landmarks and detail needed for your visit.</>,
      <>Look for <strong>Offline — saved tiles</strong>, and check that the required map detail is actually visible. If part is blank or <strong>Map tiles unavailable</strong> appears, reconnect and download the missing coverage before traveling.</>,
    ]} />
    {instructionalGuide(savedAreas, 'Existing Covered Areas rows named cavite and Santa Rosa, both labeled z13–18 and Downloaded here', 'Existing saved-area entries from the desktop capture. Your names and zoom ranges will differ. An entry alone does not confirm every tile was saved.')}
    <AnimatedDisclosure className="manual-details" title={"Find the saved-map menu"}>{instructionalGuide(searchMap, 'Actual map showing Jump to downloaded map at the upper right', 'Click Jump to downloaded map… at the upper right. This reference capture shows Online map; it is not an offline-access test.')}</AnimatedDisclosure>
    <Notice title="Open saved maps through the map menu"><p>The <strong>Covered Areas</strong> rows have no Open button. Use <strong>Jump to downloaded map…</strong> to move to an area. If a newly downloaded area is missing from that menu, leave the page and reopen it to reload the list.</p></Notice>
    <p className="manual-muted">The saved-map menu works offline. The map chooses saved tiles automatically when online tiles are unavailable; there is no separate offline switch. The offline label means some saved tiles loaded, so still check the whole area at the detail you need.</p>
  </>;
}

const problems = [
  ['Location cannot be found', 'Check internet, type at least 3 characters and press Go. Try a nearby landmark, barangay or town. The supported map region is Nueva Ecija to Batangas. New place searches are unavailable offline.'],
  ['Cannot draw the boundary', 'Use the map under Offline Maps → Download a New Area. Click Done removing if removal mode is active, then click two opposite corners with both width and height. Corner marking is already active; there is no drawing-tool button to select. Dragging moves the map instead of adding a corner.'],
  ['Download is too large', 'Use Clear all and mark a smaller rectangle, or lower Max zoom while keeping Min zoom no higher than Max zoom. Click Estimate again. Lower Max zoom saves less close-up detail, so check that it is enough for your visit.'],
  ['Download stopped', 'Check internet and the Download failed or Download cancelled message. Re-enter the same area name, coordinates and zoom range if needed, click Estimate, then Download. Already saved tiles are reused. A Download complete result with failed tiles also needs another download. There is no Retry or Resume button.'],
  ['Saved map is missing', 'Check Offline Maps → Covered Areas on the same device used for downloading. If a new download was canceled, finish it to add the entry. Reopen Field Map to refresh Jump to downloaded map…. Maps are stored in the app’s local data on this computer, not in a shared account or a chosen Downloads folder.'],
  ['Map is blank offline', 'Select the intended saved area and zoom within its listed range. The initial view may be wider than the saved range. Check all needed detail before leaving; if tiles are still missing, reconnect and download the same area and zoom range again. A saved-area entry or offline label alone does not prove full coverage.'],
  ['Download stays disabled or an estimate looks old', 'Enter an Area name and select an area with width and height. South must be less than North, West less than East, and Min zoom no higher than Max zoom. Read any form message, correct the selection and click Estimate. Always estimate again after manually changing coordinates or zoom settings.'],
];

function Troubleshooting() {
  return <div className="manual-troubleshooting">{problems.map(([problem, solution]) => <AnimatedDisclosure className="manual-details" key={problem} title={problem}><p>{solution}</p></AnimatedDisclosure>)}</div>;
}

const content = [WhyDownload, SearchLocation, DrawBoundaries, NameAndEstimate, DownloadMap, OpenSavedMap, Troubleshooting];

export default function OfflineMapGuide({ Steps, Notice, instructionalGuide }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const headingRef = useRef(null);
  const topic = topics[topicIndex];
  const Content = content[topicIndex];
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [topicIndex]);

  return <div className="manual-layout offline-map-manual">
    <nav className="manual-topic-nav" aria-label="Offline map guide topics">
      <p className="manual-eyebrow">OFFLINE MAP GUIDE</p>
      <label className="manual-topic-select">Offline map topic<select value={topicIndex} aria-controls="offline-map-manual-topic" onChange={event => setTopicIndex(Number(event.target.value))}>{topics.map((item, index) => <option key={item.id} value={index}>{String.fromCharCode(65 + index)}. {item.label}</option>)}</select></label>
      {topics.map((item, index) => <button type="button" key={item.id} aria-current={index === topicIndex ? 'step' : undefined} aria-controls="offline-map-manual-topic" onClick={() => setTopicIndex(index)}><span className="manual-topic-letter">{String.fromCharCode(65 + index)}</span><span>{item.label}</span>{index === topicIndex && <ChevronRight size={16} aria-hidden="true" />}</button>)}
      <div className="manual-topic-note"><Download size={18} aria-hidden="true" /><span>Download and check map detail before fieldwork.</span></div>
    </nav>
    <article className="manual-article" id="offline-map-manual-topic" aria-labelledby="offline-map-manual-heading">
      <header className="manual-article-header"><p className="manual-eyebrow">OFFLINE MAP · {String(topicIndex + 1).padStart(2, '0')} / 07</p><h2 id="offline-map-manual-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
      <div className="manual-topic-content" key={topic.id}><Content Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} /></div>
      <footer className="manual-page-nav" aria-label="Read next or previous Offline Map topic"><button type="button" disabled={topicIndex === 0} onClick={() => setTopicIndex(index => index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{topicIndex < topics.length - 1 ? <button type="button" onClick={() => setTopicIndex(index => index + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => setTopicIndex(0)}>Back to Why Download a Map?<ChevronRight size={16} aria-hidden="true" /></button>}</footer>
    </article>
  </div>;
}
