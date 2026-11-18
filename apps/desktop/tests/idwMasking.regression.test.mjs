// MTP-SW-02 — IDW Interpolation and GIS Masking Regression
// Step 1 only: Validate values at known sample coordinates using the GENERATED GRID.
// Run from project root:
// node --test --test-name-pattern="SW02-STEP1" .\apps\desktop\tests\idwMasking.regression.test.mjs
// This test is database-independent and makes no application changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIDWHeatmapGrid, consolidateHeatPoints } from '../src/utils/geo.js';


const baseLat = 14.608310246123;
const baseLng = 120.989452063502;

// Multiple independently located synthetic readings (separation > 0.75 m).
const points = [
  [baseLat, baseLng, 20],
  [baseLat + 0.000018, baseLng + 0.000018, 40],
  [baseLat - 0.000018, baseLng - 0.000018, 60],
];

function rectangleAround([lat, lng], halfSpanDegrees = 0.00004) {
  return [
    [lat - halfSpanDegrees, lng - halfSpanDegrees],
    [lat - halfSpanDegrees, lng + halfSpanDegrees],
    [lat + halfSpanDegrees, lng + halfSpanDegrees],
    [lat + halfSpanDegrees, lng - halfSpanDegrees],
  ];
}

// geo.js appends the original consolidated sample points to the end of the
// interpolated grid. Exclude those appended points to ensure we are really
// checking an internally GENERATED GRID CELL, not simply copying the input.
function generatedCellsOnly(allResults, rawPoints) {
  const originalSiteCount = consolidateHeatPoints(rawPoints).length;
  return allResults.slice(0, allResults.length - originalSiteCount);
}

for (const [index, point] of points.entries()) {
  test(`SW02-STEP1: grid matches known sample ${index + 1} (${point[2]}%)`, () => {
    const polygon = rectangleAround(point);
    const fullResult = generateIDWHeatmapGrid(points, polygon, {
      gridResolution: 4,
      power: 2,
      maxInfluenceRadiusM: 25,
      minNeighbors: 2,
    });
    const gridCells = generatedCellsOnly(fullResult, points);
    const [expectedLat, expectedLng, expectedValue] = point;
    const cell = gridCells.find(([lat, lng]) =>
      Math.abs(lat - expectedLat) < 1e-9 &&
      Math.abs(lng - expectedLng) < 1e-9
    );
    assert.ok(cell, `No generated grid cell at sampling site ${index + 1}`);
    assert.ok(
      Math.abs(cell[2] - expectedValue) <= 0.001,
      `Expected ${expectedValue}%, got ${cell[2]}%`
    );
    console.log(`  Sample ${index + 1}: expected=${expectedValue.toFixed(3)}%, grid=${cell[2].toFixed(3)}%`);
  });
}

// Step 2: Two equidistant sites must yield the arithmetic midpoint for IDW.
// The target is the exact center of a generated grid, not an appended sample.
test('SW02-STEP2: symmetric midpoint of 20% and 80% predicts 50%', () => {
  const center = [baseLat, baseLng];
  const symmetricPoints = [
    [baseLat, baseLng - 0.00004, 20],
    [baseLat, baseLng + 0.00004, 80],
  ];
  const polygon = rectangleAround(center, 0.00008);
  const allResults = generateIDWHeatmapGrid(symmetricPoints, polygon, {
    gridResolution: 4,
    power: 2,
    maxInfluenceRadiusM: 25,
    minNeighbors: 2,
  });
  const gridCells = generatedCellsOnly(allResults, symmetricPoints);
  const cell = gridCells.find(([lat, lng]) =>
    Math.abs(lat - center[0]) < 1e-9 &&
    Math.abs(lng - center[1]) < 1e-9
  );
  assert.ok(cell, 'No generated grid cell at the symmetric midpoint');
  assert.ok(Number.isFinite(cell[2]), 'Midpoint interpolation is not finite');
  assert.ok(Math.abs(cell[2] - 50) <= 0.001,
    `Expected 50.000%, received ${cell[2]}%`);
  console.log(`  Midpoint: expected=50.000%, grid=${cell[2].toFixed(3)}%`);
});


const SW02_CENTER = [14.6, 121.0];

// Independent IDW reference calculation.
// Distances are supplied in meters to avoid repeating the production
// geographic distance implementation.
function sw02ReferenceIDW(values, distances, power) {
  const weights = distances.map(d => 1 / Math.pow(d, power));
  return values.reduce((sum, value, i) => sum + value * weights[i], 0) /
    weights.reduce((sum, weight) => sum + weight, 0);
}

// Construct points approximately north/south of the center.
// Rounded Haversine distances will be verified from the resulting grid.
function sw02OffsetLat(meters) {
  return meters / 111195;
}

function sw02GridValue(grid, target, toleranceMeters = 0.5) {
  const found = grid.find(([lat, lng]) =>
    Math.abs(lat - target[0]) < toleranceMeters / 111195 &&
    Math.abs(lng - target[1]) < toleranceMeters / 107000
  );
  assert.ok(found, 'Expected grid point was not generated');
  return found[2];
}

function sw02Boundary() {
  const [lat, lng] = SW02_CENTER;
  const d = sw02OffsetLat(40);
  return [
    [lat - d, lng - d],
    [lat - d, lng + d],
    [lat + d, lng + d],
    [lat + d, lng - d]
  ];
}

test('SW02-STEP3A: multiple neighbors match independent power-2 IDW', () => {
  const [lat, lng] = SW02_CENTER;

  const points = [
    [lat + sw02OffsetLat(10), lng, 20],
    [lat - sw02OffsetLat(20), lng, 80],
    [lat, lng + sw02OffsetLat(30), 50]
  ];

  const grid = generateIDWHeatmapGrid(points, sw02Boundary(), {
    gridResolution: 8,
    power: 2,
    maxInfluenceRadiusM: 45,
    minNeighbors: 2
  });

  const actual = sw02GridValue(grid, SW02_CENTER);

  // At latitude 14.6°, longitude offsets are slightly shorter than
  // latitude offsets. Calculate reference distances independently.
  const longitudeDistance = 30 * Math.cos(lat * Math.PI / 180);
  const expected = sw02ReferenceIDW(
    [20, 80, 50],
    [10, 20, longitudeDistance],
    2
  );

  console.log(`Power 2: expected≈${expected.toFixed(3)}, actual=${actual.toFixed(3)}`);

  assert.ok(Math.abs(actual - expected) < 0.3,
    'Power-2 prediction differs from the independent reference');
});

test('SW02-STEP3B: increasing IDW power favors the nearer sample', () => {
  const [lat, lng] = SW02_CENTER;

  const points = [
    [lat + sw02OffsetLat(10), lng, 20],
    [lat - sw02OffsetLat(20), lng, 80]
  ];

  const options = {
    gridResolution: 8,
    maxInfluenceRadiusM: 45,
    minNeighbors: 2
  };

  const power1 = sw02GridValue(
    generateIDWHeatmapGrid(points, sw02Boundary(), {
      ...options, power: 1
    }),
    SW02_CENTER
  );

  const power2 = sw02GridValue(
    generateIDWHeatmapGrid(points, sw02Boundary(), {
      ...options, power: 2
    }),
    SW02_CENTER
  );

  console.log(`Power 1=${power1.toFixed(3)}, Power 2=${power2.toFixed(3)}`);

  assert.ok(Math.abs(power1 - 40) < 0.3);
  assert.ok(Math.abs(power2 - 32) < 0.3);
  assert.ok(power2 < power1,
    'Higher power should favor the closer low-valued sample');
});

test('SW02-STEP3C: duplicate and near-duplicate points are consolidated safely', () => {
  const [lat, lng] = SW02_CENTER;

  const points = [
    [lat + sw02OffsetLat(10), lng, 20],
    [lat + sw02OffsetLat(10), lng, 40],
    [lat + sw02OffsetLat(10.3), lng, 60],
    [lat - sw02OffsetLat(20), lng, 80]
  ];

  const consolidated = consolidateHeatPoints(points);

  assert.equal(consolidated.length, 2,
    'Three readings at the same site should count as one sampling site');

  assert.ok(Math.abs(consolidated[0][2] - 40) < 0.001,
    'Duplicate site readings should average to 40');

  const grid = generateIDWHeatmapGrid(points, sw02Boundary(), {
    gridResolution: 8,
    power: 2,
    maxInfluenceRadiusM: 45,
    minNeighbors: 2
  });

  assert.ok(grid.length > 0);
  assert.ok(grid.every(point => Number.isFinite(point[2])),
    'Interpolation must not produce NaN or Infinity');

  const actual = sw02GridValue(grid, SW02_CENTER);

  console.log(
    `Consolidated sites=${consolidated.length}, center=${actual.toFixed(3)}`
  );

  assert.ok(Math.abs(actual - 48) < 0.3,
    'Consolidated site should contribute once, not three times');
});



const SW02_S4_CENTER = [14.6, 121.0];
const SW02_S4_METERS_PER_DEG = 111195;

function sw02S4Lat(meters) {
  return meters / SW02_S4_METERS_PER_DEG;
}

function sw02S4Lng(meters) {
  return meters / (
    SW02_S4_METERS_PER_DEG *
    Math.cos(SW02_S4_CENTER[0] * Math.PI / 180)
  );
}

function sw02S4Point(north, east, value) {
  return [
    SW02_S4_CENTER[0] + sw02S4Lat(north),
    SW02_S4_CENTER[1] + sw02S4Lng(east),
    value
  ];
}

function sw02S4Polygon(halfSizeMeters) {
  return [
    sw02S4Point(-halfSizeMeters, -halfSizeMeters).slice(0, 2),
    sw02S4Point(-halfSizeMeters, halfSizeMeters).slice(0, 2),
    sw02S4Point(halfSizeMeters, halfSizeMeters).slice(0, 2),
    sw02S4Point(halfSizeMeters, -halfSizeMeters).slice(0, 2)
  ];
}

function sw02S4HasPoint(grid, north, east, toleranceM = 0.5) {
  const target = sw02S4Point(north, east);

  return grid.some(([lat, lng]) => {
    const northError = Math.abs(lat - target[0]) * SW02_S4_METERS_PER_DEG;
    const eastError = Math.abs(lng - target[1]) *
      SW02_S4_METERS_PER_DEG *
      Math.cos(SW02_S4_CENTER[0] * Math.PI / 180);

    return northError <= toleranceM && eastError <= toleranceM;
  });
}

test('SW02-STEP4A: polygon masking excludes outside grid cells', () => {
  const polygon = sw02S4Polygon(20);
  const samples = [
    sw02S4Point(-10, 0, 20),
    sw02S4Point(10, 0, 80)
  ];

  const grid = generateIDWHeatmapGrid(samples, polygon, {
    gridResolution: 8,
    power: 2,
    maxInfluenceRadiusM: 25,
    minNeighbors: 2
  });

  // The implementation appends measured sample sites to the grid.
  // Both samples here are deliberately inside the polygon.
  assert.ok(grid.length > 0);

  for (const [lat, lng] of grid) {
    const north = (lat - SW02_S4_CENTER[0]) * SW02_S4_METERS_PER_DEG;
    const east = (lng - SW02_S4_CENTER[1]) *
      SW02_S4_METERS_PER_DEG *
      Math.cos(SW02_S4_CENTER[0] * Math.PI / 180);

    assert.ok(
      Math.abs(north) <= 20.1 && Math.abs(east) <= 20.1,
      'Generated point must remain within the test field bounds'
    );
  }

  console.log(`Polygon masking: ${grid.length} retained points`);
});

test('SW02-STEP4B: cells with fewer than two neighbors are masked', () => {
  const polygon = sw02S4Polygon(40);
  const samples = [
    sw02S4Point(0, -20, 20),
    sw02S4Point(0, 20, 80)
  ];

  const grid = generateIDWHeatmapGrid(samples, polygon, {
    gridResolution: 8,
    power: 2,
    maxInfluenceRadiusM: 25,
    minNeighbors: 2
  });

  // At (0, -30), the first site is 10 m away and
  // the second is 50 m away: only one eligible neighbor.
  assert.equal(
    sw02S4HasPoint(grid, 0, -30),
    false,
    'A cell with one eligible neighbor must be masked'
  );

  console.log('Insufficient-neighbor cell correctly excluded');
});

test('SW02-STEP4C: supported cells within 25 m are retained', () => {
  const polygon = sw02S4Polygon(40);
  const samples = [
    sw02S4Point(0, -10, 20),
    sw02S4Point(0, 10, 80)
  ];

  const grid = generateIDWHeatmapGrid(samples, polygon, {
    gridResolution: 8,
    power: 2,
    maxInfluenceRadiusM: 25,
    minNeighbors: 2
  });

  assert.equal(
    sw02S4HasPoint(grid, 0, 0),
    true,
    'Center cell with two eligible neighbors should be retained'
  );

  const center = grid.find(([lat, lng]) =>
    Math.abs(lat - SW02_S4_CENTER[0]) < 1e-8 &&
    Math.abs(lng - SW02_S4_CENTER[1]) < 1e-8
  );

  assert.ok(center, 'Center cell should exist');
  assert.ok(Math.abs(center[2] - 50) < 0.01);

  console.log(`Supported center prediction: ${center[2].toFixed(3)}%`);
});

