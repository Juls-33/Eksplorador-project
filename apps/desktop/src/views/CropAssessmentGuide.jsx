import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import overview from '../assets/user-manual/crop-assessment/overview.png';
import matrix from '../assets/user-manual/crop-assessment/crop-matrix.png';
import plots from '../assets/user-manual/crop-assessment/profile-and-plots.png';
import thresholds from '../assets/user-manual/crop-assessment/threshold-rules.png';
import emptyHeatmap from '../assets/user-manual/crop-assessment/no-data-heatmap.png';
import controls from '../assets/user-manual/crop-assessment/page-controls.png';

const topics = [
  { id: 'start', label: 'Getting Started', summary: 'Choose a crop profile and recorded plot to review.' },
  { id: 'measurements', label: 'Understanding Soil Measurements', summary: 'Read the six parameters and the units used on this page.' },
  { id: 'health', label: 'Soil Health and Suitability', summary: 'Understand what the calculated sample comparison means.' },
  { id: 'crops', label: 'Comparing Crop Profiles', summary: 'Compare saved crop requirements without assuming a crop ranking.' },
  { id: 'heatmap', label: 'Heatmaps and Field Conditions', summary: 'Read the suitability colors and their limits.' },
  { id: 'records', label: 'Working With Recorded Samples', summary: 'Check the data source, missing readings and update behavior.' },
  { id: 'help', label: 'Troubleshooting', summary: 'Resolve common no-data and interpretation problems.' },
];

const categories = [
  { name: 'Suitable', color: '#15803d', colorName: 'Green', rule: 'None of the checked parameters is outside the selected profile’s ranges.', legend: 'All parameters in range' },
  { name: 'Marginal', color: '#eab308', colorName: 'Yellow', rule: 'Exactly one checked parameter is outside its range.', legend: 'One parameter out of range' },
  { name: 'Unsuitable', color: '#dc2626', colorName: 'Red', rule: 'Two or more checked parameters are outside their ranges.', legend: 'Two or more out of range' },
];

function GettingStarted({ Steps, Notice, instructionalGuide }) {
  return <>
    <p><strong>Crop Suitability &amp; Threshold Assessment</strong> compares recorded soil samples with a crop profile’s saved minimum and maximum values. A profile describes comparison rules; it is not a measured soil result.</p>
    {instructionalGuide(plots, 'Actual selected crop profile showing Recorded field plots and the no-plots message', 'Actual app capture with a saved profile but no recorded plots. A visible crop profile does not mean a soil assessment is available.')}
    <Steps items={[
      <>Open <strong>Crop Assessment</strong> from the sidebar.</>,
      <>Choose a profile in <strong>Assessed Crops Matrix</strong>. Use <strong>All Crop Types</strong> or a category to narrow the list.</>,
      <>Under <strong>Recorded field plots</strong>, choose the plot to review. Its number shows the saved record count for that plot name.</>,
      <>Review <strong>Agronomic Threshold Range Rules</strong>, then scroll the right column to <strong>Field Suitability Heatmap</strong>.</>,
      'Check the selected crop and plot names above the map before interpreting any results.',
    ]} />
    <Notice title="Collect soil data first"><p>If <strong>No plots recorded yet</strong> appears, collect and save soil samples through the normal rover workflow in Field Map. Creating a field, placing pins or adding a crop profile does not create soil measurements.</p></Notice>
    <details className="manual-details"><summary>See the full Crop Assessment screen</summary>{instructionalGuide(overview, 'Actual Crop Assessment screen with saved profiles, the selected crop, threshold cards and an empty heatmap state', 'Real app capture. The displayed numbers are existing profile limits, not measured soil values. No plot, scored result or crop recommendation was fabricated.')}</details>
    <details className="manual-details"><summary>Plot or sampling session?</summary><p>This page groups stored samples by their <strong>plot name</strong>. It has no mission, date or sampling-session selector. Records from different visits with the same plot name may be assessed together. For a specific mission, review Mission Samples in Field Map.</p></details>
  </>;
}

const measurements = [
  ['pH', 'No physical unit', 'Shows how acidic or alkaline the soil reading is.'],
  ['Moisture', '%', 'The reported soil moisture percentage.'],
  ['EC', 'dS/m', 'Electrical conductivity: how easily current passes through the measured soil. Dissolved ions and salts can affect it.'],
  ['Nitrogen (N)', 'mg/kg', 'A reported nutrient amount related to plant growth.'],
  ['Phosphorus (P)', 'mg/kg', 'A reported nutrient amount involved in root development and other plant functions.'],
  ['Potassium (K)', 'mg/kg', 'A reported nutrient amount involved in water regulation and plant health.'],
];

function Measurements({ Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(thresholds, 'Actual Agronomic Threshold Range Rules showing saved pH, moisture, EC, nitrogen, phosphorus and potassium limits', 'Existing selected-profile settings. These are comparison limits, not measurements or universal ideal values for every farm.')}
    <div className="manual-table-wrap" role="region" aria-label="Crop Assessment soil parameters and units" tabIndex={0}><table className="manual-table"><caption>Parameters used by this assessment</caption><thead><tr><th scope="col">Parameter</th><th scope="col">Displayed unit</th><th scope="col">Meaning</th></tr></thead><tbody>{measurements.map(([name, unit, meaning]) => <tr key={name}><th scope="row">{name}</th><td>{unit}</td><td>{meaning}</td></tr>)}</tbody></table></div>
    <Notice title="Check EC units before comparing results" caution><p>This page labels EC as <strong>dS/m</strong>; Live Monitoring labels it <strong>uS/cm</strong>. Crop Assessment compares stored numbers directly with profile limits. Do not assume that a unit conversion has already been applied. Ask the project team to confirm the sensor’s output and stored units.</p></Notice>
    <p className="manual-muted">Salinity and soil temperature are not displayed or checked by this page. EC is not a separate salinity measurement here. The guide does not supply new crop ranges or fertilizer requirements.</p>
  </>;
}

function Suitability({ Steps, Notice }) {
  return <>
    <Notice title="A crop-specific comparison, not an overall soil-health score"><p>This page has no separate <strong>0–100 overall soil-health score</strong>. Its percentage shows the share of scored samples that match the selected crop profile’s available checks. It is a project calculation, not a laboratory-certified result.</p></Notice>
    <Steps items={[
      'For each sample, the app compares available pH, moisture, EC, N, P and K values with the selected profile’s minimum and maximum. Values exactly on either limit are counted as in range.',
      'It counts how many checked parameters are outside their ranges and assigns the sample to a suitability category.',
      <>It displays <strong>“% of … samples are fully suitable”</strong> and the suitable, marginal and unsuitable sample counts above the heatmap when scored samples are available.</>,
    ]} />
    <div className="manual-table-wrap" role="region" aria-label="Existing sample suitability categories" tabIndex={0}><table className="manual-table"><caption>How samples are counted</caption><thead><tr><th scope="col">Category</th><th scope="col">Verified rule</th></tr></thead><tbody>{categories.map(item => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.rule}</td></tr>)}</tbody></table></div>
    <div className="manual-inset"><h3>How the percentage is calculated</h3><p>Suitable samples ÷ all scored samples × 100, rounded to a whole percent.</p><p>It is a share of <strong>sample records</strong>, not the percentage of field area, expected yield or probability that a crop will succeed.</p></div>
    <Notice title="Missing checks can make a result look more complete than it is" caution><p>Missing values and unavailable ranges are skipped; they are not counted as failures. A record with just one checked value in range can be counted as suitable even if other measurements are missing. Read the original sample data before relying on the summary.</p></Notice>
    <details className="manual-details"><summary>What does Most often out of range mean?</summary><p>This text lists parameters that fell outside the profile limits, ordered by how often they did so among scored samples. It does not say whether a value was too high or too low, and it does not prescribe a treatment or fertilizer amount.</p></details>
  </>;
}

function CompareProfiles({ Steps, Notice, instructionalGuide }) {
  return <>
    <p><strong>Assessed Crops Matrix</strong> is a list of saved crop profiles. It is not an automatically ranked list of recommended crops. This version compares the crop you select with the recorded plot you select.</p>
    <div style={{ width: '100%', maxWidth: 460 }}>{instructionalGuide(matrix, 'Actual portion of Assessed Crops Matrix showing saved crop profile names and categories', 'Real saved-profile list, cropped for readability. Names and profile counts may differ in your database. List order is not a suitability ranking.')}</div>
    <Steps items={[
      'Choose a recorded plot, then click a crop profile in the left column.',
      'Check the crop name, plot name, saved threshold ranges and available suitability results.',
      'Choose another crop while keeping the same plot. Compare the results and out-of-range parameters for that plot.',
      <>After changing the category filter, click the intended profile and recheck its name on the right. Filtering the list alone does not select a different crop. Use <strong>All Crop Types</strong> to find a profile hidden by a category.</>,
    ]} />
    <Notice title="No automatic best-crop suggestion is provided"><p>If you cannot find a recommendation list, you are not missing a recommendation button. Use the current profile comparisons as guidance. The app does not provide crop grades, yield predictions or a guarantee of crop performance.</p></Notice>
    <details className="manual-details"><summary>No results for the crop I selected</summary><p>Check for a selected recorded plot, usable sample locations, available measurements and saved profile limits. If no samples can be scored, the map area shows a no-data message rather than a suitability percentage. Do not change sensor values or ranges just to make the result look better.</p></details>
  </>;
}

function Heatmaps({ Steps, Notice, instructionalGuide }) {
  return <>
    <Steps items={[
      'Choose the crop profile and a recorded plot on Crop Assessment.',
      <>Scroll the right column to <strong>Field Suitability Heatmap</strong>. If there are no scored samples, read the no-data message instead of expecting colored results.</>,
      'When a map is available, drag or zoom it and read the legend. The result uses the checked parameters for the selected crop.',
      'Review the original sample values and their locations before interpreting a large colored area.',
    ]} />
    {instructionalGuide(emptyHeatmap, 'Actual Field Suitability Heatmap empty state asking the operator to select a recorded plot', 'Actual no-plot capture. A scored map was not generated for this guide. The reference legend below explains the source-code rules, not a fabricated field result.')}
    <div className="manual-table-wrap" role="region" aria-label="Reference legend for Crop Assessment heatmaps" tabIndex={0}><table className="manual-table"><caption>Reference legend — explains the interface, not a field result</caption><thead><tr><th scope="col">Color</th><th scope="col">App legend</th><th scope="col">Interpretation</th></tr></thead><tbody>{categories.map(item => <tr key={item.name}><th scope="row"><span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: item.color, marginRight: 7 }} />{item.colorName}</th><td>{item.legend}</td><td>{item.rule}</td></tr>)}</tbody></table></div>
    <Notice title="Colors between samples are estimates" caution><p>The map blends sample suitability values between recorded locations. It does not take a direct sensor measurement at every colored spot. “All parameters in range” means all parameters that could be checked; it does not prove that every sample contains all six readings.</p></Notice>
    <details className="manual-details"><summary>Map extent and limited sampling</summary><p>The displayed outline is built around the scored sample locations, with a padded box used when needed. It is not the saved Field Map boundary. Few, clustered or widely separated samples can leave parts of a real field poorly represented. One eligible sample can produce a summary; that does not establish whole-field coverage.</p><p>This suitability map does not show a live rover marker, Follow Rover control or individual sample-pin toggle.</p></details>
    <details className="manual-details"><summary>View individual soil parameters</summary><p>This page has no pH, moisture or NPK layer selector: its map combines the crop’s available parameter checks. Open <strong>Field Map</strong> separately from the sidebar for that page’s soil layers and mission samples. Crop Assessment has no direct Field Map heatmap link button. The legends and calculations on the two pages are different.</p></details>
  </>;
}

function Records({ Steps, Notice, instructionalGuide }) {
  return <>
    <Steps items={[
      <>Use the number on each <strong>Recorded field plots</strong> button to see how many saved records have that plot name.</>,
      'Check the scored sample count above the map when results are available. It can be lower than the plot-button count because not every stored record can be scored.',
      <>For original values, open <strong>Field Map → Mission Directory → Mission Samples</strong> for the relevant mission. Crop Assessment itself has no raw-sample table or session/date filter.</>,
      'After collecting more data, allow it to be saved, then leave Crop Assessment and open it again to reload the profile and plot lists.',
    ]} />
    <section><h3>What is checked or skipped?</h3><div className="manual-table-wrap" role="region" aria-label="Missing and invalid data in crop assessment" tabIndex={0}><table className="manual-table"><thead><tr><th scope="col">Data condition</th><th scope="col">Current behavior</th></tr></thead><tbody>
      <tr><th scope="row">Missing measurement or profile limit</th><td>The parameter is skipped. It does not automatically make the sample fail.</td></tr>
      <tr><th scope="row">Value cannot be read as a finite number</th><td>That measurement is skipped.</td></tr>
      <tr><th scope="row">No parameter can be checked, or location cannot be used by the calculation</th><td>The record is left out of the scored total. A record needs at least one checked parameter and numeric location.</td></tr>
      <tr><th scope="row">A stored zero</th><td>Zero is checked as a number, not automatically treated as missing. Some missing readings may already have been saved as zero. Blank text may also be read as zero. Confirm the original sensor data before treating it as a genuine measurement.</td></tr>
    </tbody></table></div></section>
    <Notice title="The assessment does not recheck a live sensor"><p>It uses saved records. It does not independently confirm a fresh GPS fix, current probe contact or sensor calibration. A large plot count or high suitable-sample percentage is not proof of complete, valid measurements.</p></Notice>
    <details className="manual-details"><summary>Refresh and update behavior</summary><p>There is no Refresh button or automatic polling on this page. Selecting a different plot loads its saved samples. Selecting another crop recalculates against the samples already loaded; it does not fetch newly saved samples for the same plot. Reopen the page to reload the lists and current samples.</p></details>
    <details className="manual-details"><summary>Crop profile controls</summary>
      <div style={{ width: '100%', maxWidth: 540 }}>{instructionalGuide(controls, 'Actual All Crop Types filter and Add Crop Profile button', 'Actual controls. Profile editing changes comparison rules; it does not create or edit recorded sensor measurements.')}</div>
      <Steps items={[
        <>Use <strong>Add Crop Profile</strong> to open a new profile, or the pencil titled <strong>Edit Crop Thresholds</strong> for the selected profile.</>,
        <>Enter the <strong>Crop Name</strong>, category and minimum/maximum for all six parameters. Use verified ranges for the project. Each minimum must be lower than its maximum.</>,
        <>Add optional <strong>Limiting Factor / Notes</strong>, then choose <strong>Save Profile</strong>, or <strong>Cancel</strong> to leave the form without saving.</>,
      ]} />
      <p>The form checks that a name is present and that each range has valid numbers in the correct order. That check does not establish agricultural suitability. The trash button titled <strong>Delete Crop Profile</strong> removes that profile without a separate confirmation dialog; use it carefully. It is not a filter or a way to clear the map.</p>
      <p>Legume is available in the profile form but not as a separate top category filter. Use All Crop Types to find those profiles.</p>
    </details>
  </>;
}

const problems = [
  ['No soil assessment is available', 'Check for a selected crop and a recorded plot. Fields and pins alone are not samples. If there are no plots, save soil readings through the normal Field Map workflow, then reopen Crop Assessment.'],
  ['No crop suggestions or rankings appear', 'This version compares a crop profile you select; it does not generate a ranked recommendation list. Check the selected crop and plot, their data and the no-data message.'],
  ['A crop profile is missing from the list', 'Choose All Crop Types, then select the intended profile. If the matrix is still empty, profiles may be absent or database loading may have failed. Ask the project team to check loading rather than assuming the field has no suitable crop.'],
  ['The map says there are no scored samples', 'Check saved locations, available numeric measurements and the profile’s limits. The plot-button count includes records that may not qualify for scoring. Do not change readings or bypass checks to force a result.'],
  ['The result looks suitable even with incomplete data', 'Missing parameters are skipped. Review the original sample records and profile limits; suitable means no available check failed, not that all six readings were present and verified.'],
  ['Soil values or EC comparisons look unexpected', 'Review the original records, sensor validity, calibration and units. EC is labeled dS/m here and uS/cm in Live Monitoring; do not assume an automatic conversion. A zero is not always a measured value.'],
  ['The heatmap has limited information', 'Check how many samples can be scored and where they were recorded. Colored areas between points are estimates, and the generated outline is not a surveyed field boundary.'],
  ['The assessment does not update after sampling', 'Wait for new records to be saved, then leave this page and return. It has no automatic refresh. Changing the crop alone reuses the loaded samples.'],
  ['A crop profile will not save', 'Enter a crop name and a numeric minimum and maximum for each parameter. Each minimum must be lower than its maximum. Read the form’s error message; a database-save error needs a different check from a range-entry error.'],
];

function Troubleshooting({ Notice }) {
  return <>
    <Notice title="Review the records before acting"><p>Use these comparisons as project guidance. They are not laboratory certification, crop grades, fertilizer instructions or yield predictions. Do not alter measured values to obtain a preferred result.</p></Notice>
    <div className="manual-troubleshooting">{problems.map(([problem, solution]) => <details className="manual-details" key={problem}><summary>{problem}</summary><p>{solution}</p></details>)}</div>
    <p className="manual-muted">Actual sensor units, calibration, sample quality and the agricultural validity of stored crop limits still need verification outside this documentation task.</p>
  </>;
}

const content = [GettingStarted, Measurements, Suitability, CompareProfiles, Heatmaps, Records, Troubleshooting];

export default function CropAssessmentGuide({ Steps, Notice, instructionalGuide }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const headingRef = useRef(null);
  const topic = topics[topicIndex];
  const Content = content[topicIndex];
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [topicIndex]);

  return <div className="manual-layout crop-assessment-manual">
    <nav className="manual-topic-nav" aria-label="Crop Assessment guide topics">
      <p className="manual-eyebrow">CROP ASSESSMENT GUIDE</p>
      <label className="manual-topic-select">Crop Assessment topic<select value={topicIndex} aria-controls="crop-manual-topic" onChange={event => setTopicIndex(Number(event.target.value))}>{topics.map((item, index) => <option key={item.id} value={index}>{String.fromCharCode(65 + index)}. {item.label}</option>)}</select></label>
      {topics.map((item, index) => <button type="button" key={item.id} aria-current={index === topicIndex ? 'step' : undefined} aria-controls="crop-manual-topic" onClick={() => setTopicIndex(index)}><span className="manual-topic-letter">{String.fromCharCode(65 + index)}</span><span>{item.label}</span>{index === topicIndex && <ChevronRight size={16} aria-hidden="true" />}</button>)}
      <div className="manual-topic-note"><ShieldCheck size={18} aria-hidden="true" /><span>Check the crop, plot, units and source records before interpreting results.</span></div>
    </nav>
    <article className="manual-article" id="crop-manual-topic" aria-labelledby="crop-manual-heading">
      <header className="manual-article-header"><p className="manual-eyebrow">CROP ASSESSMENT · {String(topicIndex + 1).padStart(2, '0')} / 07</p><h2 id="crop-manual-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
      <div className="manual-topic-content" key={topic.id}><Content Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} /></div>
      <footer className="manual-page-nav" aria-label="Read next or previous Crop Assessment topic"><button type="button" disabled={topicIndex === 0} onClick={() => setTopicIndex(index => index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{topicIndex < topics.length - 1 ? <button type="button" onClick={() => setTopicIndex(index => index + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => setTopicIndex(0)}>Back to Getting Started<ChevronRight size={16} aria-hidden="true" /></button>}</footer>
    </article>
  </div>;
}
