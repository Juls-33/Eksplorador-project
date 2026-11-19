MTP-APP-03 Step 2 — isolated browser Crop Profile CRUD verification

1. Extract mtp_app03_browser_crud.mjs into apps/desktop/tests/APP03_Step2_Browser_CRUD/
2. From apps/desktop, start Vite: npm run dev -- --host 127.0.0.1
3. Start a SEPARATE Chrome instance with the isolated profile and CDP port 9226:
   $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
   & $chrome --headless=new --remote-debugging-port=9226 "--user-data-dir=$env:TEMP\eksplorador-app03-chrome" --no-first-run --disable-extensions "http://127.0.0.1:1420/"
4. From project root:
   node .\apps\desktop\tests\APP03_Step2_Browser_CRUD\mtp_app03_browser_crud.mjs

Safety: All Tauri database IPC is intercepted. No real database access, no hardware commands.
The test uses a synthetic fixture and tests validation, Create/Read, Update and Delete via the real React UI.
No real/native SQLite persistence is claimed; that was checked separately in APP-03 Step 1.
If UI changes, the test intentionally fails and writes a failure_diagnostic.json plus screenshot in a TEMP evidence folder.
