# GPS Mission Planner Fix — Node.js Regression Test Report

Tested on November 19, 2026 using Node.js v22.16.0. **18/18 checks passed** against the actual 60-second TF helper/dialog snapshot and the relevant FieldMapView source excerpts.

- Dry-run does not modify files
- Three desktop-only files patched
- Repeat invocation idempotent
- Fresh valid FUS priority preserved
- DATA GPS accepted if FUS absent, stale, or invalid
- Zero/invalid coordinates rejected
- Invalid/missing satellites rejected for DATA
- Stale, future, aged GPS rejected (5-second limit)
- FUS fix accepted without DATA satellite metadata
- Submission-time GPS freshness revalidated
- Submission-time GPS source provenance protected
- Manual Point A unaffected
- 60-second maximum TF command preserved
- Satellite-gated Field Map telemetry used for planner
- Fallback explicitly labeled non-fused
- Missing source anchors cause safe failure without writing files

NOT tested here: your local complete Vite build, actual LoRa/GPS hardware data flow, actual location accuracy, ground movement. These require local verification.
