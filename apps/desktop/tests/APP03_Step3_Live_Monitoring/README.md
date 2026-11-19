# MTP-APP-03 Step 3 — Live Monitoring crop recommendations

Run with Node.js 24+ from the Eksplorador project root:

```powershell
node .\apps\desktop\tests\APP03_Step3_Live_Monitoring\mtp_app03_live_rules.mjs
```

The test reads the actual `apps/desktop/src/App.jsx` cropSuitability `useMemo` function and executes just that logic in an isolated Node VM. It checks a separate expected-value oracle for Rice, Cacao, and Coffee, including threshold boundaries, invalid/missing packets, and averages of selected historical records. It does not modify App.jsx, SQLite, Tauri or hardware.

The source's `HISTORICAL_ASSESSMENT_MIN` numeric declaration is used when present. If defined elsewhere (e.g. imported), test uses project-guide value 10 **with an explicit warning to verify it**, and does not claim that minimum has been independently resolved.

An advisory note is printed if rice's recommendation logic does not account for irrigation/drainage; an additional UI wording review is needed for MTP-APP-03 Step 4. 100% test-rule agreement is not agronomic accuracy.

Evidence JSON: `apps/desktop/tests/mtp_app03_step3_evidence.json`.
