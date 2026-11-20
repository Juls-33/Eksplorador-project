# GPS Live Monitoring continuity — isolated regression report

**Patch scope:** exactly one `apps/desktop/src/App.jsx` frontend source file. Reuses the previously installed display-only GPS continuity hook.

**Environment:** Node.js v22.16.0. The test suite is stdlib-only. TypeScript is optional for JSX parser diagnostics.

## Test coverage

- GPS marker source is visual-only; live GPS validity still governs badges / source data.
- `satsLocked=0` keeps correct No Fix status; a held rover location is visibly labeled *not live*.
- Saved soil readings and soil GPS validation remain untouched; no held coordinates are written to samples.
- Receiver status and packet freshness check before using a visual held point.
- Historical map selection still overrides rover display.
- `useMemo` stabilizes live coordinate arrays so unrelated UI renders do not refresh a GPS-fix timestamp.
- No invented dead-reckoning estimate or motor commands.
- JSX parsing on a representative App.jsx fixture.
- Idempotence, Windows CRLF source, irregular whitespace, dry-run, source mismatch/abort, missing prerequisites/abort, safe repeat install, untouched database and firmware fixture files.
- 30-second expiry/receiver-disconnect behavior of the existing pure GPS display helper.
- Existing speed and obstacle-alert code represented in the input fixture remain unchanged.

**Results:** 21 tests passed, 0 failed. The tests simulate the relevant App.jsx source structure, not the user's entire local Tauri project.

**Not yet independently verified:** `npm run build` against the user's exact local desktop source; physical LoRa/GPS field behavior. These are required after installation.
