# MTP-APP-03 Step 4 — Live Monitoring crop-context disclosure

This Node.js installer adds a short explanatory notice to the Live Monitoring Crop Suitability card. It does not alter crop thresholds, databases, hardware controls or firmware.

From the Eksplorador project root:

```powershell
node .\apps\desktop\tests\APP03_Step4_Rice_Disclosure\apply_app03_disclosure.mjs .
node .\apps\desktop\tests\APP03_Step3_Live_Monitoring\mtp_app03_live_rules.mjs
```

Run `npm run dev -- --host 127.0.0.1` in `apps\desktop` to view the UI in an isolated browser. Inspect Live Monitoring's Crop Suitability card and save one screenshot. This is a visual manual verification; the 133 vectors verify unchanged crop calculation logic.

The installer refuses if the expected JSX anchor differs and creates `apps/desktop/src/App.jsx.before_app03_disclosure.bak` as a local backup. Do not commit the backup. Review `git diff -- apps/desktop/src/App.jsx` before committing.
