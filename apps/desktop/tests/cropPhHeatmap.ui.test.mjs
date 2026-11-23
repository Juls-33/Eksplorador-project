import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cropPhHeatPoints, cropPhFieldBoundary, CROP_PH_HEATMAP_SETTINGS } from '../src/utils/cropPhHeatmap.js';
import { PH_LAYER } from '../src/utils/layerBands.js';
import { generateIDWHeatmapGrid } from '../src/utils/geo.js';
import { autoHeatmapBoundary } from '../src/utils/heatmapCoverage.js';

const renderSource = readFileSync(fileURLToPath(new URL('../src/views/CropAssessmentView.jsx', import.meta.url)), 'utf8');
const sample = (lat,lng,ph) => ({lat,lng,ph});

test('Crop overlay includes valid measured pH and excludes invalid or missing values', () => {
  assert.deepEqual(cropPhHeatPoints([
    sample(14.6,120.9,6.5), sample(14.61,120.91,0), sample(14.62,120.92,14),
    sample(14.63,120.93,null), sample(14.64,120.94,''), sample(14.65,120.95,NaN),
    sample(0,0,7), sample(91,120,7), sample(14.6,120,14.1),
    sample(14.6,120,'7.1'), sample(14.6,120,false)
  ]), [[14.6,120.9,6.5], [14.61,120.91,0], [14.62,120.92,14], [14.6,120,7.1]]);
});

test('Crop pH overlay never turns crop status categories into numbers', () => {
  assert.deepEqual(cropPhHeatPoints([
    {...sample(14.6,120.9,7.1), status:'review', statusTone:'review'},
    {...sample(14.60001,120.9,7.2), status:'matched', statusTone:'matched'}
  ]).map(p=>p[2]), [7.1,7.2]);
});

test('Crop pH overlay uses saved field boundary when valid, otherwise radial fallback', () => {
  const boundary = [[14.6,120.9],[14.6,120.91],[14.61,120.91],[14.61,120.9]];
  assert.deepEqual(cropPhFieldBoundary([{name:'A',boundary}],'A'),boundary);
  assert.deepEqual(cropPhFieldBoundary([{name:'B',boundary}], 'A'), []);
  assert.deepEqual(cropPhFieldBoundary([{name:'A',boundary:[[14.6,120.9],[NaN,120.91],[14.61,120.91]]}], 'A'), []);
});

test('Crop pH colors use the Field Map acidity classes for actual measured values', () => {
  assert.deepEqual(PH_LAYER.bands.map(b=>b.color), ['#b91c1c','#d97706','#16a34a','#2563eb','#7c3aed']);
  assert.ok(PH_LAYER.intensity(7.1)>PH_LAYER.intensity(6.0));
});

test('Crop pH IDW retains valid source readings and remains clipped to the saved field', () => {
  const pts=cropPhHeatPoints([sample(14.6,120.9,6.2),sample(14.60005,120.90005,7.2)]);
  const polygon=[[14.5998,120.8998],[14.5998,120.9003],[14.6003,120.9003],[14.6003,120.8998]];
  const grid=generateIDWHeatmapGrid(pts,polygon,{gridResolution:28,power:2,maxInfluenceRadiusM:CROP_PH_HEATMAP_SETTINGS.maxInfluenceRadiusM,minNeighbors:CROP_PH_HEATMAP_SETTINGS.minInterpolationNeighbors,localCoverageRadiusM:CROP_PH_HEATMAP_SETTINGS.localCoverageRadiusM,includeCoverage:true});
  assert.ok(grid.some(p=>p[2]===6.2));
  assert.ok(grid.some(p=>p[2]===7.2));
  assert.ok(grid.every(p=>p[2]>=6.2 && p[2]<=7.2));
  assert.ok(grid.every(([lat,lng])=>lat>=polygon[0][0]&&lat<=polygon[2][0]&&lng>=polygon[0][1]&&lng<=polygon[2][1]));
});

test('Crop pH radial fallback stays local, not a whole-field claim', () => {
  const pts=cropPhHeatPoints([sample(14.6,120.9,7.1)]);
  const boundary=autoHeatmapBoundary(pts,CROP_PH_HEATMAP_SETTINGS.maxInfluenceRadiusM);
  const grid=generateIDWHeatmapGrid(pts,boundary,{gridResolution:56,power:2,maxInfluenceRadiusM:CROP_PH_HEATMAP_SETTINGS.maxInfluenceRadiusM,minNeighbors:2,localCoverageRadiusM:20,includeCoverage:true});
  assert.ok(grid.length>0);
  assert.ok(grid.every(p=>p[2]===7.1));
});

test('Crop component wires the heatmap, toggle, boundary and unchanged screening pins', () => {
  assert.match(renderSource, /heatPoints=\{showPhHeatmap \? phHeatPoints : \[\]\}/);
  assert.match(renderSource, /labeledPoints=\{analysis\.markers\}/);
  assert.match(renderSource, /boundary=\{phMapBoundary\}/);
  assert.match(renderSource, /valueToIntensity=\{PH_LAYER\.intensity\}/);
  assert.match(renderSource, /gradient=\{PH_LAYER\.gradient\}/);
  assert.match(renderSource, /aria-pressed=\{showPhHeatmap\}/);
  assert.match(renderSource, /summarizeCropCompatibility\(/);
});
