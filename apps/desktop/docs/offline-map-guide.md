# Offline Map guide maintenance

`src/views/OfflineMapGuide.jsx` adds the sixth manual guide and seven topics:
why download, location search, drawing boundaries, naming/estimates, downloading,
opening saved maps offline, and troubleshooting. It reuses the numbered steps,
notices, topic buttons/select, previous/next navigation, image cards and lightbox.
The desktop guide navigation now has six columns; the existing three-, two-
and one-column responsive rules remain in use. Other completed guide content
and the actual downloader are unchanged.

## Sources checked

- `views/TileManagerView.jsx`: labels, form defaults/validation, rectangle
  preview, pin correction, estimate/download enablement, large-download
  confirmation, progress, completion/failure/cancellation and Covered Areas.
- `components/HeatmapMap.jsx`: map clicks, zoom limits, supported region,
  search/results, saved-area selector, coverage-list loading and tile fallback.
- `services/placeSearch.js`: explicit-submit search, minimum query length,
  Philippine results and network dependency.
- `services/tileStorage.js`: estimate formula, file paths, manifests,
  saved-tile reuse, retry/cancel behavior and session-level download job.
- `utils/tileMath.js`: rectangular tile ranges for each selected zoom level.
- `hooks/useDownloadJob.js`, `App.jsx`: job subscriptions, sidebar labels and
  download progress; Field Map and Live Monitoring map integration.
- Existing UserManualView.jsx/.css and completed subguide patterns.

## Actual workflow and limitations

- Open **Offline Maps → Download a New Area**. Search uses **Search a place or
  landmark**, **Go** or Enter and at least three characters. It needs internet;
  results are filtered to the map region from Nueva Ecija to Batangas.
- Map clicks already add corners. There is no separate drawing tool or Finish
  button. Two opposite points with nonzero width and height suffice. The
  download uses the rectangular envelope of all points, not a field polygon.
  **Undo last pin**, **Remove a pin**, **Done removing** and **Clear all** are
  supported. Pins are removed and replaced, not dragged. This does not create
  Field Map fields, waypoints or missions.
- **Area name** is required. Coordinates can be entered directly. South must
  be less than North, West less than East, and Min zoom no greater than Max
  zoom. Defaults are 13–18. The form permits 1–19 while the map viewer permits
  10–18; the guide makes the viewer limit clear. Map zoom controls do not
  change the download range.
- **Estimate** displays tile count, approximate **GB** and **min**. No land
  area in hectares/m² is shown. Storage uses 18 KB per tile divided by
  1024²; time uses 650 ms per tile. These are rough estimates, not actual
  downloaded bytes or an ETA based on measured connection speed. The guide
  uses only the displayed units and introduces no static example figures.
- Changing pins resets the estimate. Manually editing coordinates, name or
  zoom does not consistently invalidate it; operators are explicitly told
  to press Estimate again after changes. The downloader was not modified.
- **Download** requires an estimate. Above the existing 8,000-tile recommended
  limit, the real checkbox and **Confirm Download** are documented. Reducing
  the area or Max zoom is the first suggestion.
- Progress includes downloaded, skipped and failed counts. Existing files are
  skipped; fetches retry up to three times. The job survives navigation within
  the app but not app closure. The draft form itself is lost on navigation.
- **Cancel download** keeps saved tiles. A newly canceled area is not added
  to the manifest. There is no Resume, Retry or automatic restart control;
  operators repeat the same coordinates/zoom range with Estimate and Download.
  **Dismiss** clears a finished status message only.
- A noncanceled loop appends coverage even if some tiles failed. The UI may
  therefore show **Download complete** and a Covered Areas entry with gaps.
  The guide requires checking failure counts and actual offline detail.
- User tiles live under Tauri's app-local-data `tiles/z/x/y.png`; coverage is
  stored in `tiles/manifest.json`. The name replaces an existing manifest
  entry with the same name, so distinct names are recommended. Files stay on
  this computer and are not synced. No user-chosen Downloads folder exists.
- **Covered Areas** lists bundled and user coverage with zoom ranges and
  **Shipped with app** / **Downloaded here**. Its rows have no Open action.
  Maps instead offer **Jump to downloaded map…** if coverage exists. It fits
  the saved rectangle, which may initially select a zoom outside saved levels.
  The menu loads once per map mount; reopening the page refreshes it.
- The map tries online tiles, bundled tiles, then user-downloaded tiles.
  There is no manual offline switch. **Offline — saved tiles** means at least
  some local tiles loaded, not complete coverage. **Map tiles unavailable**
  signals that the current requests found no usable tiles. Operators must
  inspect the full required area and saved zoom levels themselves.
- Downloaded map images do not supply new place search, rover GPS, sensor
  readings, radio connectivity or a guarantee that every app feature works
  offline. Native local-tile access is not reproduced in a plain browser.

## Visuals and remaining evidence

Four crops reuse existing desktop captures without changing their UI or map
content. The asset README records provenance, crop rectangles and caption
limits. Missing native screenshots are real search results, a named computed
estimate, active download, completion with actual failure count, and a real
offline-access check. No successful download or offline test was fabricated.

## Validation (2026-10-31)

- `node --test tests/*.test.js`: **21 passed, 0 failed**.
- `npm run build`: **passed**, with the existing warning about a JavaScript
  chunk exceeding 500 kB.
- Isolated headless Chrome checked the actual app in development and production
  preview at **1366 × 768**, **1024 × 768**, **800 × 600** and **560 × 760**.
  The app sidebar was collapsed at the narrowest size. All six guide buttons
  remained accessible. All seven new topics passed desktop buttons/compact
  select, heading focus after topic changes, previous/next/wrap navigation,
  image loading/alt text, lightbox opening, zoom in/out, Fit width, Escape,
  focus restoration and no page/manual horizontal overflow.
- Browser checks used an isolated mocked Tauri bridge and blocked external map
  requests. They verified documentation UI only and did not access the real
  database, change connectivity, download tiles or communicate with a rover.
  No runtime exceptions occurred. Rendered desktop and narrow-window captures
  were visually inspected; these temporary checks are not documentation assets.
- Git diff and pre-edit SHA-256 comparisons confirmed only UserManualView.jsx,
  its six-column navigation CSS and the manual index changed among preexisting
  files. New files are this guide, its maintenance note and screenshot folder.
  Existing App.jsx changes, the capture helper and other user work were
  preserved. No downloader, map, search, storage, calculation, database,
  telemetry, mission or firmware code was changed. No commit or push was made.
