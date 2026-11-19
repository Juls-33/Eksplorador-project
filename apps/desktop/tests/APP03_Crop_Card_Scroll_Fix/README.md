# APP-03 Crop Suitability card layout fix

Place this folder anywhere under `apps/desktop/tests`.

From `D:\UST Capstone\Eksplorador-project` run:

```powershell
node .\apps\desktop\tests\APP03_Crop_Card_Scroll_Fix\apply_crop_card_scroll_fix.mjs .
cd .\apps\desktop
npm run build
cd ..\..
node .\apps\desktop\tests\APP03_Step3_Live_Monitoring\mtp_app03_live_rules.mjs
```

Refresh the native desktop app or dev browser. The Crop Suitability card will show heading, current assessment, then a compact disclaimer in a scrollable card body (max-height 190 px). The card keeps its existing height behavior without changing any crop recommendation rule.

**Safety:** Source-only patch to `apps/desktop/src/App.jsx`. It never accesses the production SQLite file or hardware. Creates `App.jsx.before_app03_scroll_fix.bak` (unless it already exists). Do not commit `.bak` files.
