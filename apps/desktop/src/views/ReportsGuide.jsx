import AnimatedDisclosure from '../components/ui/AnimatedDisclosure';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import overview from '../assets/user-manual/reports/overview.png';
import controls from '../assets/user-manual/reports/page-controls.png';
import reportList from '../assets/user-manual/reports/report-list.png';
import documentHeader from '../assets/user-manual/reports/document-header.png';
import summary from '../assets/user-manual/reports/summary-and-ranges.png';
import advice from '../assets/user-manual/reports/report-advice.png';

const topics = [
  { id: 'start', label: 'Getting Started', summary: 'Open the saved-data summaries and choose a report.' },
  { id: 'records', label: 'Viewing Recorded Data', summary: 'Understand which saved records are included.' },
  { id: 'contents', label: 'Understanding Report Contents', summary: 'Read the averages, status labels and generated advice.' },
  { id: 'export', label: 'Printing and Exporting', summary: 'Review one report, then use the system print options.' },
  { id: 'review', label: 'Before Sharing a Report', summary: 'Check the source data, labels and saved output.' },
  { id: 'help', label: 'Troubleshooting', summary: 'Check missing data, unexpected values and print problems.' },
];

function GettingStarted({ Steps, Notice, instructionalGuide }) {
  return <>
    <p><strong>Agronomic Field Reports</strong> builds summaries from telemetry already saved in the app’s database. Opening this page prepares the available reports automatically.</p>
    <div style={{ width: '100%', maxWidth: 430 }}>{instructionalGuide(reportList, 'Actual Generated Reports list showing one existing saved-data summary', 'Real app capture using existing database records. The displayed values and labels have not been validated as field results.')}</div>
    <Steps items={[
      <>Open <strong>Reports</strong> from the sidebar. Wait for <strong>Processing Database Telemetry Records...</strong> to finish.</>,
      <>Use the <strong>All Plots</strong> menu at the top to show all reports or choose an available plot name.</>,
      <>Click a report card in <strong>Generated Reports</strong>. Check the <strong>Field</strong>, <strong>Mission</strong> and <strong>Survey Date</strong> in the document on the right.</>,
      'Scroll inside the document to review all four sections and the footer before printing or sharing it.',
    ]} />
    <Notice title="Collect and save data first"><p>If <strong>No telemetry data found</strong> appears, check that soil readings have been saved. A planned mission or an empty field does not create report measurements.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"See the full Reports page"}>{instructionalGuide(overview, 'Actual Agronomic Field Reports page with plot filter, print button, report list and document preview', 'Actual interface with existing stored records. Some labels are generated fallbacks and some readings need review; this is not an example of verified soil conditions.')}</AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Choosing a report after filtering"}><p>The menu narrows the report list; it does not choose individual samples or a date range. Click the intended card after filtering and verify the document header, even if a card highlight is unclear. The number beside All Plots is the number of generated reports, not a sample count.</p></AnimatedDisclosure>
  </>;
}

function RecordedData({ Steps, Notice, instructionalGuide }) {
  return <>
    <p>A saved sample is one database record. A report summary combines multiple records into minimum, maximum and average values. Each measurement can use a different number of available readings.</p>
    {instructionalGuide(documentHeader, 'Actual left side of the report header showing its title, field, mission and survey-date text', 'Real header, cropped for readability. Field and mission labels can be generated when assignments are missing, and Survey Date may contain only time text. Verify them against the original records.')}
    <Steps items={[
      'Choose a report, then confirm the field and mission against the records you meant to include.',
      <>Read <strong>Spatial Telemetry &amp; Aggregate Averages</strong>. Its <strong>Waypoints</strong> number counts saved rows in the report group; it does not confirm that the rover reached that many unique waypoints or collected that many complete soil samples.</>,
      <>Use <strong>Parameter Range &amp; Deviation Analysis</strong> to compare the lowest, highest and average available values for each parameter.</>,
      <>For individual readings, sampling times and saved GPS locations, review the original records in <strong>Field Map → Mission Directory → Mission Samples</strong> or the saved-record table in <strong>Live Monitoring</strong>.</>,
    ]} />
    <Notice title="Missing values can appear as zero" caution><p>The summary skips missing, blank and nonnumeric entries for each measurement. If no usable entries remain for that parameter, its minimum, maximum and average are displayed as zero. Stored zeros are included too, even when they came from missing data. Do not treat every displayed zero as a genuine measurement.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"How records are grouped"}><p>Reports groups saved rows by mission ID, not by sampling date or crop profile. Records without a mission ID are combined into one group, even if they came from different visits. The field name comes from the first record in that group, so the plot filter alone cannot prove that every included row belongs to that field.</p></AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Dates and generated identifiers"}><p>The database is read with the latest timestamps first. Survey Date takes the text before the first space in the group’s first timestamp. It is not a start/end reporting period; time-only or missing timestamps can produce incomplete or fallback date text.</p><p>If assignments are missing, the page supplies a Plot name and MSN mission label. Report IDs are generated from list order, not a permanent saved report archive. Check the original mission information before using those labels as references.</p></AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"New samples have just been saved"}><p>Reports reads the database when you open the page. After new data is saved, leave Reports and return to rebuild the summaries. There is no Refresh button or automatic update while the page stays open.</p></AnimatedDisclosure>
  </>;
}

const sections = [
  ['Document header', 'Shows the report title, field, mission, survey-date text, report ID and generated fertility label. Check these against the original records.'],
  ['1. Spatial Telemetry & Aggregate Averages', 'Shows the saved-row count and averages for moisture (%), pH (no unit), EC (displayed dS/m), and N, P and K (mg/kg). These are calculated summaries, not separate sensor readings.'],
  ['2. Parameter Range & Deviation Analysis', 'Lists Min Recorded, Max Recorded, Mean Average and Status Rating for the same six parameters. It shows a range and average, not a statistical deviation chart.'],
  ['3. Agronomical Crop Suitability Forecast', 'Shows crop suggestions selected by built-in pH and moisture rules. The displayed Viable percentages are fixed labels for those suggestions, not measured probabilities of crop success.'],
  ['4. Prescriptive Action Plan & Field Amendments', 'Shows text selected from built-in rules using the group’s averages. Have the source readings and advice reviewed before deciding on soil treatment.'],
  ['Document footer', 'Shows system text and Evaluated by: System Generated (SQLite Data). The wording Certified Autonomous Spatial Survey is fixed text; it does not establish independent laboratory or field certification.'],
];

function ReportContents({ Notice, instructionalGuide }) {
  return <>
    {instructionalGuide(summary, 'Actual report average cards and parameter table showing minimum, maximum, mean and status columns', 'Real stored-data summary. The screenshot includes unusual values; a green status label does not validate them. These numbers are not recommended ranges or performance figures.')}
    <div className="manual-table-wrap" role="region" aria-label="Sections in the Reports document" tabIndex={0}><table className="manual-table"><caption>What each part contains</caption><thead><tr><th scope="col">Part</th><th scope="col">How to read it</th></tr></thead><tbody>{sections.map(([title, text]) => <tr key={title}><th scope="row">{title}</th><td>{text}</td></tr>)}</tbody></table></div>
    <Notice title="A status label is not a sensor-validity check" caution><p>For example, EC is always labeled <strong>Normal</strong> in this report, regardless of its value. Reports displays EC as <strong>dS/m</strong>, while Live Monitoring displays <strong>uS/cm</strong>; the report applies no unit conversion. Confirm the sensor and stored units before sharing the result.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"How the existing fertility label is calculated"}><p>The report starts at 70 points. It adds 15 for mean pH from 6.0 to 7.0, 10 for mean moisture from 30% to 60%, and 5 when mean N and P are at least 20 mg/kg and K at least 30 mg/kg. These are the app’s rules, not new agricultural target values supplied by this guide.</p><p>The list shows the score out of 100. The current rules produce Grade A at 85 or above and Grade B below that. A green list badge starts at 80, so its color does not always mean Grade A. This calculation does not check that every record has complete, valid measurements.</p></AnimatedDisclosure>
    <AnimatedDisclosure className="manual-details" title={"Crop suggestions and action text"}>
      {instructionalGuide(advice, 'Actual report crop suggestions and action-plan sections generated from existing stored averages', 'Existing report output. Viable percentages are fixed app labels, and action text comes from rules. Neither is a verified forecast or treatment plan.')}
      <p>Reports uses its own built-in rules. It does not use the crop profile selected in Crop Assessment, so the two pages can show different summaries. Review the data and units with the project team or an agricultural technician before acting on the advice.</p>
    </AnimatedDisclosure>
  </>;
}

function Printing({ Steps, Notice, instructionalGuide }) {
  return <>
    <div style={{ width: '100%', maxWidth: 560 }}>{instructionalGuide(controls, 'Actual All Plots menu beside the Print / Export PDF button', 'These are the actual report selection and output controls. The button opens the system print flow; it does not silently create a PDF file.')}</div>
    <Steps items={[
      <>Choose a plot in <strong>All Plots</strong>, then click the intended report in <strong>Generated Reports</strong>.</>,
      'Review the document on the right, including the header, all four sections and the footer. This is the report preview; no separate Generate button is needed.',
      <>Click <strong>Print / Export PDF</strong> to request the system print dialog.</>,
      <>If the dialog offers a PDF destination, select it, check the print preview, then follow its save steps. Choose a filename and location if prompted. For paper output, select your printer and review the pages before printing.</>,
      'After saving a PDF, open the file from the location you chose. Check that the intended report and all sections are present before sharing it.',
    ]} />
    <Notice title="Confirm the output yourself"><p>Reports does not show an export-success message or a saved-file path. Closing the print dialog is not proof that a PDF was saved. Canceling the dialog does not create a file.</p></Notice>
    <AnimatedDisclosure className="manual-details" title={"Print options and page layout"}><p>The app requests portrait printing and hides the surrounding interface so that the selected report document is printed. The installed webview, print dialog and printer decide the available destinations and settings. Review the actual preview for clipped text, missing sections or blank pages; correct output has not been confirmed for every printer.</p></AnimatedDisclosure>
  </>;
}

function BeforeSharing({ Notice }) {
  return <>
    <div className="manual-inset"><h3><ClipboardCheck size={18} aria-hidden="true" /> Review before sharing</h3><ol className="manual-steps">
      <li><strong>Field and mission:</strong> confirm the document header against the original records. Check whether any labels are generated fallbacks or mixed unassigned records.</li>
      <li><strong>Sampling date:</strong> verify the original sampling timestamps. Do not use a time-only or fallback Survey Date as a confirmed survey date.</li>
      <li><strong>Record count:</strong> compare the report’s Waypoints count with the saved rows you expect. It is not a count of complete measurements for every parameter.</li>
      <li><strong>Sensor readings:</strong> review unusual minimums, maximums and zeros in the original records. Check missing information and sensor validity.</li>
      <li><strong>Units:</strong> check moisture %, unitless pH, EC and N/P/K mg/kg. Resolve the EC unit difference before interpreting its magnitude.</li>
      <li><strong>Calculated text:</strong> identify averages, fertility labels, crop percentages and action text as app-generated summaries.</li>
      <li><strong>Saved or printed copy:</strong> check every page for the correct report, readable tables, complete sections and the footer.</li>
    </ol></div>
    <Notice title="Share with the source-data limits"><p>The report summarizes stored information. It does not automatically confirm laboratory-level accuracy, complete soil readings, crop success or an independently certified survey. Explain unresolved data issues when sharing it.</p></Notice>
  </>;
}

const problems = [
  ['No reports appear', 'Choose All Plots and check whether telemetry was saved. If records exist elsewhere but Reports remains empty, leave the page and reopen it. Database-load failures can also appear as an empty list; ask the project team to check loading if the problem continues.'],
  ['The field or mission looks wrong', 'Click the intended report after filtering and verify its header against the original records. Rows without mission IDs are grouped together, and missing assignments get generated labels. There is no date-range or individual-sample filter on this page.'],
  ['Measurements are zero or missing', 'Review the original sample. A parameter with no usable readings is summarized as zero, and stored zero values can also be included. Do not assume these are valid zero measurements or change readings to make the report look complete.'],
  ['The report has unexpected values or a reassuring status', 'Compare the original readings, units and sensor validity. Averages can hide unusual individual values. The EC Normal status is fixed, and the fertility label is rule-based; neither validates the measurements.'],
  ['The report does not include new samples', 'Wait for the records to be saved, then leave Reports and open it again. The page loads once per visit and has no Refresh control or live update.'],
  ['Print / Export PDF does not open a usable dialog', 'Check for a print window belonging to the app and read any system message. Cancel if necessary, reselect and review the report, then try again. If no print options appear, ask the project team to check printing support in the installed webview. The app has no separate PDF-generation error or retry control.'],
  ['The print preview or saved report is incomplete', 'Review all sections in the app and all pages in the system print preview. Check the available page settings for clipping. Do not share the output until the selected report is complete; unresolved layout problems need a project-team check.'],
  ['The exported PDF cannot be found', 'Check the location and filename chosen in the print/save dialog. Reports does not define a default folder or display the saved path. If you canceled or selected a physical printer, a PDF may not have been created.'],
];

function Troubleshooting({ Notice }) {
  return <>
    <div className="manual-troubleshooting">{problems.map(([problem, solution]) => <AnimatedDisclosure className="manual-details" key={problem} title={problem}><p>{solution}</p></AnimatedDisclosure>)}</div>
    <Notice title="Use the original records to resolve questions"><p>Keep the source data unchanged while checking a report. Ask the project team to verify unexplained units, invalid readings, mixed assignments or print problems.</p></Notice>
    <p className="manual-muted">Sensor calibration, report advice and physical field conditions still need validation. Actual PDF saving and printer output also depend on the installed system print support.</p>
  </>;
}

const content = [GettingStarted, RecordedData, ReportContents, Printing, BeforeSharing, Troubleshooting];

export default function ReportsGuide({ Steps, Notice, instructionalGuide }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const headingRef = useRef(null);
  const topic = topics[topicIndex];
  const Content = content[topicIndex];
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [topicIndex]);

  return <div className="manual-layout reports-manual">
    <nav className="manual-topic-nav" aria-label="Reports guide topics">
      <p className="manual-eyebrow">REPORTS GUIDE</p>
      <label className="manual-topic-select">Reports topic<select value={topicIndex} aria-controls="reports-manual-topic" onChange={event => setTopicIndex(Number(event.target.value))}>{topics.map((item, index) => <option key={item.id} value={index}>{String.fromCharCode(65 + index)}. {item.label}</option>)}</select></label>
      {topics.map((item, index) => <button type="button" key={item.id} aria-current={index === topicIndex ? 'step' : undefined} aria-controls="reports-manual-topic" onClick={() => setTopicIndex(index)}><span className="manual-topic-letter">{String.fromCharCode(65 + index)}</span><span>{item.label}</span>{index === topicIndex && <ChevronRight size={16} aria-hidden="true" />}</button>)}
      <div className="manual-topic-note"><ClipboardCheck size={18} aria-hidden="true" /><span>Check the source records and saved output before sharing.</span></div>
    </nav>
    <article className="manual-article" id="reports-manual-topic" aria-labelledby="reports-manual-heading">
      <header className="manual-article-header"><p className="manual-eyebrow">REPORTS · {String(topicIndex + 1).padStart(2, '0')} / 06</p><h2 id="reports-manual-heading" tabIndex={-1} ref={headingRef}>{topic.label}</h2><p>{topic.summary}</p></header>
      <div className="manual-topic-content" key={topic.id}><Content Steps={Steps} Notice={Notice} instructionalGuide={instructionalGuide} /></div>
      <footer className="manual-page-nav" aria-label="Read next or previous Reports topic"><button type="button" disabled={topicIndex === 0} onClick={() => setTopicIndex(index => index - 1)}><ChevronLeft size={16} aria-hidden="true" /> Previous</button>{topicIndex < topics.length - 1 ? <button type="button" onClick={() => setTopicIndex(index => index + 1)}>Next: {topics[topicIndex + 1].label}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" onClick={() => setTopicIndex(0)}>Back to Getting Started<ChevronRight size={16} aria-hidden="true" /></button>}</footer>
    </article>
  </div>;
}
