import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { ecDsM, estimatedTdsMgL } from '../src/utils/soilSampling.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const view = readFileSync(resolve(projectRoot, 'src/views/CropAssessmentView.jsx'), 'utf8');
const css = readFileSync(resolve(projectRoot, 'src/views/CropAssessmentView.css'), 'utf8');

test('field sensor summary separates EC, estimated TDS, and N/P/K into readable tiles', () => {
  assert.match(view, /Field sensor indicators/);
  assert.equal((view.match(/className="crop-sensor-metric"/g) || []).length, 3);
  assert.match(view, /Mean EC/);
  assert.match(view, /Estimated TDS/);
  assert.match(view, /Mean sensor N \/ P \/ K/);
});

test('EC and TDS conversions remain the original read-only formulas', () => {
  assert.match(view, /ecDsM\(conditionSummary\.ec\)\?\.toFixed\(3\)/);
  assert.match(view, /estimatedTdsMgL\(conditionSummary\.ec\)\?\.toFixed\(1\)/);
  assert.equal(ecDsM(171), 0.171);
  assert.equal(estimatedTdsMgL(171), 102.6);
});

test('N/P/K uses the existing averages and placeholders without additional scoring', () => {
  assert.match(view, /\['n','p','k'\]\.map\(k => conditionSummary\[k\]\?\.toFixed\(1\) \?\? '—'\)\.join\(' \/ '\)/);
  assert.match(view, /const conditionSummary = useMemo\(/);
  assert.match(view, /const npkAvg = key =>/);
});

test('scientific limits remain available without overwhelming the default UI', () => {
  assert.match(view, /<details className="crop-sensor-advisory-details">/);
  assert.match(view, /Reading limitations/);
  assert.match(view, /uncalibrated and moisture-sensitive/);
  assert.match(view, /Confirm with lab soil testing before fertilizer advice/);
  assert.doesNotMatch(view, /<details className="crop-sensor-advisory-details" open/);
});

test('metric tiles adapt to narrow containers and do not force overflow', () => {
  assert.match(css, /\.crop-sensor-metrics\s*\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,200px\),1fr\)\)/);
  assert.match(css, /\.crop-sensor-metric\s*\{[^}]*min-width:0/);
  assert.match(css, /\.crop-sensor-advisory-details summary:focus-visible/);
});
