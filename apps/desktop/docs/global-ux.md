# Shared motion and contextual Help

The motion descriptions below record the initial UX implementation. The current
page, disclosure and custom-menu animations, root-cause analysis and measured
browser evidence are documented in [motion-verification.md](motion-verification.md).

This update adds frontend presentation and Help navigation without new runtime
dependencies. Existing green theme values, guide wording and image assets are
preserved. Operational algorithms, database queries, storage, mission deployment,
radio protocols, telemetry processing and firmware are unchanged.

## Files

Created:

- `src/styles/motion.css`: shared timing/easing tokens, opt-in interaction
  feedback, entry fades, responsive Help presentation and reduced-motion rules.
- `src/components/ui/PageTransition.jsx`: animates its existing container on
  navigation or reveal, without keying or remounting operational children.
- `src/components/ui/HelpButton.jsx`: compact Lucide CircleHelp button with
  its destination in both the accessible label and native title tooltip.
- `src/config/helpRoutes.js`: all six real guide IDs/labels and five Help routes.
- `src/utils/helpNavigation.js`: small navigation reducer and source-tab helper.
- `tests/helpNavigation.test.js`: 15 focused route, initial-selection, return,
  direct-navigation and retained/inert-content tests.
- `docs/global-ux.md`: these implementation and validation notes.

Modified:

- `src/App.jsx`: native sidebar buttons, navigation state, five Help connections,
  source preservation during Help, return focus/scroll and page containers.
- `src/App.css`: remove sidebar dimension animation and broad transition-all
  declarations; preserve the existing layout and sidebar colors.
- `src/components/HeatmapMap.jsx`: map-container ResizeObserver with animation
  frame cleanup, shared search-button styling and search-results menu fade.
- `src/views/FieldMapView.jsx`, `CropAssessmentView.jsx`, `ReportsView.jsx`,
  `TileManagerView.jsx`: Help in the existing page headers and opt-in styling.
  Interactive mission/crop/report cards are native buttons with aria-pressed;
  their existing selection handlers and calculations are unchanged.
- `src/views/UserManualView.jsx`: shared guide metadata, validated initial guide
  and optional contextual Back button. The guide content is unchanged.
- `src/views/UserManualView.css`: remove its now-redundant main-width exception.
- `docs/user-manual.md`: link to these maintenance notes.

## Motion

`--motion-fast`, `--motion-normal`, `--motion-slow`, `--ease-out` and
`--ease-standard` centralize timings and easing. Page transitions are a 180 ms
opacity entrance from 0.65 to 1. There is no exit wait, whole-shell animation,
map-layer transform, width/height animation or animation key on operational
components. Rapid navigation can share a brief entrance instead of restarting
or delaying it. The full-height page container preserves existing map/panel
sizing. Telemetry rerenders do not retrigger the page entrance.

Sidebar hover/active colors and icon/text inheritance remain consistent. Sidebar
collapse changes size immediately; the old width/padding transition was removed.
Native navigation buttons provide Enter/Space behavior and visible keyboard
focus. A gold sidebar focus outline contrasts with its dark background.

Ordinary controls opt into `.ui-control` for short hover/press/focus feedback.
Interactive selection cards use `.ui-selectable-card`; static sensor cards and
readings have no new hover, pulse or value-update animation. Newly assigned
styles avoid safety-critical mission-cancel, deployment, stop and radio controls.
Their state and click handlers update immediately.

Existing Add Field, Create New Mission and crop-profile panels receive an opacity
entrance. Search result menus, successful noncritical field notifications,
manual topic content, native details contents and the native image lightbox use
the same short fade. Native select popups retain their platform behavior. There
are no height-to-auto animations, delayed closures or new dialog focus handling.
The lightbox keeps its native showModal, Escape, zoom and focus restoration.

Reduced motion sets shared durations to zero and also removes preexisting inline
transitions/loop duration within the app. Focus indicators and textual status
remain visible. Print styles hide Help/Back and suppress page animation; the
existing Reports print implementation and document remain unchanged.

## Help routes and lifecycle

| Application tab ID | Help destination | Initial topic |
| --- | --- | --- |
| Dashboard (Live Monitoring) | monitoring | Getting Started |
| Field Map | field | Fields and Missions |
| Crop Assessment | crops | Getting Started |
| Reports | reports | Getting Started |
| Offline Maps | offline | Why Download a Map? |

There is no distinct rover-control page. The `rover` guide remains available in
the six-guide navigation and is the default when the manual is opened directly.
No fictitious tab or duplicate guide was introduced. Optional topic deep links
were omitted: each page's Help opens the matching guide's introduction.

Contextual Help selects User Manual in the sidebar but keeps the source page
mounted inside a hidden, inert container. This preserves selected missions,
crop/report selections, map instances and an unsaved Offline Maps selection,
name and estimate. Source subscriptions and background work remain active.
The guide heading receives focus using the manual's existing focus behavior.

**Back to [page]** reveals that same source instance and restores its Help-button
focus and main scroll position. It does not send commands, retry operations,
reload a mission or reset state. Help while already in the manual is a no-op,
so it cannot create a navigation loop.

Ordinary sidebar navigation keeps the original mount/unmount behavior and clears
the contextual origin. Direct User Manual navigation starts at Rover Operation
and hides Back. Switching from contextual Help to the sidebar's User Manual
also clears the origin and initializes the standard manual view. Manual-only
remounts initialize the requested introduction; operational pages are not keyed.

Leaflet's normal initialization still runs only on mount. A ResizeObserver
rechecks positive container dimensions on return from Help or sidebar resizing,
then schedules a nonanimated invalidateSize without changing layers or map data.
It ignores hidden/zero-size containers and cancels its frame on cleanup.

## Validation — 2026-10-31

- `node --test tests/*.test.js`: **36 passed, 0 failed**, including 15 new Help
  tests and all 21 existing receiver/status tests. Tests use Vite SSR and the
  existing Node test runner; no new test dependency was added.
- `npm run build`: **passed**. The existing warning about a JavaScript chunk
  exceeding 500 kB remains.
- Isolated headless Chrome tested development and production app builds. All
  five contextual routes opened the correct guide/introduction, focused its
  heading, retained the actual source DOM/map instance, preserved controls and
  selections, kept the same event subscriptions, and returned with keyboard
  Enter and restored focus. The Offline Maps test selected two real map pixels,
  named the draft and estimated it; all draft values and the estimate survived
  Help/Back. No download was started.
- Native sidebar Space activation, all six manual guides, compact topic
  navigation, topic changes, lightbox image loading, zoom, Fit width, Escape and
  focus restoration passed at 1366×768, 1024×768, 800×600 and 560×760. The sidebar
  was collapsed at 560 px. Page/manual horizontal-overflow checks passed.
- All five main-page Help buttons remained visible at 1024×768 and 800×600 with
  the sidebar expanded. Keyboard focus was visible. Existing field dialogs and
  Field Map / Offline Maps screens were inspected. Reduced-motion computed
  animation/transition durations were zero. Source full-height layouts were
  checked after adding the page wrapper.
- Browser fixtures used an isolated mocked Tauri bridge and blocked external
  tile requests. They did not access the real database or radio. A synthetic
  invalid-soil packet checked subscription continuity, not hardware accuracy.
  Test screenshots are temporary validation artifacts, not manual assets or
  evidence of real rover readings, downloads or offline coverage.
- Production checks had **no runtime exceptions or console API errors**.
  Development exposed a Leaflet canvas teardown error, described below.
- Pre-edit SHA-256 comparisons and diff review verified that completed manual
  subguides/assets, database/services, tile calculations/download logic, mission
  protocols and firmware were unchanged. Temporary browser/baseline helpers
  were removed. Existing user work was preserved. No commit or push was made.

## Existing limitations and remaining checks

Development can report `Cannot read properties of undefined (reading 'save')`
from Leaflet Canvas `_clear` / `_redraw` during map teardown. This also occurred
with the new observer disabled and was independently reproduced using the
pre-change App.jsx and HeatmapMap.jsx in the same isolated browser. Production
checks did not reproduce it. This update leaves the renderer unchanged rather
than broadening scope into a map-rendering fix.

The existing fixed multi-column data workspaces remain dense at narrow laptop
widths with the sidebar expanded. Help stays accessible and the manual adapts;
the existing sidebar-collapse control gives those workspaces more room. Their
data-grid layouts were not redesigned.

No native hardware, serial mission transmission, actual tile download/offline
coverage, physical printer or PDF-file saving was exercised. Browser checks
verify UI/lifecycle behavior; they do not replace those integration checks.
