MTP-APP-03 Step 1: Rules and Crop Profile SQL Regression

Extract mtp_app03_rules_crud.mjs to apps/desktop/tests/ of the Eksplorador-project repository.
Open PowerShell at repository root:
  node .\apps\desktop\tests\mtp_app03_rules_crud.mjs

Requires Node.js 24+ (node:sqlite). Does not use Python.
Evidence saved to apps/desktop/tests/mtp_app03_step1_evidence.json.

Scope: real cropCompatibility.js API with 50 independently expected cases, real UPSERT and DELETE SQL text extracted from db.js, temporary SQLite created from actual crop_profiles table in database_support.sql, and close/reopen persistence.
OUT OF SCOPE: actual browser/UI CRUD, Tauri database service, live-monitoring rice/cacao/coffee rules, physical crop agronomy, production data. These need additional tests. Never interpret the 50 vectors as agronomic validation.
No production database or hardware access.
