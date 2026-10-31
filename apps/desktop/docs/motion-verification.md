# Visible page, disclosure and menu motion

## Root cause verified before editing

The pre-change browser probe explicitly set `prefers-reduced-motion` to
`no-preference`. The animation class and keyframes were present and applied;
CSS specificity was not preventing the existing effect.

- The retained PageTransition wrapper faded only from **0.65 to 1**, over
  180 ms, with **no translation**. That entrance was weak and easy to miss.
- Its boolean `entering` flag was already true when another tab was selected
  during the animation. Setting it true again did not change the class or
  restart the animation. Measured animation times continued from
  `0, 0, 16.7 ms` on the first page to `33.4, 50.0, 66.6 ms` on the next page.
- Native details changed their layout immediately. The same section measured
  **539.75 px on every opening sample** and **51.05 px on every closing sample**.
  A fade on its children could not animate the parent height, and removing
  `open` hid the children immediately, preventing an exit animation.
- Custom search results used conditional rendering. Clearing results removed
  the list immediately, so there was no closing surface left to animate.
- Manual topic nodes already had topic-dependent keys. They needed a stronger
  entrance, not a reset of guide navigation or operational page state.

Reduced-motion rules were not accidentally active in this normal-motion probe.
When the operating system requests reduced motion, immediate display remains
intentional and is tested separately.

## Implementation

`PageTransition` now starts a Web Animations API entrance on its existing DOM
wrapper in a layout effect. Each navigation key or hidden-to-visible change
cancels the previous animation and starts a new one before paint. It fades
**0 → 1** and moves **8 px → 0** over the shared **260 ms** slow timing, using
`cubic-bezier(0.22, 1, 0.36, 1)`. There is no exit wait, forced reflow, arbitrary
restart timeout or operational React key. The animation leaves no opacity or
transform on the wrapper after it finishes. A preference change cancels it when
reduced motion becomes enabled. Print CSS forces full opacity and no transform.

`AnimatedDisclosure` replaces all **45 disclosure declarations across six
guides**, including mapped troubleshooting entries. It uses a native button
with `aria-expanded` and `aria-controls`, a rotating chevron, and a CSS grid
panel that transitions **0fr ↔ 1fr** plus opacity over **260 ms**. The inner
wrapper has `min-height: 0` and clips only during expansion/collapse, so lists,
tables, photos and dynamic intrinsic sizes are supported without a fixed maximum
height or cached height calculation. Following content moves with the panel.

Collapsed and closing content is immediately `inert` and `aria-hidden`.
Visibility becomes hidden at the end of collapse without changing layout.
Enter and Space use native button behavior. The component returns focus to its
trigger if a collapse is requested while focus is inside its panel. Images and
the existing native lightbox retain their original content and handlers.

Manual topic contents retain their existing topic keys and now fade **0 → 1**
with a **6 px → 0** entrance over **220 ms**. The topic navigation stays mounted
and stable. No manual wording, guide IDs, introduction routing or Back behavior
was changed.

`AnimatedMenu` gives the existing map place-search results an **180 ms** fade,
4 px translation and small scale entrance/exit. It retains the previous list
through closing, marks closing content inert, and unmounts after the animation
finishes. Reversals use the interrupted visual frame. A portal under the app
shell avoids map/card overflow clipping; placement is constrained to the viewport
and follows anchor resize/scroll. Escape returns focus to search, outside clicks
dismiss, and native buttons, arrows and Tab remain usable. A hidden source page
dismisses its popup so it cannot remain over contextual Help. Native HTML select
popups keep their platform behavior and were not replaced.

Timings/easing remain in `motion.css`; `utils/motion.js` reads those values for
imperative animations and respects the reduced-motion query. Reduced motion
shows open content immediately, collapses immediately and removes decorative
page/menu transforms. No library or dependency was added.

## Operational state and scope

App.jsx, HelpButton, help routes, the navigation reducer and operational view
lifecycles are unchanged. Contextual Help still keeps its source mounted, hidden
and inert; Back reveals that same source. Ordinary tabs retain their preexisting
mount/unmount behavior. Animation never keys or remounts operational children.

The browser verified the same Offline Maps DOM node, Leaflet container and named
draft before and after Help/Back. Telemetry rerendering did not replay the page
animation. Map/search data, calculations, requests, download/storage functions,
mission/radio code, database, crop algorithms, Reports export and firmware were
not changed. HeatmapMap changes are limited to the result-list presentation and
its anchor reference.

## Measured production evidence

Normal checks explicitly disable reduced motion. Each trace uses real
`requestAnimationFrame` callbacks and computed styles, rather than asserting
only that an animation class exists. Timing varies slightly with frame scheduling.
The table gives selected measured frames from the production pass:

| Effect | Start | Around 67 ms | Settled |
| --- | --- | --- | --- |
| Field Map → Live Monitoring | opacity 0, Y 8 px | opacity 0.658, Y 2.734 px | opacity 1, Y 0 |
| Controller Menu Buttons opening | panel 0 px, opacity 0 | panel 378.688 px, opacity 0.775 | panel 488.703 px, opacity 1 |
| Controller Menu Buttons closing | panel 488.703 px, opacity 1 | panel 110.141 px, opacity 0.225 | panel 0 px, hidden |
| Manual topic entrance | opacity 0, Y 6 px | opacity 0.836, Y 0.987 px | opacity 1, Y 0 |
| Search results opening | opacity 0, Y −4 px | opacity 0.897, Y −0.412 px | opacity 1, Y 0 |
| Search results closing | opacity 1, Y 0 | opacity 0.102, Y −3.590 px | popup removed |

[Selected frame samples](validation/motion-samples.json) preserve numeric evidence
for these effects, rapid replay, Help/Back, troubleshooting, stable telemetry and
reduced motion. They are selected real samples, not fabricated animation curves.
The runner also writes full `frames.json` and actual browser screenshots to its
printed temporary output directory. Page entrance, disclosure opening and the
1024/800 px manual layouts were visually inspected in those screenshots.

Verified assertions include:

- Immediate active animation, intermediate opacity and nonzero translateY,
  followed by full opacity and zero translateY; rapid navigation restarts it.
- Field Map → Live Monitoring; Live Monitoring → Crop Assessment; Crop
  Assessment → Reports; Reports → Offline Maps; Offline Maps → Field Map;
  direct Manual and contextual Help/Back entrances.
- Controller and troubleshooting opening/closing have multiple distinct panel
  heights; the following section moves down/up; the final collapse has no
  extra height jump. The chevron rotates through intermediate angles.
- Collapsed links/buttons cannot receive focus. Enter/Space toggle correctly.
  Reference photos load and their lightbox still opens and closes with Escape.
- Custom menu entry/exit includes intermediate opacity, retained but inert
  closing options, viewport-safe placement, arrows, Tab, Escape and outside click.
- Manual topic navigation keeps its DOM identity. Existing Help picks the correct
  guide and Back preserves the source map/draft.
- At 1024×768 and 800×600, disclosure motion works without page overflow.
- With reduced motion enabled, page opacity stays 1 with Y 0 and no animation;
  disclosure opening/closing and custom menu changes are immediate.

## Repeatable validation

From `apps/desktop`:

```powershell
node --test tests/*.test.js
npm run build
node scripts/check-motion.mjs
node scripts/check-motion.mjs --production
```

The frame runner uses an installed Chrome/Chromium or `CHROME_PATH`, starts an
isolated local Vite server on an available port and closes its browser/server
afterward. It explicitly switches normal/reduced motion and uses a mocked Tauri
bridge. External requests are intercepted; the search test uses a clearly named
UI fixture. No real database, receiver, sensor reading or map download is used.

Results: **38 Node tests passed**, including all existing tests and two new
disclosure accessibility checks; **production build passed** with the existing
chunk-size warning; development and production frame checks passed. Production
reported no runtime exceptions or console errors. Development retained the
previously reproduced Leaflet canvas teardown exception; the runner permits only
that known signature and fails on new runtime errors.

Native select option-popup animation remains controlled by the operating system.
Native Tauri hardware/serial operation, tile download and physical printing were
not exercised by this UI test. No commit or push was made.

## Files

Created:

- `src/components/ui/AnimatedDisclosure.jsx`
- `src/components/ui/AnimatedMenu.jsx`
- `src/utils/motion.js`
- `scripts/check-motion.mjs`
- `docs/motion-verification.md`
- `docs/validation/motion-samples.json`

Modified:

- `src/components/ui/PageTransition.jsx`
- `src/styles/motion.css`
- `src/components/HeatmapMap.jsx`
- `src/views/UserManualView.jsx` and `UserManualView.css`
- `src/views/FieldMapGuide.jsx`, `LiveMonitoringGuide.jsx`,
  `CropAssessmentGuide.jsx`, `ReportsGuide.jsx`, `OfflineMapGuide.jsx`
- `tests/helpNavigation.test.js`
- `docs/global-ux.md`

The guide changes were reversed in memory and compared to the pre-edit sources:
only disclosure markup/imports differ; instruction text and topic logic match.
Git diff and pre-edit hashes were reviewed. Temporary conversion/check helpers
were removed and unrelated files were preserved.
