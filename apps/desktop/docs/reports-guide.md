# Reports guide maintenance

`src/views/ReportsGuide.jsx` supplies six topics: getting started, viewing
recorded data, understanding report contents, printing/exporting, review before
sharing, and troubleshooting. It reuses the existing navigation, instructional
image cards, shared styles and lightbox. `UserManualView.jsx` imports and renders
it instead of the last placeholder; the other four guides are unchanged.

## Sources inspected

- `views/ReportsView.jsx`: database load, grouping, statistics, report rules,
  controls, document markup, inline screen styles and injected print CSS.
- `services/db.js`: `getAllTelemetry` and database access, distinguished from
  the separate database-backup export functions.
- `utils/time.js`: generated date helper; report fields were checked against
  what the JSX actually renders, not merely what the object contains.
- `App.jsx`, `App.css`: Reports navigation and the shared viewport/container.
- `UserManualView.jsx`, `UserManualView.css` and completed subguide patterns.
- Related Field Map Mission Samples and Live Monitoring saved-record controls.
- Searches for PDF/export/print code: the Reports action is `window.print()`;
  no Reports-specific PDF library, native PDF writer or CSV/Excel export exists.

## Actual workflow and limitations

### Loading and selection

`getAllTelemetry` selects all telemetry ordered by timestamp descending. Reports
groups rows by `mission_id`, falling back to one `Unassigned` group. It does not
group by plot or date despite an older source comment. Field metadata comes
from the first row; all rows in a mission group contribute to its statistics.
Unassigned groups can combine different fields or visits. Plot names in the
filter are report labels, not row-level filters.

The All Plots menu filters generated report cards. Its parenthesized count is
the number of reports, not unique plots or samples. After filtering, operators
should click a card and verify the document header: the preview can fall back
to the first filtered or overall report even if the stored selection does not
match a highlighted card.

Reports loads once on mount, has no Refresh button or polling, and rebuilds
summaries on reopening. These are generated summaries, not a saved PDF archive.
There is no reporting-period selector, individual-sample picker, sample table,
GPS-coordinate list, map, chart or direct heatmap link in the report. Source
records can instead be reviewed in Field Map or Live Monitoring.

`getAllTelemetry` catches database errors and returns an empty list. Reports also
sets an error state in a catch but never renders that state. An empty list is
therefore not proof that the database contains no records. The guide does not
invent an error banner, Retry button or hidden recovery control.

### Recorded data and summaries

- Waypoints is `rows.length`; it does not count unique arrivals, verified
  locations or complete/valid soil samples. Reports independently applies no
  GPS-fix, soil-validity, completeness or calibration check.
- Each statistic skips null, undefined, empty-string and nonnumeric values.
  Zero is retained, including upstream fallback zero. With no remaining values,
  min/max/mean return zero instead of an unavailable marker. Parameters can use
  different subsets. The filter is not a full finite/range validation.
- Displayed units: moisture %, pH unitless, EC dS/m, N/P/K mg/kg. No EC conversion
  occurs, while Live Monitoring labels EC uS/cm. Physical/stored units remain
  unresolved and are not fixed by documentation.
- Survey Date is the first space-delimited portion of the first row's timestamp;
  time-only timestamps may remain time-only. Missing timestamps use the source's
  fixed `2026-09-10` fallback. Missing plot/mission assignments get `Plot N` and
  `MSN-00N` labels. Report IDs use list order and a fixed RPT-2026 prefix. These
  are not verified dates, permanent IDs or confirmed mission associations.
- `generatedDate` and `soilTexture` exist on the calculated object but are not
  rendered. The guide does not present them as visible fields.

### Existing report content

The header has title, field, mission, survey-date text, fertility grade and report
ID. Four sections render averages, parameter min/max/mean/status, crop suggestion
cards, and action text. The footer has fixed system/certification wording and
System Generated (SQLite Data) as evaluator. That wording is not evidence of
independent certification.

The preexisting score starts at 70, adds 15 for mean pH 6–7, 10 for mean moisture
30–60, and 5 when mean N/P ≥20 and K ≥30. Grade A starts at 85, otherwise current
reachable values produce Grade B. The Grade C branch requires <65 and is
unreachable under these additions. List/header green styling starts at 80, so
color and grade thresholds differ. No grading functionality was added or changed.

Status rules use means: moisture ≥35 Balanced, otherwise Low; pH 6–7 Optimal,
otherwise Needs Review; N ≥20 Adequate, otherwise Deficient; P ≥20 Optimal,
otherwise Low; K ≥30 Adequate, otherwise Deficient. EC is always Normal. Neither
status colors nor the score independently validate readings.

Crop suggestions use built-in pH/moisture conditions, not Crop Assessment's
editable profiles: rice pH 5.5–6.8 and moisture ≥35; maize pH 5.8–7.2; otherwise
cassava/root crops. The source's 92%, 85% and fallback 70% are fixed display
strings, not measured probabilities or calculated confidence. Action text uses
rules on mean pH, N, K and moisture. The guide explains the provenance without
endorsing treatment or inventing new fertilizer requirements.

### Printing and export

Print / Export PDF calls `window.print()`. Inline print CSS hides surrounding UI,
reveals the single `.printable-document`, requests portrait and 1.5 cm margins,
and removes its scrolling/box styling. It does not generate a PDF file itself,
choose a filename, define a folder, confirm a save or display a path/error. A PDF
destination is conditional on the installed webview/system print support.

The guide instructs operators to review the actual system preview, choose PDF
only if offered, follow its save dialog, and reopen the output themselves. It
makes no promise about default filenames, Downloads folders, printing success,
pagination or native output completeness. There is no Reports CSV/Excel or
batch-export control; database backup is a separate app workflow.

## Genuine screenshots and remaining verification

Six native-app captures/crops under `assets/user-manual/reports/` show the actual
existing database output. Their README records capture coordinates and limits.
The guide labels anomalous values and fallback metadata as unverified rather
than treating them as known field conditions. No records were created or changed,
and no fake chart, report result or PDF was generated.

The installed system print dialog, PDF saving, physical printers and pagination
were not exercised. Sensor calibration, EC units, saved-reading validity,
mission/field assignments, sampling dates and the agronomic validity of report
advice need hardware/source-data or field verification. No functional fix was
made for these existing limitations.

## Validation (2026-10-31)

- `node --test tests/*.test.js`: 21 passed, 0 failed.
- `npm run build`: passed after the final screenshot/caption adjustment. The
  existing JavaScript chunk-size warning remains (over 500 kB).
- Development and production preview checks passed at 1366 × 768, 1024 × 768
  and 800 × 600. Checked all six Reports topics, desktop buttons/compact topic
  selection, heading focus, previous/next/wrap navigation, scrolling and no page
  horizontal overflow. All six images loaded with alt text and original aspect
  ratios; each passed lightbox, zoom, Fit width, Escape and focus restoration.
- Navigation across all five guides passed: Rover 8 topics, Field Map 9,
  Live Monitoring 7, Crop Assessment 7 and Reports 6. No placeholder remained.
  No runtime exceptions occurred, and the guide triggered no print, mission,
  database-write or export action.
- Screenshots of the rendered guide were visually inspected at all three
  sizes, including report content tables and the narrow-window lightbox. The
  header image was narrowed to keep its metadata readable. Browser checks used
  an isolated mocked Tauri bridge, never the real database or rover. Temporary
  test screenshots were not included as documentation assets.
- Diff and baseline comparisons confirmed ReportsView.jsx, services/db.js,
  App.jsx, shared manual CSS and completed subguides were unchanged. Changes
  were limited to the new guide/assets/docs and parent integration. Temporary
  capture/validation scripts were removed. No commit or push was made.
