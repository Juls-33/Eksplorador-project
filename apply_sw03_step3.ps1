# Apply from the Eksplorador-project root.
# Changes only FieldMapView.jsx and soilSampling.js; does not touch SQLite or firmware.
$ErrorActionPreference = 'Stop'
$utilityPath = '.\apps\desktop\src\utils\soilSampling.js'
$viewPath = '.\apps\desktop\src\views\FieldMapView.jsx'
if (!(Test-Path $utilityPath) -or !(Test-Path $viewPath)) { throw 'Run this script from the Eksplorador-project root.' }
$utility = [System.IO.File]::ReadAllText((Resolve-Path $utilityPath))
$view = [System.IO.File]::ReadAllText((Resolve-Path $viewPath))
if ($utility.Contains('export function recordUniqueSoilReading(')) { throw 'SW03 Step 3 utility change appears already applied. No files modified.' }
$anchor = 'export function summarizeSoilSession('
if (!$utility.Contains($anchor)) { throw 'Expected summarizeSoilSession anchor not found. No files modified.' }
$insert = @'
// Accept a unique, forward-moving sequence only for the current probe insertion.
// Returns false on retransmission or a delayed/out-of-order packet.
// A newly created insertion has independent sequence tracking.
export function recordUniqueSoilReading(session, reading) {
  const seq = reading?.data?.seq;
  // Rust's sensor classifier expects a numeric seq, but keep a compatibility
  // path for direct test fixtures or legacy payloads without it.
  if (!Number.isSafeInteger(seq) || seq < 0 || seq > 0xFFFFFFFF) {
    session.readings.push(reading);
    session.lastSeen = reading.receivedAt;
    return true;
  }
  // 32-bit serial-number ordering, including the 0xFFFFFFFF -> 0 wrap.
  if (session.lastAcceptedSeq !== undefined) {
    const delta = (seq - session.lastAcceptedSeq) >>> 0;
    if (delta === 0 || delta >= 0x80000000) return false;
  }
  session.lastAcceptedSeq = seq;
  session.readings.push(reading);
  session.lastSeen = reading.receivedAt;
  return true;
}

'@
$utility = $utility.Replace($anchor, $insert + $anchor)
$importAnchor = 'summarizeSoilSession, samplingPhase'
if (!$view.Contains($importAnchor)) { throw 'Expected FieldMapView import not found. No files modified.' }
$view = $view.Replace($importAnchor, 'summarizeSoilSession, recordUniqueSoilReading, samplingPhase')
$lastSeenAnchor = '      session.lastSeen = receivedAt;'
$readingAnchor = '      session.readings.push(reading);'
if (!$view.Contains($lastSeenAnchor) -or !$view.Contains($readingAnchor)) {
  throw 'Expected sampling handler anchors not found. No files modified.'
}
$view = $view.Replace($lastSeenAnchor, '      // Only fresh measurements refresh the five-minute session freshness.')
$view = $view.Replace($readingAnchor, '      recordUniqueSoilReading(session, reading);')
# Back up both files before writing. Files are small and replacement was validated in memory.
Copy-Item $utilityPath ($utilityPath + '.sw03-step3.bak') -Force
Copy-Item $viewPath ($viewPath + '.sw03-step3.bak') -Force
[System.IO.File]::WriteAllText((Resolve-Path $utilityPath), $utility, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText((Resolve-Path $viewPath), $view, (New-Object System.Text.UTF8Encoding $false))
Write-Host 'SW03 Step 3 patch applied. Backups created with .sw03-step3.bak suffix.' -ForegroundColor Green
