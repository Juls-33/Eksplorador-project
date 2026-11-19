# MTP-APP-03 — Crop Suitability disclaimer layout fix

This Node.js script moves the previously added preliminary crop disclaimer from above the **Crop Suitability** heading to directly **under the heading**. It does not alter crop selection rules, production databases, telemetry, firmware or hardware.

From the project root in PowerShell:

```powershell
node .\apps\desktop\tests\APP03_Step4_UI_Layout_Fix\fix_app03_disclosure_layout.mjs .
node .\apps\desktop\tests\APP03_Step3_Live_Monitoring\mtp_app03_live_rules.mjs
```

It creates `apps/desktop/src/App.jsx.before_app03_layout_fix.bak`. Keep backups locally and do not commit them. The script expects the disclosure from the prior APP03 Step 4 patch and a `card-header` around the title; it refuses to edit if the file differs. After running, inspect Live Monitoring's Crop Suitability card visually. If the script fails, share its message and relevant `App.jsx` excerpt; do not repeatedly apply it.
