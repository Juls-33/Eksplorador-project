param([switch]$VerifyExistingCrops)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class ManualCropVerification {
  public static bool IdenticalRectangle(string original, string cropped, int x, int y, int w, int h) {
    using (var source = new Bitmap(original)) using (var crop = new Bitmap(cropped)) {
      if (crop.Width != w || crop.Height != h) return false;
      var a = source.LockBits(new Rectangle(x,y,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      var b = crop.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      try {
        var rowA = new int[w]; var rowB = new int[w];
        for (int row=0;row<h;row++) {
          Marshal.Copy(IntPtr.Add(a.Scan0,row*a.Stride),rowA,0,w);
          Marshal.Copy(IntPtr.Add(b.Scan0,row*b.Stride),rowB,0,w);
          for (int col=0;col<w;col++) if(rowA[col]!=rowB[col]) return false;
        }
        return true;
      } finally {source.UnlockBits(a);crop.UnlockBits(b);}
    }
  }
}
'@
$originals = @(Get-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'capture-log.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
$recipes = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'crop-recipes.json') | ConvertFrom-Json
$byFile = @{}
foreach ($entry in $originals) {
  if ($byFile.ContainsKey($entry.file)) { throw ('Duplicate original: ' + $entry.file) }
  $byFile[$entry.file] = $entry
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $entry.file)).Hash
  if ($actualHash -ne $entry.sha256) { throw ('Original capture hash changed: ' + $entry.file) }
}
$cropEntries = @()
foreach ($recipe in $recipes) {
  if (-not $byFile.ContainsKey($recipe.source)) { throw ('Missing original: ' + $recipe.source) }
  $sourcePath = Join-Path $PSScriptRoot $recipe.source
  $destinationPath = Join-Path $PSScriptRoot $recipe.file
  $alreadyExists = Test-Path -LiteralPath $destinationPath
  if ($alreadyExists -and -not $VerifyExistingCrops) { throw ('Refusing to overwrite crop: ' + $recipe.file) }
  if (-not $alreadyExists) {
    $sourceBitmap = New-Object System.Drawing.Bitmap $sourcePath
    try {
    $rect = New-Object System.Drawing.Rectangle ([int]$recipe.rect[0]),([int]$recipe.rect[1]),([int]$recipe.rect[2]),([int]$recipe.rect[3])
    if ($rect.X -lt 0 -or $rect.Y -lt 0 -or $rect.Right -gt $sourceBitmap.Width -or $rect.Bottom -gt $sourceBitmap.Height) { throw ('Out-of-bounds rectangle: ' + $recipe.file) }
    $cropBitmap = $sourceBitmap.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $cropBitmap.Save($destinationPath,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $cropBitmap.Dispose() }
    } finally { $sourceBitmap.Dispose() }
  }
  $pixelsMatch = [ManualCropVerification]::IdenticalRectangle($sourcePath,$destinationPath,$recipe.rect[0],$recipe.rect[1],$recipe.rect[2],$recipe.rect[3])
  if (-not $pixelsMatch) { throw ('Crop pixel verification failed: ' + $recipe.file) }
  $parent = $byFile[$recipe.source]
  $cropEntries += [pscustomobject][ordered]@{
    file=$recipe.file; topic=$recipe.topic; sourceFile=$recipe.source; sourceScreen=$parent.sourceScreen;
    localTime=$parent.localTime; timeZone=$parent.timeZone; executable=$parent.executable;
    executableVersion=$parent.executableVersion; executableSha256=$parent.executableSha256;
    repositoryCommit=$parent.repositoryCommit; runningCommitVerified=$false;
    clientPixels=$parent.clientPixels; windowPixels=$parent.windowPixels; windowRect=$parent.windowRect; dpi=$parent.dpi;
    cropRectangle=$recipe.rect; outputPixels=@($recipe.rect[2],$recipe.rect[3]);
    realDataState=$recipe.caption; limitations=$parent.limitations;
    reviewStatus='Candidate - awaiting approval'; finalScreenshotMissing=$false;
    method='Lossless rectangular crop of recorded native PrintWindow capture'; allPixelsMatchSource=$pixelsMatch;
    sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash
  }
}
$selectedOriginals = @('field-a2b-circle-clear.png','field-area-preview-within.png','field-area-preview-above.png','field-map-controls.png','field-gradient-guide-shown.png','live-monitoring-overview.png','live-map-queue-attribution.png','live-monitoring-drivetrain.png','crop-arabica-selected.png','crop-ph-gradient.png','reports-overview.png','reports-sections-four-five.png','reports-sample-index.png','offline-maps-overview.png','offline-map-settings.png')
$rejected = @{
  'reports-provenance-1366.png'='Rejected: wheel did not scroll; duplicate overview, not a focused provenance capture. Use reports-provenance-crop.png.';
  'field-a2b-safety.png'='Rejected: modal disappeared; actual screen is Field Map with blank map. Intended safety screen was not captured. Use field-a2b-safety-dialog-crop.png.';
  'field-a2b-safety-unchecked.png'='Supporting duplicate: wheel did not scroll; planner top, not complete safety section. Use field-a2b-safety-dialog-crop.png.';
  'live-monitoring-map-queue.png'='Actual screen: lower map with attribution, complete recent-samples/crop row and partial drivetrain. Use live-recent-samples-crop.png; full map/queue is live-map-queue-crop.png.';
  'field-a2b-planning-circle.png'='Supporting: expanded gradient guide obscures part of the planning circle. Use field-a2b-circle-clear.png.';
  'live-monitoring-overview.png'='Full original retained; lower map extends below viewport, so its attribution is offscreen. Use live-dashboard-crop.png (excludes the map) plus live-map-queue-crop.png (complete attribution).';
  'live-top-return-wide.png'='Supporting full original: lower map continues below viewport. Do not publish its partial map; use the attribution-preserving map crop.'
}
$reviewedOriginals = @()
foreach ($entry in $originals) {
  $topic = if ($entry.file -like 'field-*') {'Field Map'} elseif ($entry.file -like 'live-*') {'Live Monitoring'} elseif ($entry.file -like 'crop-*') {'Crop Assessment'} elseif ($entry.file -like 'offline-*') {'Offline Maps'} elseif ($entry.file -like 'user-manual-*') {'User Manual / layout check'} else {'Reports'}
  $status = if ($selectedOriginals -contains $entry.file) {'Candidate full original - awaiting approval'} elseif ($entry.file -match '-(1366|1024)\.png$') {'Viewport check - evidence only'} else {'Supporting / intermediate - final topic covered by candidate set'}
  $reviewNote = if ($rejected.ContainsKey($entry.file)) {$rejected[$entry.file]} else {''}
  if ($entry.file -in @('field-overview-1024.png','field-overview-settled-1024.png')) { $status='Viewport issue - blank map observed'; $reviewNote='White map persists in the settled capture. Attribution/tiles absent. Do not publish as a normal working map.' }
  $copy = $entry | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $copy | Add-Member -NotePropertyName topic -NotePropertyValue $topic
  $copy | Add-Member -NotePropertyName reviewStatus -NotePropertyValue $status
  $copy | Add-Member -NotePropertyName reviewNote -NotePropertyValue $reviewNote
  $copy | Add-Member -NotePropertyName finalScreenshotMissing -NotePropertyValue $false
  $reviewedOriginals += $copy
}
$metadata = [ordered]@{
  nativeOriginalCount=$originals.Count; cropCount=$cropEntries.Count;
  allOriginalHashesMatchLog=$true; allCropPixelsExactlyMatchSource=$true;
  missingRequiredScreens=@([ordered]@{
    topic='Field Map / Mission Deployment Wizard stage 1 with RC switch checklist'; status='Missing — not captured';
    reason='Opening the wizard requires affirming physical alignment, probe retraction and path clearance in the planner. These could not be verified and were not checked or bypassed.';
    needed='Capture an already and legitimately reached wizard during a separately authorized supervised workflow after genuine physical safety checks. Leave wizard RC checklist unchecked, do not change RC states for a screenshot, and never click Confirm switches · Send mission.'
  }); originals=$reviewedOriginals; crops=$cropEntries
}
$metadata | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'capture-metadata.json')

function Cell([object]$value) { return ([string]$value).Replace('|','\|').Replace("`r",' ').Replace("`n",' ') }
$intro = @'
# Eksplorador native screenshot capture manifest

Status: captured candidates for review; published assets and guides have not been changed. All images in this directory are real native-window captures or lossless rectangular crops. Approval to replace published images or rewrite guides has not been requested or assumed.

## Native application and provenance

- Capture date: **2026-11-24**, local zone **Asia/Manila (UTC+08:00)**. Each image's source capture time appears below; a crop uses its parent's capture time.
- Running process: **desktop.exe, PID 27052**, file version **0.1.0**, executable `D:\UST Capstone\Eksplorador-project\apps\desktop\src-tauri\target\debug\desktop.exe`.
- Executable SHA-256: `577E67A2F29F2AA3FA5C72260110DC917E63533FB1CFE0F7AA8096D0AF67C9C6`. Executable last write: 2026-11-19 23:44:54 UTC. Process start observed: 2026-11-23 21:08:31 local.
- Repository HEAD during all captures: `db8d4385a50f263aa2771a1ce72e6e17bb64146a`; tracked working tree initially clean. The exact source commit loaded by the running WebView/backend was **not independently verified**. HEAD is the audit reference, not a claim that the older executable was built from it. Version and executable hash identify the actual running binary.
- Capture method: Windows `PrintWindow(hwnd, hdc, 3)` on the running native Tauri app's **complete client area**. Native title bar/frame are outside the PNG. No browser mockup, SVG substitute, DOM/telemetry injection, stitching, resampling, painting, recoloring or redaction was used.
- Windows DPI measured by `GetDpiForWindow`: **144 (150%)**. Wide originals are 2560×1406 client pixels. Original maximized outer window: 2582×1462 at rectangle (-11,-11,2571,1451). Rectangles are (left, top, right, bottom); crop rectangles below are (x, y, width, height) in original source pixels.
- Size checks used native **client device-independent pixels (DIP)**: 1366×768 → 2049×1152 raw PNG pixels; 1024×768 → 1536×1152 raw PNG pixels. The restored non-maximized outer windows are respectively 2071×1208 and 1558×1208. These are native client-size tests, not OS display-resolution changes or independently measured CSS viewports. Existing WebView zoom was not changed or measured. No 800×600 check was performed.
- `capture-log.jsonl` preserves the original action intent and metadata. Some attempts failed to reach their intended screen; the review notes below correct those descriptions. A filename alone is not evidence of the screen it intended to capture.
- `capture-metadata.json` records every image's executable/version/hash, repository HEAD, timestamp, dimensions, exact outer window rectangle, source screen, real data state, limitations, crop rectangle, image SHA-256, review status and final-missing flag. All originals matched their logged hashes; every crop's pixels were checked against its entire source rectangle.

## Safety and real data state

No mission was sent or uploaded. No final Send mission button or safety confirmation checkbox was clicked. No RC switch, rover motion/arming, logging, profile/field/mission/sample/backup mutation, import/export/merge, PDF/printing, database copy, network-state change or download was requested. App source, protocol, firmware, LoRa, GPS, SQLite, sampling, heatmap and screening logic were untouched.

Two named **unsaved** field-drawing drafts were used only for the authorized area preview, then cancelled separately. Within target: 932 m² / 0.093 ha, cancelled at 07:30:28 +08:00. Above target: 4,257 m² / 0.426 ha, cancelled at 07:31:24 +08:00. Target stayed 500–1000 m²; its editable inputs were expanded without changing the values. The example geometry is not a real saved field or a survey.

Field Map showed seven existing fields and saved mission 6, SANTA ROSA TEST on Santa Rosa 500sqm, with nine existing samples and logging off. Its name is not its mapped area: the real saved overview displays 23,849 m²; neither was corrected. Receiver remained Searching for desktop LoRa; live figures were blank. The displayed Probe Lifted wording is UI output, not physical verification by the operator.

Crop captures use the existing Arabica Coffee profile and existing Santa Rosa plot's 12 samples. Field texture is genuinely Not classified; no soil classification was invented. Report captures use the existing Santa Rosa 500sqm mission 6 report, nine saved samples dated 2026-11-20. Three reports remained visible before and after the session. Stored readings, results, coordinates and timestamps were preserved as displayed; they were not independently validated. The empty Live Monitoring recent table is session-based and does not mean the historical database is empty.

Offline Maps showed five existing z13–18 Downloaded here entries. This task did not download them, prove full coverage, or simulate success. Its map actually said Online map. Candidate map crops retain the complete native Leaflet/OpenStreetMap attribution. Full originals with partial offscreen maps are retained as evidence only; use the specifically identified attribution-preserving crops for publication.

The app was restored to its initial maximized Reports screen with mission 6 selected and no open draft/planner. Only this new staging directory was added. Nothing was committed, pushed, uploaded or published.

## Required queue and gaps

| Guide/topic | Status | Review images / limitation |
| --- | --- | --- |
| Field Map A → B modal | Captured | `field-a2b-planner-dialog-crop.png` plus `field-a2b-safety-dialog-crop.png`; one selected destination, Point A choices, unchecked safety confirmations and disabled continuation. The current modal needs scrolling; no single viewport shows all four steps. |
| Point B-centered planning circle | Captured | `field-a2b-circle-clear.png` includes the 39.55 m banner; `field-a2b-circle-map-crop.png` isolates the complete attributed map. Point A was not selected and no GPS state was fabricated. |
| Mission Deployment Wizard stage 1 / RC switch checklist | **Missing — not captured** | The planner gates entry behind confirmations that the rover was aligned using RC, probe retracted and path clear. None could be physically verified, so none was asserted or bypassed. Needed: an already and legitimately reached wizard during a separately authorized supervised workflow after genuine checks. Keep its RC checklist unchecked, make no RC changes for documentation and never click **Confirm switches · Send mission**. No substitute image is supplied. |
| Field area within / above target | Captured | `field-area-within-panel-crop.png`, `field-area-editable-target-panel-crop.png`, `field-area-above-panel-crop.png`. Both unsaved drafts were cancelled. |
| Field Map guide and controls | Captured | `field-map-guide-hidden-panel-crop.png`, `field-map-guide-shown-panel-crop.png`; status/selector placement, current soil pH layer and attribution. |
| Live Monitoring dashboard | Captured | `live-dashboard-crop.png`: moisture/pH/EC then NPK/Battery in the wide layout, genuine waiting state. |
| Live map/queue, recent samples/crops, drivetrain | Captured | `live-map-queue-crop.png`, `live-recent-samples-crop.png`, `live-drivetrain-crop.png`; wide 75/25 rows and full-width drivetrain, no fabricated telemetry. |
| Crop selection, screening, advisory, Arabica | Captured | `crop-matrix-arabica-crop.png`, `crop-screening-cards-crop.png`, `crop-sensor-advisory-crop.png`; field soil is unclassified. |
| Crop pH gradient and sample pins | Captured | `crop-ph-gradient-panel-crop.png`; 12 actual saved sample records, 0/12 within Arabica preferred pH, 12 require review. Colors are current app output, not validated field recommendations. |
| Reports six sections, provenance and index | Captured | Full `reports-overview.png`, `reports-sections-four-five.png`, `reports-sample-index.png` jointly cover all six sections. Section 3's table spans the first two originals; nothing was stitched. Focused controls/records/provenance/index crops are supplied. |
| Offline Maps styling and controls (optional) | Captured | `offline-maps-overview.png`, `offline-covered-areas-crop.png`, `offline-map-controls-crop.png`, `offline-blank-settings-crop.png`. |
| Offline live progress, completion, offline verification | **Missing — not captured** (optional evidence, not replaced) | Needs a legitimate operator-authorized download and actual offline field coverage check. No download or connectivity change was performed just for screenshots. |

## View consistency observations

| View | 1366×768 native client DIP | 1024×768 native client DIP |
| --- | --- | --- |
| Field Map | Real map and attribution visible; selected-layer text clips in the narrow center header. | Map area is white/blank and lacks tiles/attribution. Repeated after six-second settling and page navigation (`field-overview-settled-1024.png`); do not treat it as working offline/online map evidence. Details move below the directory/map row and require page scrolling. |
| A → B | Modal fits horizontally; internal scrolling is needed for safety steps; continuation remains disabled. | Modal fits horizontally; internal scrolling is needed. Fixed header/footer can cover content during scrolling. All checkboxes stayed unchecked. |
| Live Monitoring | With expanded sidebar, available content width gives a 2+2+1 card arrangement; wide 3+2/75:25 composition is documented separately. | Cards wrap to 2+2+1 and lower panels require scrolling. This is the responsive layout, not a missing Battery card. |
| Crop Assessment | Selected crop/field and screening cards remain readable; crop matrix scrolls internally. | Matrix becomes a grid above the selected crop; remaining screening/map content continues below. |
| Reports | Toolbar wraps; records and paper remain side by side; paper scrolls. | Records stack above the document. Toolbar remains accessible and document has its own scroll area. |
| Offline Maps | Map, attribution and form fields remain readable with page scrolling. | Saved-map selector covers the Online map status location in this capture. Map attribution remains visible; remaining form needs scrolling. |
| User Manual | Six guide cards remain across the top; topic/content columns readable; page scrolls. | Guide cards wrap to two rows, text remains readable, photo/content continue below. |

These are observed native screenshots, not a claim that every guide topic, hover state, zoom level, modal scroll position or CSS breakpoint passed a comprehensive regression test. No application fix was attempted.

## Concise discrepancies and obsolete published assets

This inventory compares the six guide source files, actual view/component source, every topic README, and the published Field Map/Live Monitoring/Crop Assessment/Reports overview images with the new native captures. It does not rewrite any guide.

| Existing asset(s), under `apps/desktop/src/assets/user-manual/` | Finding / proposed capture replacement (approval still required) |
| --- | --- |
| `field-map/overview.png`, `map-controls.png`, `layer-legend.png` | Obsolete layout/labels: old Overall Soil Health score and Operator RC Movement Guide; current app has per-parameter layers, collapsible pH guide, Point A → B planner and planning circle. Replace using new map/planner/circle candidates. `mission-directory.png` still explains selection but should be refreshed for visual consistency; counts/names are historical, not universal. |
| Field Map area preview (no published equivalent) | Add the current live m²/ha, editable 500–1000 m² target and within/above examples after approval. Guide boundary steps omit this preview. |
| `live-monitoring/overview.png`, `soil-moisture-ph.png`, `soil-ec-npk.png` | Old four-card row and NPK Ratio label omit Battery Monitoring and the current 3+2 wide layout. Refresh overview/cards, 75/25 rows and full-width drivetrain. Connection/GPS/queue/empty-record crops remain honest waiting-state evidence but their layout should be refreshed. |
| `crop-assessment/overview.png`, `threshold-rules.png`, `no-data-heatmap.png`, `profile-and-plots.png`, `crop-matrix.png` | Old six-parameter threshold scoring and continuous suitability map descriptions are obsolete. Current screen uses pH and configured field soil texture for per-sample screening, separates pH interpolation from compatibility pins, and treats EC/TDS/NPK as advisory. New matrix includes Arabica Coffee. `page-controls.png` remains conceptually similar but should match the new header/style. |
| `reports/overview.png`, `page-controls.png`, `report-list.png`, `document-header.png`, `summary-and-ranges.png`, `report-advice.png` | Obsolete four-section report, All Plots / Generated Reports / Print–Export labels, fertility grades and fixed viability percentages. Current Reports has six sections, All Fields, Report Records, Refresh, Print / Save as PDF, measurement provenance and sample index. |
| `offline-map/search-map.png`, `selected-area.png`, `area-settings.png`, `saved-areas.png` | Optional styling refresh; the two-corner/estimate/download workflow remains recognizable. Old screenshots describe historical entries, not the current five entries. Current native selector can overlap status at small width; no new successful/offline-state evidence exists. |

Additional source discrepancies: `UserManualView.jsx:183` still says timed upload is disabled and names the older movement guide. `FieldMapGuide.jsx:89` states 2 seconds at 0.25 m/s; current planner source uses 300 seconds at 2.9/22 m/s, and its native UI shows a 39.55 m planning limit. This is a documentation/source mismatch, not a hardware validation or an instruction to operate the rover. `CropAssessmentGuide.jsx` still explains counting six parameters out of range. `ReportsGuide.jsx` still says four sections and no Refresh button; its labels, grouping/missing-value explanations and output descriptions need a separate approved content review. Old Field Map Overall Soil Health/NPK Ratio layer instructions also disagree with the current selector.

## Candidate rectangular crops

All crop coordinates are raw source pixels. Each crop inherits its parent's exact app identity, original native window/client size and capture time. No image has been approved for publication. Final screenshot missing for these represented topics: **No**; the wizard gap above remains **Missing — not captured**.

| Image / guide topic | Parent native capture / rectangle (x,y,w,h) | Source local capture time | Original client / outer window pixels | Real state and caption |
| --- | --- | --- | --- | --- |
'@
$manifest = New-Object System.Text.StringBuilder
[void]$manifest.AppendLine($intro)
foreach ($entry in $cropEntries) {
  [void]$manifest.AppendLine(('| [{0}]({0}) — {1} | [{2}]({2}); ({3}) | {4} | {5} / {6} | {7} |' -f (Cell $entry.file),(Cell $entry.topic),(Cell $entry.sourceFile),($entry.cropRectangle -join ', '),(Cell $entry.localTime),($entry.clientPixels -join '×'),($entry.windowPixels -join '×'),(Cell $entry.realDataState)))
}
[void]$manifest.AppendLine("`n## All original full native captures`n")
[void]$manifest.AppendLine('No crop rectangle applies to any original below: each is the complete captured app client. The global version/executable hash/HEAD applies to every row. Source descriptions can describe intended rather than reached screens; review notes take precedence. Supporting captures have a completed candidate for their topic; they are not additional required finals. The missing wizard has no image file.')
[void]$manifest.AppendLine("`n| Image / guide | Local time | Client / outer pixels | Source screen and real data state | Review status / limitations / final missing |")
[void]$manifest.AppendLine('| --- | --- | --- | --- | --- |')
foreach ($entry in $reviewedOriginals) {
  $review = $entry.reviewStatus + '. ' + $entry.limitations + ' ' + $entry.reviewNote + ' Final topic missing: No (wizard gap is separate).'
  [void]$manifest.AppendLine(('| [{0}]({0}) — {1} | {2} | {3} / {4} | {5}. {6} | {7} |' -f (Cell $entry.file),(Cell $entry.topic),(Cell $entry.localTime),($entry.clientPixels -join '×'),($entry.windowPixels -join '×'),(Cell $entry.sourceScreen),(Cell $entry.realDataState),(Cell $review)))
}
[void]$manifest.AppendLine("`n## Safe manual capture follow-up`n")
[void]$manifest.AppendLine(@'
For an otherwise unavailable native screenshot, bring the real Tauri app to the intended screen manually, keep existing data and hardware states unchanged, then run the staging helper from PowerShell. It captures only this project's running native `desktop.exe`; it refuses to overwrite originals. Use a new descriptive lowercase name. For a pure screenshot, omit Click/Wheel/Text/Drag parameters.

```powershell
powershell -NoProfile -File 'D:\UST Capstone\Eksplorador-project\docs\manual-capture-staging\capture-native-window.ps1' -CaptureName deployment-stage-one-operator-capture -SourceScreen 'Legitimately reached native deployment wizard stage 1' -DataState 'Describe the real receiver state; RC checklist unchecked' -Limitations 'No mission sent; describe how the physical checks were legitimately established'
```

Do not open the missing wizard by ticking unverified planner confirmations or editing React state. If no legitimate safe path exists under the capture-only constraints, retain **Missing — not captured**. No disposable database is required for the existing captured set, and no consent for a database copy was requested or assumed.

For any new map capture, include the bottom-right Leaflet/OpenStreetMap attribution. Keep the full original. For a new rectangular crop, record its exact source-pixel rectangle and label it as a crop. Never paint missing text/status/readings into an image. New screenshots must receive new metadata entries and review notes; the current manifest is a record of this session, not automatic approval of future images.
'@)
$manifest.ToString() | Set-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'CAPTURE_MANIFEST.md')
$expectedFiles = @($originals.file) + @($cropEntries.file)
$actualFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.png' | ForEach-Object Name)
$unlisted = @($actualFiles | Where-Object { $expectedFiles -notcontains $_ })
if ($unlisted.Count -gt 0) { throw ('Unlisted PNGs: ' + ($unlisted -join ', ')) }
Write-Output ('Verified ' + $originals.Count + ' unchanged native originals and ' + $cropEntries.Count + ' pixel-identical rectangular crops. Every PNG is listed in CAPTURE_MANIFEST.md and capture-metadata.json.')
