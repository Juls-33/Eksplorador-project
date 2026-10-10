// Manages the SECOND tier of offline tiles — ones a user downloads themselves
// after installing the app — as opposed to the tiles bundled into public/tiles
// at build time (see scripts/download-tiles.mjs for those).
//
// Bundled tiles live inside the app's static assets and can't be written to at
// runtime, even in a published build — so anything downloaded through this
// in-app flow is saved under the app's local-data directory instead, which is
// writable, and is specific to the machine it was downloaded on (not shared,
// not synced, not committed to the repo).
//
// Requires these Tauri v2 capabilities (see src-tauri/capabilities/default.json):
//   fs:allow-mkdir, fs:allow-write-file, fs:allow-exists, fs:allow-read-dir,
//   fs:allow-write-text-file, fs:allow-read-text-file
// each scoped to "$APPLOCALDATA/tiles/**", plus app.security.assetProtocol
// enabled with that same path in tauri.conf.json (see HeatmapMap.jsx's use of
// convertFileSrc for why).

import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir, writeFile, writeTextFile, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { planArea, iterateTiles } from '../utils/tileMath';

// Deliberately stricter than the CLI script's cap (20,000) — this will
// eventually be used by people with no context on OSM's tile usage policy,
// so the UI should refuse large requests more readily than a developer
// running a script with their eyes on the output.
export const TILE_SAFETY_CAP = 8000;

const SUBDOMAINS = ['a', 'b', 'c'];
const REQUEST_DELAY_MS = 650;
const MAX_RETRIES = 3;

// IMPORTANT — product-level caveat, not just a code comment: every installed
// copy of a published app using this function hits OpenStreetMap's free tile
// server directly. One developer running download-tiles.mjs a few times is a
// trivial load; many end users each downloading areas is not, and is exactly
// what OSM's tile usage policy (https://operations.osmfoundation.org/policies/tiles/)
// exists to prevent. This is fine for internal/team use. Before a public
// release, this TILE_URL_TEMPLATE should point at a provider that explicitly
// licenses bulk/app-embedded tile downloads (e.g. MapTiler, Stadia Maps) using
// your own API key, rather than OSM's raw tile server.
const TILE_URL_TEMPLATE = (subdomain, z, x, y) => `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getUserTilesDir() {
  const base = await appLocalDataDir();
  return join(base, 'tiles');
}

async function getManifestPath() {
  return join(await getUserTilesDir(), 'manifest.json');
}

// Areas bundled with the app at build time — a static file, so this works
// identically in dev and in a packaged build, with no filesystem-scope
// configuration needed (it's just a normal fetch of a public asset).
export async function fetchBundledCoverage() {
  try {
    const res = await fetch('/tiles/manifest.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const manifest = await res.json();
    return (manifest.areas || []).map((a) => ({ ...a, source: 'bundled' }));
  } catch {
    return [];
  }
}

// Areas the user has downloaded themselves on this machine.
export async function fetchUserCoverage() {
  try {
    const manifestPath = await getManifestPath();
    if (!(await exists(manifestPath))) return [];
    const text = await readTextFile(manifestPath);
    const manifest = JSON.parse(text);
    return (manifest.areas || []).map((a) => ({ ...a, source: 'downloaded' }));
  } catch {
    return [];
  }
}

export async function fetchAllCoverage() {
  const [bundled, user] = await Promise.all([fetchBundledCoverage(), fetchUserCoverage()]);
  return [...bundled, ...user];
}

async function appendToUserManifest(area) {
  const manifestPath = await getManifestPath();
  let manifest = { areas: [] };
  if (await exists(manifestPath)) {
    try {
      manifest = JSON.parse(await readTextFile(manifestPath));
    } catch {
      manifest = { areas: [] };
    }
  }
  const withoutDupe = (manifest.areas || []).filter((a) => a.name !== area.name);
  manifest.areas = [...withoutDupe, { ...area, downloadedAt: new Date().toISOString() }];
  await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
}

// Pure planning — no network, no filesystem — so the UI can show a cost
// estimate before anything is downloaded, same as the CLI script's --dry-run.
export function estimateArea(area) {
  const { perZoom, total } = planArea(area);
  const avgKB = 18;
  return {
    perZoom,
    total,
    estimatedGB: (total * avgKB) / 1024 / 1024,
    estimatedMinutes: (total * REQUEST_DELAY_MS) / 1000 / 60
  };
}

// Downloads one named area into the user tiles directory. Throws if the plan
// exceeds TILE_SAFETY_CAP and `force` isn't passed — callers (the UI) should
// catch that specifically to show a confirmation step, not treat it as a
// generic failure. Pass an AbortSignal to cancel between (or during) tiles;
// tiles already saved are kept, and a cancelled area is NOT recorded in the
// coverage manifest since it is only partly downloaded.
export async function downloadArea(area, { force = false, onProgress = null, signal = null } = {}) {
  const plan = planArea(area);
  if (plan.total > TILE_SAFETY_CAP && !force) {
    const err = new Error(`This area is ${plan.total.toLocaleString()} tiles, above the ${TILE_SAFETY_CAP.toLocaleString()}-tile safety cap.`);
    err.code = 'SAFETY_CAP_EXCEEDED';
    err.planTotal = plan.total;
    throw err;
  }

  const userTilesDir = await getUserTilesDir();
  let downloaded = 0, skipped = 0;
  const failures = [];
  let subdomainIndex = 0;
  let cancelled = false;

  for (const tile of iterateTiles(plan)) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    const destDir = await join(userTilesDir, String(tile.z), String(tile.x));
    const destFile = await join(destDir, `${tile.y}.png`);

    if (await exists(destFile)) {
      skipped++;
    } else {
      const subdomain = SUBDOMAINS[subdomainIndex % SUBDOMAINS.length];
      subdomainIndex++;
      const url = TILE_URL_TEMPLATE(subdomain, tile.z, tile.x, tile.y);

      let ok = false;
      let lastError = null;
      for (let attempt = 1; attempt <= MAX_RETRIES && !ok; attempt++) {
        try {
          const res = await fetch(url, { signal: signal || undefined });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = new Uint8Array(await res.arrayBuffer());
          await mkdir(destDir, { recursive: true });
          await writeFile(destFile, buf);
          ok = true;
        } catch (err) {
          if (signal?.aborted) {
            cancelled = true;
            break;
          }
          lastError = err;
          if (attempt < MAX_RETRIES) await sleep(500 * attempt);
        }
      }

      if (cancelled) break;

      if (ok) {
        downloaded++;
        await sleep(REQUEST_DELAY_MS);
      } else {
        failures.push({ ...tile, error: String(lastError) });
      }
    }

    if (onProgress) {
      onProgress({ done: downloaded + skipped + failures.length, total: plan.total, downloaded, skipped, failed: failures.length });
    }
  }

  if (!cancelled) await appendToUserManifest(area);

  return { downloaded, skipped, failures, cancelled };
}

// ---------------------------------------------------------------------------
// Background download job
//
// Download state lives here, at module level, instead of inside
// TileManagerView. That view is unmounted whenever you switch tabs, which used
// to throw away its progress display (and let you start a second, overlapping
// download on return). Now the job belongs to the app session; views only
// subscribe to it. Closing the app still stops a job — but tiles already saved
// are reused (skipped) when you download the same area again.
// ---------------------------------------------------------------------------
const IDLE_JOB = { status: 'idle', area: null, progress: null, result: null, error: null, cancelRequested: false };
let job = IDLE_JOB;
let abortController = null;
const listeners = new Set();

function setJob(patch) {
  job = { ...job, ...patch };
  listeners.forEach((listener) => listener(job));
}

export function getDownloadJob() {
  return job;
}

export function subscribeDownloadJob(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Starts a download in the background and returns immediately. Throws
// synchronously (code JOB_RUNNING / SAFETY_CAP_EXCEEDED) if it can't start.
export function startDownload(area, { force = false } = {}) {
  if (job.status === 'running') {
    const err = new Error('A map download is already running.');
    err.code = 'JOB_RUNNING';
    throw err;
  }

  const plan = planArea(area);
  if (plan.total > TILE_SAFETY_CAP && !force) {
    const err = new Error(`This area is ${plan.total.toLocaleString()} tiles, above the ${TILE_SAFETY_CAP.toLocaleString()}-tile safety cap.`);
    err.code = 'SAFETY_CAP_EXCEEDED';
    err.planTotal = plan.total;
    throw err;
  }

  const controller = new AbortController();
  abortController = controller;
  setJob({
    status: 'running',
    area,
    progress: { done: 0, total: plan.total, downloaded: 0, skipped: 0, failed: 0 },
    result: null,
    error: null,
    cancelRequested: false
  });

  downloadArea(area, { force: true, signal: controller.signal, onProgress: (progress) => setJob({ progress }) })
    .then((result) => setJob({ status: result.cancelled ? 'cancelled' : 'done', result }))
    .catch((err) => setJob({ status: 'error', error: err.message || 'Download failed.' }))
    .finally(() => {
      if (abortController === controller) abortController = null;
    });
}

export function cancelDownload() {
  if (abortController) {
    setJob({ cancelRequested: true });
    abortController.abort();
  }
}

// Clears a finished/cancelled/failed job's summary. No-op while running.
export function dismissDownloadJob() {
  if (job.status !== 'running') setJob({ ...IDLE_JOB });
}