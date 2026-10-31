# Crop Assessment guide maintenance

`src/views/CropAssessmentGuide.jsx` supplies seven topics to User Manual:
getting started, soil measurements, soil health and suitability, comparing crop
profiles, heatmaps, recorded samples and troubleshooting. It uses the existing
manual navigation, styles, instructional images and lightbox. The parent change
only imports and renders the new guide for `guideId === 'crops'`.

## Source verification

Reviewed `UserManualView.jsx`, `UserManualView.css`, `CropAssessmentView.jsx`,
the crop/profile and plot/sample queries in `services/db.js`, and shared
`components/HeatmapMap.jsx` / `utils/geo.js`. Related Field Map mission-sample
and Live Monitoring EC labels were checked for the described cross-page steps.
No assessment, database, telemetry, map or firmware code was changed.

### Selection and recorded data

- Assessed Crops Matrix lists saved profiles; it does not rank recommendations.
  A category filter does not change the selected crop. All Crop Types reveals
  profiles hidden by the filter. Legume exists in the form but has no dedicated
  top category filter.
- `fetchRecordedPlots` groups all telemetry rows with a nonempty plot name by
  that name. The page has no session, mission or date filter. The button's raw
  record count can exceed the assessment's scored count.
- `fetchPlotSamples` loads the selected plot's stored records with non-null
  latitude and longitude. The page loads lists on mount and samples when the
  plot changes. Changing a crop only recalculates the loaded records. There is
  no Refresh button or automatic polling; leaving and reopening reloads data.
- The page has no raw-sample table. For mission-specific original records, the
  guide refers to Field Map / Mission Directory / Mission Samples. This is
  separate navigation, not a direct link on Crop Assessment.

### Existing calculation

- Six checks: pH (unitless), moisture (%), EC (displayed dS/m), and N/P/K
  (displayed mg/kg). Threshold cards contain profile rules, not soil readings.
- `evaluateSample` skips null/undefined measurements, missing limits and
  measurements that cannot be converted to finite numbers. Endpoints are in
  range. Zero is checked; blank text can convert to zero, and upstream storage
  can already have substituted zero for absent values.
- At least one checked parameter and a numeric location qualifies a record
  for the scored total. No fresh GPS, soil-validity or complete-six-readings
  requirement is independently applied by this page.
- No failed checks: suitable, heat intensity 1. One: marginal, intensity 0.6.
  Two or more: unsuitable, intensity 0.25. Percentage is suitable/scored × 100,
  rounded; it is a proportion of records, not field area, yield or confidence.
  Missing checks can make incomplete samples appear suitable.
- Most often out of range tallies failed checks across scored records. It does
  not distinguish above/below range or prescribe fertilizer.
- The actual legend is green #15803d / All parameters in range, yellow #eab308 /
  One parameter out of range, red #dc2626 / Two or more out of range. Colors
  between samples are spatial estimates. The clipping polygon is a convex hull
  of scored sample locations, or a padded box when needed, not a surveyed or
  saved Field Map boundary. No minimum sample count establishes field coverage.
- This map disables the live rover and Follow Rover control. There is no
  individual sample-pin toggle or per-parameter soil-layer selector here.

### Profile controls

The guide describes the existing Add, pencil/Edit, Save, Cancel and trash/Delete
controls. Save requires a nonempty name and finite min/max pairs with min < max;
this is input validation, not agricultural validation. Delete has no separate
confirmation. No profile was created, saved, edited or deleted for this task.

## Real images and verification limits

Six genuine native-app images are under `assets/user-manual/crop-assessment/`;
their README records capture provenance and crop coordinates. The database had
no recorded plots. Populated sample summaries and heatmaps could therefore be
verified in source, but not demonstrated with genuine recorded data. No fake
records, chart values, sensor readings or recommendations were introduced.

EC is labeled dS/m on Crop Assessment and uS/cm on Live Monitoring. The crop
comparison performs no conversion. Actual sensor output, stored units,
calibration, valid zero readings, sample quality and the agricultural validity
of saved crop limits need physical/project verification. They were not resolved
by changing functional code or prescribing new thresholds.

Unsupported features deliberately not presented as available: a separate
0–100 overall soil-health score, crop grades, an automatic best-crop ranking,
yield predictions, fertilizer requirements, salinity/temperature assessment,
session filtering, a refresh control and direct Field Map heatmap links.
The guide documents the existing sample suitability percentage and categories
without reintroducing crop grading functionality.

## Validation (2026-10-31)

- `node --test tests/*.test.js`: 21 passed, 0 failed.
- `npm run build`: passed. The existing JavaScript chunk-size warning remains
  (bundle over 500 kB).
- Headless Chrome checks passed against both development and production preview
  at 1366 × 768, 1024 × 768 and 800 × 600. All seven topics, compact selection,
  heading focus, previous/next/wrap navigation and scrolling were checked.
  All six images loaded with alt text and preserved proportions. Each image's
  lightbox, zoom, Fit width, Escape and focus restoration passed in each mode.
  Existing guides remained accessible; Reports remained the sole placeholder.
  No runtime exceptions or mission commands occurred in these checks.
- Rendered screenshots were visually inspected at all three sizes, including
  the narrow-window lightbox. The browser checks used an isolated mocked Tauri
  bridge; these temporary validation screenshots are not manual assets.
- Native-app capture used the real database and real Crop Assessment empty
  state. Populated results and physical sensor behavior were not tested.
- Reviewed Git diff and baseline comparisons. App.jsx, CropAssessmentView.jsx,
  services/db.js, shared manual CSS and the completed Field Map/Live Monitoring
  guides are unchanged from the start of this task. The UserManualView.jsx
  delta is one import and the new rendering branch. No commit or push was made.
