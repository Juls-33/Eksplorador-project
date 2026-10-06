#!/usr/bin/env node
// Downloads OSM XYZ tiles for named areas into public/tiles/{z}/{x}/{y}.png,
// matching exactly what HeatmapMap.jsx's FastFallbackTileLayer requests.
//
// Usage:
//   node download-tiles.mjs                 # plan + confirm + download, using tile-areas.json
//   node download-tiles.mjs --dry-run        # just print the plan, download nothing
//   node download-tiles.mjs --only ust       # only areas whose name contains "ust" (case-insensitive)
//   node download-tiles.mjs --overwrite      # re-download tiles that already exist
//   node download-tiles.mjs --force          # skip the safety-cap confirmation on large runs
//   node download-tiles.mjs --config other-areas.json
//
// Respects OSM's tile usage policy (https://operations.osmfoundation.org/policies/tiles/):
// a real User-Agent, a conservative request rate, no parallel hammering.

import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planArea } from '../src/utils/tileMath.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SAFETY_TILE_CAP = 20000; // require --force above this, so a bad bbox/zoom can't repeat today's mess
const AVG_TILE_KB = 18;
const SUBDOMAINS = ['a', 'b', 'c'];
const MAX_RETRIES = 3;

function parseArgs(argv) {
  const args = { dryRun: false, force: false, overwrite: false, only: null, config: 'tile-areas.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--overwrite') args.overwrite = true;
    else if (a === '--only') args.only = (argv[++i] || '').toLowerCase();
    else if (a === '--config') args.config = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function fmt(n) {
  return n.toLocaleString();
}

async function fileExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadTile({ z, x, y }, outputDir, userAgent, overwrite, subdomainIndexRef) {
  const destDir = path.join(outputDir, String(z), String(x));
  const destFile = path.join(destDir, `${y}.png`);

  if (!overwrite && (await fileExists(destFile))) {
    return { status: 'skipped' };
  }

  const subdomain = SUBDOMAINS[subdomainIndexRef.i % SUBDOMAINS.length];
  subdomainIndexRef.i += 1;
  const url = `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(destDir, { recursive: true });
      await writeFile(destFile, buf);
      return { status: 'downloaded' };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(500 * attempt); // small backoff before retrying
    }
  }
  return { status: 'failed', error: String(lastError) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(SCRIPT_DIR, args.config);
  const config = JSON.parse(await readFile(configPath, 'utf8'));

  if (!config.userAgent || config.userAgent.includes('REPLACE_WITH_YOUR_EMAIL')) {
    console.error(
      'Set a real "userAgent" in tile-areas.json first — OSM\'s tile usage policy requires one that identifies the app and a contact, and a generic/placeholder one is a common reason bulk downloaders get blocked.'
    );
    process.exit(1);
  }

  const outputDir = path.resolve(SCRIPT_DIR, config.outputDir || '../public/tiles');
  const delayMs = config.requestDelayMs ?? 600;

  let areas = config.areas || [];
  if (args.only) {
    areas = areas.filter((a) => a.name.toLowerCase().includes(args.only));
    if (areas.length === 0) {
      console.error(`No area name matches "${args.only}".`);
      process.exit(1);
    }
  }

  const plans = areas.map((area) => ({ name: area.name, ...planArea(area) }));
  const grandTotal = plans.reduce((sum, p) => sum + p.total, 0);

  console.log('Plan:');
  for (const plan of plans) {
    console.log(`  ${plan.name}: ${fmt(plan.total)} tiles`);
    for (const z of plan.perZoom) {
      console.log(`    z${z.z}: x[${z.xMin}-${z.xMax}] y[${z.yMin}-${z.yMax}] = ${fmt(z.count)} tiles`);
    }
  }
  console.log(`\nGrand total: ${fmt(grandTotal)} tiles`);
  console.log(`Estimated size: ~${((grandTotal * AVG_TILE_KB) / 1024 / 1024).toFixed(2)} GB`);
  console.log(`Estimated time at ${delayMs}ms/tile: ~${((grandTotal * delayMs) / 1000 / 60).toFixed(1)} minutes`);
  console.log(`Output: ${outputDir}`);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing downloaded.');
    return;
  }

  if (grandTotal > SAFETY_TILE_CAP && !args.force) {
    console.error(
      `\nThis plan requests ${fmt(grandTotal)} tiles, above the ${fmt(SAFETY_TILE_CAP)}-tile safety cap.\n` +
      `Narrow the area or zoom range, or re-run with --force if you're sure.`
    );
    process.exit(1);
  }

  console.log('\nDownloading...');
  let downloaded = 0, skipped = 0;
  const failures = [];
  const subdomainIndexRef = { i: 0 };

  for (const area of areas) {
    const { perZoom } = planArea(area);
    for (const zoomRange of perZoom) {
      for (let x = zoomRange.xMin; x <= zoomRange.xMax; x++) {
        for (let y = zoomRange.yMin; y <= zoomRange.yMax; y++) {
          const z = zoomRange.z;
          const result = await downloadTile({ z, x, y }, outputDir, config.userAgent, args.overwrite, subdomainIndexRef);
          if (result.status === 'downloaded') {
            downloaded++;
            await sleep(delayMs);
          } else if (result.status === 'skipped') {
            skipped++;
          } else {
            failures.push({ z, x, y, error: result.error });
          }

          const done = downloaded + skipped + failures.length;
          if (done % 100 === 0) {
            console.log(`  ${fmt(done)}/${fmt(grandTotal)} (downloaded ${fmt(downloaded)}, skipped ${fmt(skipped)}, failed ${fmt(failures.length)})`);
          }
        }
      }
    }
  }

  console.log(`\nDone. Downloaded ${fmt(downloaded)}, skipped ${fmt(skipped)} (already present), failed ${fmt(failures.length)}.`);
  if (failures.length > 0) {
    console.log('Failed tiles (re-run the script to retry — existing ones are skipped automatically):');
    for (const f of failures.slice(0, 20)) console.log(`  z${f.z}/${f.x}/${f.y}: ${f.error}`);
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  }

  // manifest.json always reflects the full config's intended coverage, not
  // just whichever subset --only filtered this particular run to — so the
  // in-app Tile Manager can show "what's bundled" from a single static file
  // instead of trying to inventory the bundled assets at runtime.
  const manifest = {
    generatedAt: new Date().toISOString(),
    areas: (config.areas || []).map((a) => ({
      name: a.name,
      south: a.south,
      west: a.west,
      north: a.north,
      east: a.east,
      minZoom: a.minZoom,
      maxZoom: a.maxZoom
    }))
  };
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nUpdated ${path.join(outputDir, 'manifest.json')} with ${manifest.areas.length} bundled area(s).`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
