import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Source-only, no SQLite/Tauri/hardware access. Run from repo root.
const projectRoot = path.resolve(process.argv[2] ?? '.');
const file = path.join(projectRoot, 'apps', 'desktop', 'src', 'App.jsx');
assert.ok(existsSync(file), `Missing App.jsx: ${file}. Run from project root.`);
const src = readFileSync(file, 'utf8');
const begin = src.indexOf('<div className="card crop-suitability-card">');
const after = src.indexOf('<DrivetrainTelemetry expanded />', begin);
assert.ok(begin >= 0 && after > begin, 'Cannot locate Crop Suitability card boundaries; no changes made.');
const original = src.slice(begin, after);
const noticePattern = /<p\s+data-testid="app03-crop-conditional-disclosure"[^>]*>[\s\S]*?<\/p>/g;
const notices = [...original.matchAll(noticePattern)];
assert.equal(notices.length, 1, `Expected one APP03 disclaimer in Crop Suitability card; found ${notices.length}. No changes made.`);
const notice = notices[0][0];
assert.ok(notice.includes('Irrigation') && notice.includes('Rice requires'), 'Disclosure text differs from expected; no changes made.');
const marker = "'Recommendations will appear once a valid soil reading is received.'}";
assert.equal(original.split(marker).length - 1, 1, 'Could not uniquely identify result paragraph. No changes made.');

let card = original.replace(noticePattern, '');
// Replace only the inline style belonging to the result body's <div>.
const contentStart = card.indexOf('<div', card.indexOf('</div>') + 6);
assert.ok(contentStart >= 0, 'Could not locate result content wrapper. No changes made.');
const contentPrefix = card.slice(contentStart, contentStart + 260);
const styleRe = /style=\{\{\s*padding:\s*['"]16px['"]\s*,\s*fontSize:\s*['"]0\.85rem['"]\s*\}\}/;
assert.ok(styleRe.test(contentPrefix), 'Result-body styling differs; no changes made.');
const updatedStyle = "style={{\n                    padding: '12px 16px',\n                    fontSize: '0.85rem',\n                    maxHeight: '190px',\n                    overflowY: 'auto',\n                    overscrollBehavior: 'contain'\n                  }}";
card = card.slice(0, contentStart) + card.slice(contentStart).replace(styleRe, updatedStyle);
// Put notice after the recommendation paragraph, inside scrollable result body.
const markerAt = card.indexOf(marker);
const paragraphClose = card.indexOf('</p>', markerAt);
assert.ok(paragraphClose > markerAt, 'Result paragraph not found. No changes made.');
const insertAt = paragraphClose + '</p>'.length;
const newNotice = `\n                  <p data-testid="app03-crop-conditional-disclosure" style={{\n                    color: 'var(--text-muted)',\n                    fontSize: '0.73rem',\n                    lineHeight: 1.45,\n                    margin: '12px 0 0',\n                    paddingTop: '10px',\n                    borderTop: '1px solid var(--card-border)'\n                  }}>\n                    Preliminary crop suggestions based only on available soil pH and moisture. Irrigation,\n                    drainage, climate, soil depth, and cultivation conditions are not assessed. Rice requires\n                    separate consideration of water availability and cultivation method.\n                  </p>`;
card = card.slice(0, insertAt) + newNotice + card.slice(insertAt);
assert.equal([...card.matchAll(noticePattern)].length, 1, 'Modified card missing its disclosure; no changes made.');
assert.ok(card.indexOf('Crop Suitability') < card.indexOf('Awaiting valid soil data') && card.indexOf('Awaiting valid soil data') < card.indexOf('app03-crop-conditional-disclosure'), 'Expected card order failed.');
const next = src.slice(0, begin) + card + src.slice(after);
// Ensure cropping logic and everything outside this one JSX card is byte-for-byte unchanged.
assert.equal(next.slice(0, begin), src.slice(0, begin));
assert.equal(next.slice(next.indexOf('<DrivetrainTelemetry expanded />')), src.slice(after));
if (next === src) {
  console.log('No changes needed.');
  process.exit(0);
}
const backup = file + '.before_app03_scroll_fix.bak';
if (!existsSync(backup)) copyFileSync(file, backup);
writeFileSync(file, next);
console.log('PASS: Moved Crop Suitability disclaimer beneath the displayed assessment result.');
console.log('PASS: Added 190px max-height and internal vertical scrolling to the card body.');
console.log('PASS: No crop thresholds, database logic, or hardware logic changed.');
console.log('Backup:', backup);
console.log('Next: npm run build (in apps/desktop), then rerun 133-vector APP03 test and inspect UI.');
