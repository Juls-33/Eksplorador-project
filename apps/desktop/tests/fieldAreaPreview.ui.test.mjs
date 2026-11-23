import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { summarizeDraftFieldArea, formatSquareMeters, formatHectares } from '../src/utils/fieldAreaPreview.js';
import { calculatePolygonArea } from '../src/utils/geo.js';

const origin = [14.6095, 120.9895];
const square = (sideMeters) => {
  const latDelta = sideMeters / 111195;
  const lngDelta = sideMeters / (111195 * Math.cos(origin[0] * Math.PI / 180));
  return [
    origin,
    [origin[0] + latDelta, origin[1]],
    [origin[0] + latDelta, origin[1] + lngDelta],
    [origin[0], origin[1] + lngDelta]
  ];
};

test('Field area: fewer than three corners have no area estimate', () => {
  for (const points of [[], square(25).slice(0, 1), square(25).slice(0, 2)]) {
    const data = summarizeDraftFieldArea(points);
    assert.equal(data.status, 'incomplete');
    assert.equal(data.sqm, null);
    assert.equal(data.validArea, false);
  }
});

test('Field area: preview exactly reuses the existing saved-area calculation', () => {
  for (const side of [20, 25, 30, 150]) {
    const coords = square(side);
    assert.equal(summarizeDraftFieldArea(coords).sqm, calculatePolygonArea(coords));
  }
});

test('Field area: a 400 m² field is below the default 500–1,000 m² reference', () => {
  const data = summarizeDraftFieldArea(square(20));
  assert.equal(data.sqm, 400);
  assert.equal(data.status, 'below');
});

test('Field area: 625 m² and 900 m² fields are inside the reference range', () => {
  for (const side of [25, 30]) {
    const data = summarizeDraftFieldArea(square(side));
    assert.equal(data.status, 'within');
    assert.equal(data.progressPercent, 100 * data.sqm / 1000);
  }
});

test('Field area: ~23,000 m² is prominently above the reference', () => {
  const data = summarizeDraftFieldArea(square(150));
  assert.equal(data.sqm, 22500);
  assert.equal(data.status, 'above');
  assert.equal(data.aboveFactor, 22.5);
  assert.equal(data.progressPercent, 100);
  assert.equal(data.hectares, 2.25);
});

test('Field area: reference is editable and does not impose a physical restriction', () => {
  const data = summarizeDraftFieldArea(square(150), 20000, 25000);
  assert.equal(data.status, 'within');
  assert.equal(data.sqm, 22500);
  assert.equal(data.targetMax, 25000);
});

test('Field area: a contradictory target is flagged instead of misclassifying a field', () => {
  for (const [min,max] of [[1000,500], [0,1000], ['', ''], [500, NaN]]) {
    const data = summarizeDraftFieldArea(square(25), min, max);
    assert.equal(data.status, 'no-target');
    assert.equal(data.validTarget, false);
  }
});

test('Field area: adding a point, undoing it, and redrawing recomputes the preview', () => {
  const points = square(25);
  const partial = summarizeDraftFieldArea(points.slice(0,2));
  const drawn = summarizeDraftFieldArea(points);
  const undone = summarizeDraftFieldArea(points.slice(0,2));
  assert.equal(partial.status, 'incomplete');
  assert.equal(drawn.sqm, 625);
  assert.deepEqual(undone, partial);
});

test('Field area: readable metric formatting preserves the area units', () => {
  assert.equal(formatSquareMeters(22500), '22,500');
  assert.equal(formatHectares(2.25), '2.25');
  assert.equal(formatHectares(0.0625), '0.063');
});

test('Field area: presentation appears only during boundary drawing, leaving map/save handlers intact', () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src/views/FieldMapView.jsx');
  const css = resolve(dirname(fileURLToPath(import.meta.url)), '../src/views/FieldMapView.css');
  const jsx = readFileSync(src, 'utf8');
  const styles = readFileSync(css, 'utf8');
  assert.match(jsx, /wizardStep === 'DRAWING_BOUNDARY' && \(\s*<section className=\{`field-area-preview/);
  assert.match(jsx, /summarizeDraftFieldArea\(tempBoundary, areaTargetMin, areaTargetMax\)/);
  assert.match(jsx, /<HeatmapMap[\s\S]+?boundary=\{activeBoundary\}/);
  assert.match(jsx, /field = await updateFieldBoundary\(wizard\.fieldId, tempBoundary\)/);
  assert.match(jsx, /createField\(\{ name: wizard\.fieldName, boundary: tempBoundary \}\)/);
  assert.match(styles, /\.field-area-preview__number/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /prefers-reduced-motion/);
});
