# MTP-GIS-05 — compact fixture for the *verified* GIS05_SYNTHETIC_TEST boundary

This is a **replacement** `gis05_demo.mjs`, not an additional script. Extract to `D:\UST Capstone\Eksplorador-project`, replacing only `gis05_demo\gis05_demo.mjs`. Keep existing manifest/backups, if any; never delete them manually. The new `--compact-gis05` mode is locked to exact field-boundary SHA256:

`68feca7785e64c56b56a90e11709bb8c880a5d7e4051503e864983265a4e3910`

The existing field/boundary **will not be changed**. A different boundary causes a refusal. Its bbox is approximately 57.7 m E/W by 55.3 m N/S; the prior 160 × 100 m proposed geometry is impossible.

## Commands (PowerShell in project root)

Close the Tauri app before write operations. **Run inspect and plan first; only insert if plan succeeds.**

```powershell
cd 'D:\UST Capstone\Eksplorador-project'
node .\gis05_demo\gis05_demo.mjs inspect
node .\gis05_demo\gis05_demo.mjs plan --compact-gis05
```

Review printed distances and boundary clipping. For three separately selectable missions:

```powershell
node .\gis05_demo\gis05_demo.mjs insert --compact-gis05 --confirm-app-closed
node .\gis05_demo\gis05_demo.mjs verify
```

To also include the optional, separately labelled duplicate-sample mission, add `--with-duplicate` **to the first insert command**. Repeat insertion is a no-op and does not add the optional fixture later.

When finished, **close Tauri** and run:

```powershell
node .\gis05_demo\gis05_demo.mjs cleanup --confirm-app-closed
```

Cleanup uses recorded manifest IDs and refuses if unrelated samples have been attached to the synthetic missions. Both insertion and cleanup create and verify timestamped SQLite-consistent backups, including committed WAL data.

## Local metre-offset geometry

Relative to the southwest corner of the polygon's geographic *bounding box* (NOT a land parcel corner):

| Point | East (m) | North (m) | Moisture |
|---|---:|---:|---:|
| A | 35.000 | 5.000 | 20% |
| B | 42.899 | 23.374 | 40% |
| C | 3.000 | 33.000 | 60% |
| Inspection GAP | 28.000 | 44.000 | **no sample inserted** |

- A–B ≈ 20 m; midpoint moisture should be 30%.
- C is more than 40 m from both A and B, separating its 20 m local coverage footprint, and is about 1.9 m from the polygon boundary, so its footprint is clipped.
- Inspection GAP is more than 20 m from A and B and more than 25 m from C; it should have no heatmap coverage. The script verifies this against the app's `geo.js` routines before writes.
- All three points and the inspection gap are validated against the **actual polygon**, not just the bounding box.

The 20 m local radius, 25 m search radius, min distinct sites 2, and IDW power 2 are unchanged. The compact fixture still tests the intended GIS-05 behavior but **does not replicate** the original 160 × 100 m geometry; document the substitution in your evidence notes.

## Evidence, not preclaimed outcomes

Select moisture and open each synthetic mission in Field Map, capture screenshots at the same zoom; check show/hide pins, duplicate fixture, boundary clipping, and time three actual reopen/render trials against the 10 s objective. Record actual values/times only after testing. No real rover telemetry, raw probe packets, 5-minute histories, or soil chemistry metrics are fabricated.

## Developer tests (temporary databases only)

`test_temporary_db.mjs` verifies the original rectangular fixture safety lifecycle; `test_compact_db.mjs` verifies the actual-boundary compact lifecycle, including backups, repeat-run protection and cleanup. Neither targets the production DB. Run only when provided the project's source tree in `GIS05_SOURCE_PROJECT`, or use the included results log. Actual Windows application tests are **not** claimed passed.
