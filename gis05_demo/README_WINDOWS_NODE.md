# MTP-GIS-05 — Node.js synthetic demonstration fixture

**DEMONSTRATION DATA ONLY — NOT ACTUAL ROVER SOIL MEASUREMENTS.**

This is a Node.js replacement for the previously supplied Python utility. It uses **Node.js's built-in `node:sqlite`**, so **no Python, pip, better-sqlite3, or npm installation is required**. Tested here with Node 22.16.0; your previously reported Node 24.12.0 supports this API. An `ExperimentalWarning` about SQLite on some Node versions is normal; it is not itself a failure.

The script reads your **current project source** before touching the DB. It verifies that `src/App.jsx` imports the **active** `src/views/FieldMapView.jsx`, that the heatmap settings are **20 m local, 25 m IDW search, 2 distinct neighbors, power 2**, and that Rust derives the database from `<CARGO_MANIFEST_DIR>/eksplorador.db`.

Database normally resolves to:

`D:\UST Capstone\Eksplorador-project\apps\desktop\src-tauri\eksplorador.db`

The uploaded ZIP did not contain that live `.db`. The script checks your **real existing** `GIS05_SYNTHETIC_TEST` field, schema and boundary; it **never** creates, resizes or replaces that field. An existing 500–1,000 m² field **cannot** fit this fixture's full 160 m × 100 m reference frame (16,000 m²), and the script must then refuse the insertion.

## Installation

Extract this ZIP into `D:\UST Capstone\Eksplorador-project` while preserving its `gis05_demo` folder. **Do not extract the previous Python ZIP over it.** If you already have a Python-generated `gis05_demo/data/gis05_manifest.json`, preserve it and stop: the two versions should not be mixed without review.

Close the Eksplorador desktop application and terminate `npm run tauri dev` before any write command. The script also checks for the common `desktop.exe` and `eksplorador.exe` process names on Windows. The flag `--confirm-app-closed` is an explicit operator declaration, not a way to bypass safe process handling.

From **PowerShell**, starting in the project root:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
node --version

# READ-ONLY. Check database, saved field boundary, counts and journal mode.
node .\gis05_demo\gis05_demo.mjs inspect

# READ-ONLY. Validate fit and meter distances using the actual app's geo.js.
node .\gis05_demo\gis05_demo.mjs plan
```

**Only if `plan` succeeds**, with the app closed:

```powershell
# Creates and validates a timestamped SQLite-consistent backup first.
# Inserts exactly three labelled demonstration missions in one transaction.
node .\gis05_demo\gis05_demo.mjs insert --confirm-app-closed

# READ-ONLY. Verify every inserted row against its manifest.
node .\gis05_demo\gis05_demo.mjs verify
```

If you want the optional labelled duplicate fixture, add `--with-duplicate` to the **first** insert command on an uninstalled fixture. A repeat insert is a verified no-op and **does not** add the duplicate after the fact:

```powershell
node .\gis05_demo\gis05_demo.mjs insert --confirm-app-closed --with-duplicate
```

The optional fourth mission `GIS05_DEMO_04_DUPLICATE` holds synthetic finalized A (20%), B (40%), duplicate B (40%) rows at the **same B coordinates**. It does not claim to be a retransmitted raw rover packet; no five-minute observation history is manufactured.

After insertion is complete, you may launch the app and select `GIS05_SYNTHETIC_TEST` and each `GIS05_DEMO_*` mission. Choose **Soil Moisture** on Field Map. Capture actual screenshots and rendering times separately using `GIS05_EVIDENCE_BLANK.md`.

### Cleanup (after closing the app again)

```powershell
cd "D:\UST Capstone\Eksplorador-project"
node .\gis05_demo\gis05_demo.mjs verify
node .\gis05_demo\gis05_demo.mjs cleanup --confirm-app-closed
```

Cleanup creates **another verified consistent backup**, and deletes **only the mission and sample IDs** in `gis05_demo/data/gis05_manifest.json`. It refuses deletion if there are unexpected attached readings, any mismatched sample values, a modified fixture mission, changed field boundary or mismatched database identity. It never deletes the field or unrelated records. An archived manifest is retained.

## Stored data and limitations

- Missions: `GIS05_DEMO_01_SINGLE` (A 20%); `GIS05_DEMO_02_OVERLAP` (A 20%, B 40%); `GIS05_DEMO_03_BOUNDARY` (A 20%, B 40%, C 60%).
- Reference coordinates: A=(40E,40N), B=(60E,40N), C=(150E,80N) m. Inspection gap=(100E,40N) is **not inserted**.
- Missions have `status=completed`, `pins_geojson=NULL`, and synthetic names. They are explicitly demonstration records rather than rover missions.
- `location_source=GIS05_SYNTHETIC_DEMO`; `ph`, `ec`, `nitrogen`, `phosphorus`, `potassium`, `overall`, and `sample_session_id` are NULL. Synthetic timestamps denote fixture creation, **not observed sample collection**.
- Source-verified map calculations are retained; the fixture does not change renderer interpolation, firmware, telemetry, LoRa, database migration, field-save logic or real records.
- SQLite's **online backup API** includes committed WAL data without assuming it is all in the `.db` main file. Backups are integrity-checked, foreign-key-checked, compared with source counts and boundary, then SHA256 recorded in the manifest.
- It refuses insertion if the field can't hold the full rectangle while C's local coverage clips at the field boundary. Do **not** change your field boundary solely to force this test; request a geometry adjustment if it doesn't fit.

## Developer-only tests (safe temporary database)

For the bundled self-test, the Node script expects the **audited source** from your project at its default Windows location. It constructs a fresh *temporary* SQLite database using those SQL migrations, and never uses your live DB:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
$env:GIS05_SOURCE_PROJECT = (Get-Location).Path
node .\gis05_demo\test_temporary_db.mjs
Remove-Item Env:\GIS05_SOURCE_PROJECT
```

Expected developer test coverage: WAL backup including committed rows, transaction insertion, repeat-run no-op, cleanup, isolated duplicate fixture, boundary mismatch refusal, and extra-telemetry refusal. A developer test passing **does not** constitute actual MTP-GIS-05 results. The attached evidence sheet deliberately contains blank Actual Result, screenshot, run-time and PASS fields.

**If an error leaves a `pending` or `insertion_failed_no_commit` manifest, do not delete it and retry.** Preserve the console output and backups for reconciliation.

MTP-SW-02's historical 24/24 checks apply to the previously tested source version and do not substitute for the real app's GIS-05 evidence or current numerical regression run.
