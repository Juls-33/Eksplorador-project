// Reposition the previously-added APP-03 disclaimer below the Crop Suitability heading.
// Source-only modification; does not open Tauri/SQLite/hardware.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const file = path.join(root, 'apps/desktop/src/App.jsx');
assert.ok(existsSync(file), `App.jsx not found: ${file}`);
const source = readFileSync(file, 'utf8');
const anchor = '<div className="card crop-suitability-card">';
const marker = 'data-testid="app03-crop-conditional-disclosure"';
const disclaimerRE = /\s*<p\s+data-testid="app03-crop-conditional-disclosure"[^>]*>[\s\S]*?<\/p>/g;
const matched = [...source.matchAll(disclaimerRE)];
assert.equal(matched.length, 1, `Expected exactly one existing disclosure paragraph, found ${matched.length}. No changes made.`);
assert.equal(source.split(anchor).length - 1, 1, 'Expected one Crop Suitability card. No changes made.');
const cardStart = source.indexOf(anchor);
const existingPosition = matched[0].index;
assert.ok(existingPosition > cardStart && existingPosition < cardStart + 700, 'Disclosure is not at the original location immediately inside Crop Suitability card. No changes made.');
const markerCheck = /recommendedCrops\.push\('Rice'\)/;
assert.ok(markerCheck.test(source), 'Rice recommendation rule missing. No changes made.');

const without = source.slice(0, existingPosition) + source.slice(existingPosition + matched[0][0].length);
const card = without.indexOf(anchor);
const nextCard = without.indexOf('className="card ', card + anchor.length);
const searchEnd = nextCard > 0 ? nextCard : Math.min(without.length, card + 10000);
const titleAt = without.indexOf('Crop Suitability', card + anchor.length);
assert.ok(titleAt > card && titleAt < Math.min(searchEnd, card + 2400), 'Could not locate Crop Suitability header after card start. No changes made.');

// Find the header container in the card that owns the heading. Account for nested divs.
const openingTags = [...without.slice(card + anchor.length, titleAt).matchAll(/<div\b[^>]*>/g)];
const headers = openingTags.filter(x => /className=(?:"|\{)[^>]*card-header/.test(x[0]));
assert.equal(headers.length, 1, `Expected one card-header div before Crop Suitability heading, found ${headers.length}. No changes made.`);
const headerStart = card + anchor.length + headers[0].index;
const divTokens = /<div\b[^>]*>|<\/div\s*>/g;
divTokens.lastIndex = headerStart;
let depth = 0;
let end = -1;
let token;
while ((token = divTokens.exec(without)) && token.index < searchEnd) {
  if (token[0].startsWith('</')) {
    depth--;
    if (depth === 0) { end = divTokens.lastIndex; break; }
  } else { depth++; }
}
assert.ok(end > titleAt, 'Could not resolve Crop Suitability header closing div. No changes made.');

const paragraph = `\n                <p ${marker} style={{ fontSize: '0.76rem', lineHeight: 1.45, margin: '8px 0 12px', color: 'var(--text-muted)' }}>\n                  Preliminary crop suggestions based only on available soil pH and moisture. Irrigation,\n                  drainage, climate, soil depth, and cultivation conditions are not assessed. Rice requires\n                  separate consideration of water availability and cultivation method.\n                </p>`;
const updated = without.slice(0, end) + paragraph + without.slice(end);
assert.equal(updated.split(marker).length - 1, 1);
assert.equal((updated.match(/recommendedCrops\.push\('/g) || []).length, (source.match(/recommendedCrops\.push\('/g) || []).length);
const backup = file + '.before_app03_layout_fix.bak';
assert.ok(!existsSync(backup), `Backup already exists: ${backup}. No changes made.`);
writeFileSync(backup, source, { flag: 'wx' });
writeFileSync(file, updated, 'utf8');
console.log('PASS: Relocated APP-03 disclaimer below Crop Suitability heading.');
console.log('PASS: Recommendation rules unchanged; only JSX placement and text styling adjusted.');
console.log('Backup:', backup);
console.log('Next: visually inspect card and rerun APP-03 133-vector rule test.');
