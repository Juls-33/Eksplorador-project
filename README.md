# SW02 active file path fix

App.jsx imports src/views/FieldMapView.jsx. Both scripts now explicitly use that file and verify the import before proceeding. The unused src/components/FieldMapView.jsx is left untouched. Numerical checks are unchanged.

Extract into Eksplorador-project and replace prepare-sw02-retest.mjs and apps/desktop/tests/idwMasking.retest20m.test.mjs. Run:

```powershell
node .\prepare-sw02-retest.mjs
node .\prepare-sw02-retest.mjs --apply
node --test --test-reporter=spec .\apps\desktop\tests\idwMasking.retest20m.test.mjs 2>&1 | Tee-Object -FilePath .\MTP_SW02_Retest_Log.txt
```

The preview identifies the active file. Apply changes only its local radius 5 -> 20 m and legend, with a timestamped backup, or leaves it unchanged if already 20 m. Database and firmware are not accessed. The expected test summary is 24 passed, 0 failed; this must be confirmed by your own run. Keep historical evidence separately. Restart the app to check the 20 m legend. Send the full log for review before updating the test plan status.
