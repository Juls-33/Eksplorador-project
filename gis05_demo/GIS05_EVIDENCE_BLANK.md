# MTP-GIS-05 — Real Application Evidence Form (BLANK)

**Data classification:** SYNTHETIC DEMONSTRATION, NOT MEASURED SOIL DATA.\
**Test machine/OS:** ________  **Date/time:** ________\
**Source commit/file hashes:** ________  **Running app/database path:** ________\
**Existing GIS05 field ID:** ________  **Existing saved boundary SHA256:** ________\
**Fixture origin (SW corner):** ________  **Inserted mission IDs:** ________\
**Manifest:** ________  **Verified backup path/SHA256:** ________\
**Metric:** Soil Moisture  **Renderer settings (verify):** local 20m, search 25m, min distinct sites 2, power 2.\
**Screenshot policy:** Capture real app screenshots; no composited or generated evidence.

| Existing step | What to do in the app | Expected outcome (not actual result) | Actual result / screenshot name | Status (leave blank) |
|---|---|---|---|---|
| 1 — Single sample | Open `GIS05_DEMO_01_SINGLE`; select **Soil Moisture**; open **gradient guide** and note 20m local footprint | Local coverage appears around A=20% even with only one distinct site; numeric value remains 20% | ________ | ________ |
| 2 — Overlap | Open `GIS05_DEMO_02_OVERLAP` with A=20%, B=40% 20m apart; examine the geometric midpoint | Overlap blends rather than summing; reference midpoint is ~30% (not 60%), no alpha stacking/inflation | ________ | ________ |
| 3 — Isolated, gap, boundary | Open `GIS05_DEMO_03_BOUNDARY`; inspect C=60%, point GAP (28E,44N) without a pin, and C's boundary-side footprint | C retains its own local coverage; no pixels at unsupported gap; coverage is clipped to saved polygon | ________ | ________ |
| 4 — Pins visible/hidden | At a constant recorded zoom, take screenshots after **Show pins** and **Hide pins** | Only pin visibility changes; gradient/sample values unchanged | Zoom ________; screenshots ________ / ________ | ________ |
| 5 — Reload and timed rendering | Leave and reopen the saved GIS05 mission at the same zoom, select moisture and measure time to visible heatmap on 3 runs | Heatmap remains after reopening; each timing is measured and compared to ≤10 s (do not infer from JS unit tests) | Times ________ / ________ / ________ s; screenshots/logs ________ | ________ |
| Additional duplicate criterion | If optional `--with-duplicate` fixture was installed, open `GIS05_DEMO_04_DUPLICATE`; compare to mission 2 at same zoom | Two identical B rows must not count as two distinct sites or increase midpoint above 30% or expand coverage | ________ | ________ |

**Timing definition:** Start when the saved mission is selected/loaded (same map/zoom/cached-tile conditions) and stop at the **first visible completed heatmap overlay**; record how it was measured (video timestamp, DevTools Performance, or manual stopwatch). Do **three separate reopens**, retaining raw measurements. Record mean/maximum only *after* collecting all three.\
**Measurement method:** ________  **Mean (calculated afterward):** ________  **Max:** ________  **≤10s criterion observed:** ________

**Storage validation after running:** `verify` output ________  **Field and unrelated records unchanged:** ________\
**Cleanup performed (optional, after evidence):** ________  **Cleanup backup:** ________

**Known limitation:** Current heatmap uses a 97×97 raster grid and locally bounded IDW. A colored screen pixel is a display estimate, not a measured soil radius. Do not use the overlay as laboratory accuracy evidence. Prior MTP-SW-02 24/24 pass (Nov 22, 2026) is version-specific numerical evidence only.
