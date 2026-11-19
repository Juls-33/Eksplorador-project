import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const sourcePath = path.join(root, 'apps', 'desktop', 'src', 'App.jsx');
assert.ok(existsSync(sourcePath), `App.jsx not found: ${sourcePath}. Run from the project root.`);
const original = readFileSync(sourcePath, 'utf8');
const anchor = '<div className="card crop-suitability-card">';
const marker = 'data-testid="app03-crop-conditional-disclosure"';
const disclaimer = `
                <p ${marker} style={{ fontSize: '0.76rem', lineHeight: 1.5, marginTop: 10, color: 'var(--text-muted)' }}>
                  Preliminary crop suggestions based only on available soil pH and moisture. Irrigation,
                  drainage, climate, soil depth, and cultivation conditions are not assessed. Rice requires
                  separate consideration of water availability and cultivation method.
                </p>`;
if (original.includes(marker)) {
  console.log('PASS: Disclosure already present. No files changed.');
  process.exit(0);
}
const occurrences = original.split(anchor).length - 1;
assert.equal(occurrences, 1, `Expected exactly one Crop Suitability card anchor; found ${occurrences}. No files changed.`);
assert.ok(original.includes("recommendedCrops.push('Rice')"), 'Rice recommendation block missing. No files changed.');
const next = original.replace(anchor, anchor + disclaimer);
assert.equal(next.split(marker).length - 1, 1);
const backupPath = sourcePath + '.before_app03_disclosure.bak';
assert.ok(!existsSync(backupPath), `Backup already exists: ${backupPath}. No files changed; review previous patch first.`);
writeFileSync(backupPath, original, { flag: 'wx' });
writeFileSync(sourcePath, next, 'utf8');
console.log('PASS: Added preliminary crop recommendation disclosure to Live Monitoring Crop Suitability card.');
console.log('PASS: Rice/Cacao/Coffee thresholds unchanged; only JSX notice added.');
console.log('Backup:', backupPath);
console.log('Next: run 133-vector rules regression and inspect Live Monitoring UI.');
