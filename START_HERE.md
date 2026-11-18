# Eksplorador desktop — automated testing starter (GIS + database)

## What this tests

- **7 real-code GIS regression checks:** interpolation at the center, four known samples, west–east gradient, changed values, duplicate consolidation, radius/coverage limitation, and polygon detection. Tests import the **actual** `apps/desktop/src/utils/geo.js` file. There is no copied/reimplemented IDW algorithm in the tests.
- **1 read-only SQLite audit:** database integrity; mission-to-field link; telemetry sample count; plot labels; pH, moisture, and geotags for a named mission. Intended to catch the same NULL `plot` issue encountered during GIS02.

**Limitations:** These are unit-level/code tests and a DB consistency audit, not desktop end-to-end UI testing, full crop-suitability assessment, real-world sensor accuracy, or testing of import/export/merge actions. All expected data values are synthetic. Do not mark MTP-APP-01 or MTP-APP-03 passed solely on these results.

## Install (copy into the GIS-Test project)

1. Extract the ZIP. Copy `apps/desktop/tests/geo.regression.test.mjs` into your test project's `apps/desktop/tests/` directory, without replacing the existing `geo.js`.
2. Copy `scripts/audit_mission_records.py` to your test project's `scripts/` directory. Create the folder if needed.
3. In PowerShell, navigate to `D:\UST Capstone\Eksplorador-project-GIS-Test`.
4. Confirm a supported Node.js version using `node --version`; Node 20+ recommended. Node's built-in `node:test` runner requires no new NPM dependency.

## Run the GIS tests

```powershell
node --test .\apps\desktop\tests\geo.regression.test.mjs
```

Expected outcome: **7 tests, 7 passed, 0 failed** if the current `geo.js` implements the previously shared behavior. If a test fails, inspect the reported actual/expected value; **do not change production code just to silence a failing assertion**. Review whether the algorithm or criteria changed.

Save test evidence to a file using PowerShell's `Tee-Object`:

```powershell
node --test .\apps\desktop\tests\geo.regression.test.mjs 2>&1 | Tee-Object -FilePath .\gis_automated_test_results.txt
```

## Run the database audit

Close DB Browser for SQLite and avoid an active write transaction. The script itself opens a read-only database connection.

```powershell
py .\scripts\audit_mission_records.py --db ".\apps\desktop\src-tauri\eksplorador.db" --mission-id 6
```

If your working database has a different path or Mission 6 is not the intended testing record, adjust the command. Audit the **GIS-Test copy** only, not the original capstone project or live rover DB.

To observe the missing-plot issue without failing on that criterion:

```powershell
py .\scripts\audit_mission_records.py --db ".\apps\desktop\src-tauri\eksplorador.db" --mission-id 6 --allow-missing-plot
```

## Evidence for the Master Test Plan

Capture:

1. Screenshot of Node.js test runner summary (total, passes, failures).
2. The saved `gis_automated_test_results.txt` log.
3. Screenshot of the read-only SQLite audit and the field name/plot count.
4. Test project git commit or desktop version, Node version, OS, test date and operator.

Proposed test category: **automated regression addendum** to the GIS tests (and DB integrity portion of APP-01), *not a new physical field test*.

## Next automated suites

1. Crop Assessment algorithm regression: import the **real** crop-screening utility, use known pH and texture rule vectors (Silt loam vs Loam). Requires latest source file to avoid writing a fake test against reimplemented rules.
2. SQLite import/export/merge integration: automate calls to the **real desktop backend**, using disposable database copies. Do not equate raw SQLite copies with verifying the app's import/export actions.
3. Full Tauri UI automation (later): test actual buttons, field selection, reports and errors, once interface stabilizes.

## Provenance

Test inputs derive from the four GIS02 synthetic samples supplied in the project discussion; module API and behavior derive from the `geo.js` function the user shared. These starter tests were verified against a faithful stand-in of that shared module. They have not been executed against the user's latest local project or its full ZIP.
