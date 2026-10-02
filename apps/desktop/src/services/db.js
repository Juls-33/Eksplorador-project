import { invoke } from '@tauri-apps/api/core';
import {
  open,
  save,
  confirm
} from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

import {
  boundaryToGeoJSON,
  geoJSONToBoundary,
  pinsToGeoJSON,
  geoJSONToPins
} from '../utils/fieldGeo';

import {
  mergeDatabasePackages,
  packageCounts
} from '../utils/databaseMerge';

import {
  appDate,
  appTimestamp
} from '../utils/time';

let dbPromise = null;

// All frontend queries now use the same Rust database connection
// as the serial telemetry logger.
export async function initDatabase() {
  if (!dbPromise) {
    dbPromise = (async () => {
      await invoke('init_db');

      const db = {
        select: (sql, values = []) =>
          invoke('database_select', {
            sql,
            values
          }),

        execute: (sql, values = []) =>
          invoke('database_execute', {
            sql,
            values
          })
      };

      // Consolidate the older SQL-plugin store once.
      // Its original database file is left intact.
      const legacy = await invoke(
        'legacy_database_snapshot'
      );

      if (legacy) {
        await commitMerge([legacy], true);
      }

      await seedDefaultCropProfiles(db);

      return db;
    })().catch(error => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

async function commitMerge(
  packages,
  consolidateLegacy = false
) {
  // Sensor writes may arrive while a merge is being planned.
  // Retry against a fresh snapshot instead of overwriting
  // newly collected readings with an older snapshot.
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await invoke(
      'database_snapshot'
    );

    const plan = await mergeDatabasePackages(
      current,
      packages
    );

    try {
      const result = await invoke(
        'replace_database',
        {
          data: plan.data,
          expectedRevision: current.revision,
          consolidateLegacy
        }
      );

      return {
        ...result,
        added: plan.added,
        skipped: plan.skipped,
        renamed: plan.renamed
      };
    } catch (error) {
      if (
        !String(error).includes('DATABASE_CHANGED')
      ) {
        throw error;
      }
    }
  }

  throw new Error(
    'New readings kept arriving during the merge. ' +
    'Pause logging and try again. No merge was applied.'
  );
}

export async function getDatabaseStatus() {
  await initDatabase();
  return invoke('database_status');
}

// ---------------------------------------------------------------------------
// Crop profiles
// ---------------------------------------------------------------------------

const t = (
  minPh,
  maxPh,
  minMoisture,
  maxMoisture,
  minEC,
  maxEC,
  minN,
  maxN,
  minP,
  maxP,
  minK,
  maxK
) => ({
  minPh,
  maxPh,
  minMoisture,
  maxMoisture,
  minEC,
  maxEC,
  minN,
  maxN,
  minP,
  maxP,
  minK,
  maxK
});

const DEFAULT_CROP_PROFILES = [
  {
    id: 'CRP-001',
    name: 'Rice (Oryza sativa)',
    category: 'Cereal / Grain',
    notes: '',
    thresholds: t(
      5.5, 7.0,
      40, 80,
      0.5, 2.0,
      20, 40,
      30, 50,
      40, 70
    )
  },
  {
    id: 'CRP-002',
    name: 'Sweet Corn (Zea mays)',
    category: 'Cereal / Grain',
    notes: '',
    thresholds: t(
      5.8, 7.2,
      30, 60,
      0.8, 1.8,
      30, 50,
      25, 45,
      35, 60
    )
  },
  {
    id: 'CRP-003',
    name: 'Cassava / Tuber',
    category: 'Root Crop',
    notes: '',
    thresholds: t(
      5.0, 6.5,
      25, 50,
      0.4, 1.2,
      15, 30,
      20, 35,
      40, 60
    )
  },
  {
    id: 'CRP-004',
    name: 'Leafy Greens (Pechay / Brassica)',
    category: 'Vegetable',
    notes: '',
    thresholds: t(
      6.0, 7.5,
      50, 75,
      1.0, 2.5,
      35, 60,
      30, 50,
      40, 65
    )
  }
];

async function upsertCropProfile(db, crop) {
  const th = crop.thresholds;

  // Update the existing row instead of deleting/replacing it.
  // The database trigger preserves created_at and refreshes updated_at.
  await db.execute(
    `INSERT INTO crop_profiles (
       id,
       name,
       category,
       min_ph,
       max_ph,
       min_moisture,
       max_moisture,
       min_ec,
       max_ec,
       min_n,
       max_n,
       min_p,
       max_p,
       min_k,
       max_k,
       notes
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15, $16
     )
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       min_ph = excluded.min_ph,
       max_ph = excluded.max_ph,
       min_moisture = excluded.min_moisture,
       max_moisture = excluded.max_moisture,
       min_ec = excluded.min_ec,
       max_ec = excluded.max_ec,
       min_n = excluded.min_n,
       max_n = excluded.max_n,
       min_p = excluded.min_p,
       max_p = excluded.max_p,
       min_k = excluded.min_k,
       max_k = excluded.max_k,
       notes = excluded.notes`,
    [
      crop.id,
      crop.name,
      crop.category,
      th.minPh,
      th.maxPh,
      th.minMoisture,
      th.maxMoisture,
      th.minEC,
      th.maxEC,
      th.minN,
      th.maxN,
      th.minP,
      th.maxP,
      th.minK,
      th.maxK,
      crop.notes || ''
    ]
  );
}

// Seed once. Importing an intentionally empty crop table must not
// silently recreate default records on the next app launch.
async function seedDefaultCropProfiles(db) {
  const seeded = await db.select(
    "SELECT value FROM _app_meta WHERE key='crop_defaults_seeded'"
  );

  if (seeded[0]?.value === '1') {
    return;
  }

  const rows = await db.select(
    'SELECT COUNT(*) AS total FROM crop_profiles'
  );

  if (!rows[0]?.total) {
    for (const crop of DEFAULT_CROP_PROFILES) {
      await upsertCropProfile(db, crop);
    }
  }

  await db.execute(
    `INSERT INTO _app_meta(key, value)
     VALUES('crop_defaults_seeded', '1')
     ON CONFLICT(key)
     DO UPDATE SET value='1'`
  );
}

function rowToCrop(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    notes: row.notes || '',
    thresholds: {
      minPh: row.min_ph,
      maxPh: row.max_ph,
      minMoisture: row.min_moisture,
      maxMoisture: row.max_moisture,
      minEC: row.min_ec,
      maxEC: row.max_ec,
      minN: row.min_n,
      maxN: row.max_n,
      minP: row.min_p,
      maxP: row.max_p,
      minK: row.min_k,
      maxK: row.max_k
    }
  };
}

export async function fetchCropProfiles() {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      'SELECT * FROM crop_profiles ORDER BY id ASC'
    );

    return rows.map(rowToCrop);
  } catch (error) {
    console.error(
      'Failed to fetch crop profiles:',
      error
    );
    return [];
  }
}

export async function saveCropProfile(crop) {
  try {
    const db = await initDatabase();

    await upsertCropProfile(db, crop);

    return true;
  } catch (error) {
    console.error(
      'Failed to save crop profile:',
      error
    );
    return null;
  }
}

export async function deleteCropProfile(id) {
  try {
    const db = await initDatabase();

    await db.execute(
      'DELETE FROM crop_profiles WHERE id = $1',
      [id]
    );

    return true;
  } catch (error) {
    console.error(
      'Failed to delete crop profile:',
      error
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Telemetry and samples
// ---------------------------------------------------------------------------

export async function fetchRecordedPlots() {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      `SELECT plot, COUNT(*) AS sample_count
       FROM telemetry
       WHERE plot IS NOT NULL AND plot != ''
       GROUP BY plot
       ORDER BY plot ASC`
    );

    return rows.map(row => ({
      plot: row.plot,
      sampleCount: row.sample_count
    }));
  } catch (error) {
    console.error(
      'Failed to fetch recorded plots:',
      error
    );
    return [];
  }
}

export async function fetchPlotSamples(plot) {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      `SELECT *
       FROM telemetry
       WHERE plot = $1
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL
       ORDER BY timestamp ASC`,
      [plot]
    );

    return rows.map(row => ({
      ...row,
      lat: row.latitude,
      lng: row.longitude,
      coords: [
        row.latitude,
        row.longitude
      ],
      n: row.nitrogen,
      p: row.phosphorus,
      k: row.potassium
    }));
  } catch (error) {
    console.error(
      'Failed to fetch plot samples:',
      error
    );
    return [];
  }
}

export async function saveSoilSample(sample) {
  try {
    const db = await initDatabase();

    await db.execute(
      `INSERT INTO telemetry (
         mission_id,
         plot,
         timestamp,
         latitude,
         longitude,
         moisture,
         ph,
         ec,
         nitrogen,
         phosphorus,
         potassium,
         overall
       )
       VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11, $12
       )`,
      [
        sample.mission_id ?? null,
        sample.plot || 'Main Field',
        sample.timestamp,
        sample.lat ?? sample.coords?.[0] ?? null,
        sample.lng ?? sample.coords?.[1] ?? null,
        sample.moisture,
        sample.ph,
        sample.ec,
        sample.n,
        sample.p,
        sample.k,
        sample.overall ?? 50
      ]
    );

    return true;
  } catch (error) {
    console.error(
      'Failed to save soil sample to SQLite:',
      error
    );
    return null;
  }
}

export async function fetchMissionSamples(missionId) {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      `SELECT *
       FROM telemetry
       WHERE mission_id = $1
       ORDER BY timestamp ASC`,
      [missionId]
    );

    return rows.map(row => ({
      ...row,
      lat: row.latitude,
      lng: row.longitude,
      coords: [
        row.latitude,
        row.longitude
      ],
      n: row.nitrogen,
      p: row.phosphorus,
      k: row.potassium
    }));
  } catch (error) {
    console.error(
      'Failed to fetch mission samples:',
      error
    );
    return [];
  }
}

export async function getAllTelemetry() {
  try {
    const db = await initDatabase();

    return await db.select(
      'SELECT * FROM telemetry ORDER BY timestamp DESC'
    );
  } catch (error) {
    console.error(
      'Failed to fetch all telemetry:',
      error
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Full database export, replacement import, and multi-file merge
// ---------------------------------------------------------------------------

export async function exportTelemetryPackage() {
  const status = await getDatabaseStatus();

  if (status.total === 0) {
    throw new Error('The database is empty.');
  }

  const suggestedName =
    'eksplorador_database_' +
    appTimestamp()
      .slice(0, 19)
      .replace(/[:T]/g, '-') +
    '.json';

  const filePath = await save({
    title: 'Export entire database',
    defaultPath: suggestedName,
    filters: [
      {
        name: 'Eksplorador database backup',
        extensions: ['json']
      }
    ]
  });

  if (!filePath) {
    return {
      success: false,
      cancelled: true
    };
  }

  const exportToPath = overwrite =>
    invoke('export_database', {
      filePath,
      overwrite
    });

  try {
    return {
      success: true,
      path: await exportToPath(false),
      cancelled: false
    };
  } catch (error) {
    if (
      !String(error).includes('EXPORT_FILE_EXISTS')
    ) {
      throw error;
    }

    const actualPath = /\.json$/i.test(filePath)
      ? filePath
      : filePath + '.json';

    const replace = await confirm(
      `This file already exists:\n${actualPath}\n\nReplace it?`,
      {
        title: 'Replace export file',
        kind: 'warning'
      }
    );

    if (!replace) {
      return {
        success: false,
        cancelled: true
      };
    }

    return {
      success: true,
      path: await exportToPath(true),
      cancelled: false
    };
  }
}

async function readBackup(path) {
  const fileContent = await readTextFile(path);

  // Validate every table, column, primary key and relationship
  // before asking the operator to apply the backup.
  return invoke(
    'validate_database_backup',
    { fileContent }
  );
}

export async function importTelemetryPackage() {
  await initDatabase();

  const selected = await open({
    title: 'Import database — replace all current data',
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Eksplorador database backup',
        extensions: ['json']
      }
    ]
  });

  if (!selected) {
    return {
      success: false,
      cancelled: true
    };
  }

  const path = Array.isArray(selected)
    ? selected[0]
    : selected;

  const data = await readBackup(path);

  const summary = Object.entries(
    packageCounts(data)
  )
    .map(([name, count]) => `${name}: ${count}`)
    .join('\n');

  const replace = await confirm(
    `Replace ALL current database data with:\n${path}` +
    `\n\n${summary}` +
    '\n\nRecords absent from this backup will be removed.' +
    ' Export your current database first if you need to keep it.' +
    ' Use Merge Data to combine instead.',
    {
      title: 'Replace database',
      kind: 'warning',
      okLabel: 'Replace database',
      cancelLabel: 'Cancel'
    }
  );

  if (!replace) {
    return {
      success: false,
      cancelled: true
    };
  }

  const result = await invoke(
    'replace_database',
    {
      data,
      expectedRevision: null,
      consolidateLegacy: false
    }
  );

  return {
    ...result,
    success: true,
    cancelled: false
  };
}

export async function mergeDatabaseFiles() {
  await initDatabase();

  const selected = await open({
    title: 'Select database backups to merge',
    multiple: true,
    directory: false,
    filters: [
      {
        name: 'Eksplorador database backups',
        extensions: ['json']
      }
    ]
  });

  if (!selected || selected.length === 0) {
    return {
      success: false,
      cancelled: true
    };
  }

  const paths = Array.isArray(selected)
    ? selected
    : [selected];

  const packages = [];

  for (const path of paths) {
    packages.push(await readBackup(path));
  }

  const count = packages.reduce(
    (sum, data) =>
      sum +
      Object.values(packageCounts(data)).reduce(
        (subtotal, tableCount) =>
          subtotal + tableCount,
        0
      ),
    0
  );

  const merge = await confirm(
    `Merge ${paths.length} backup file(s), containing ` +
    `${count} records, into the current database?` +
    '\n\nExisting records are kept.' +
    ' Conflicting IDs receive new IDs, with their field' +
    ' and mission links updated.' +
    ' Previously merged identical records are skipped.' +
    `\n\n${paths.join('\n')}`,
    {
      title: 'Merge database files',
      kind: 'info',
      okLabel: 'Merge files',
      cancelLabel: 'Cancel'
    }
  );

  if (!merge) {
    return {
      success: false,
      cancelled: true
    };
  }

  const result = await commitMerge(packages);

  return {
    ...result,
    success: true,
    cancelled: false
  };
}

// ---------------------------------------------------------------------------
// Fields and missions
// ---------------------------------------------------------------------------

function rowToField(row, missionCount = 0) {
  return {
    id: row.id,
    name: row.name,
    boundary: geoJSONToBoundary(
      row.boundary_geojson
    ),
    missionCount
  };
}

function rowToMission(row, sampleCount = 0) {
  return {
    id: row.id,
    fieldId: row.field_id,
    fieldName: row.field_name,
    name: row.name,
    date: String(
      row.mission_date || ''
    ).slice(0, 10),
    status: row.status,
    waypoints: geoJSONToPins(
      row.pins_geojson
    ),
    sampleCount
  };
}

export async function fetchFields() {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      `SELECT
         f.*,
         (
           SELECT COUNT(*)
           FROM missions m
           WHERE m.field_id = f.id
         ) AS mission_count
       FROM fields f
       ORDER BY LOWER(f.name) ASC`
    );

    return rows.map(row =>
      rowToField(row, row.mission_count)
    );
  } catch (error) {
    console.error(
      'Failed to fetch fields:',
      error
    );
    return [];
  }
}

export async function createField({
  name,
  boundary
}) {
  try {
    const db = await initDatabase();
    const trimmed = String(name || '').trim();

    if (!trimmed) {
      return {
        error: 'Field name cannot be empty.'
      };
    }

    const clash = await db.select(
      `SELECT id
       FROM fields
       WHERE LOWER(name) = LOWER($1)`,
      [trimmed]
    );

    if (clash.length > 0) {
      return {
        error:
          `A field named "${trimmed}" already exists.`
      };
    }

    const inserted = await db.execute(
      `INSERT INTO fields (
         name,
         boundary_geojson
       )
       VALUES ($1, $2)`,
      [
        trimmed,
        boundaryToGeoJSON(boundary)
      ]
    );

    const rows = await db.select(
      'SELECT * FROM fields WHERE id = $1',
      [inserted.lastInsertId]
    );

    return {
      field: rowToField(rows[0])
    };
  } catch (error) {
    console.error(
      'Failed to create field:',
      error
    );

    return {
      error: 'Could not save the field to the database.'
    };
  }
}

export async function updateFieldBoundary(
  id,
  boundary
) {
  try {
    const db = await initDatabase();

    await db.execute(
      `UPDATE fields
       SET boundary_geojson = $1
       WHERE id = $2`,
      [
        boundaryToGeoJSON(boundary),
        id
      ]
    );

    const rows = await db.select(
      `SELECT
         f.*,
         (
           SELECT COUNT(*)
           FROM missions m
           WHERE m.field_id = f.id
         ) AS mission_count
       FROM fields f
       WHERE f.id = $1`,
      [id]
    );

    return rows[0]
      ? rowToField(
          rows[0],
          rows[0].mission_count
        )
      : null;
  } catch (error) {
    console.error(
      'Failed to update field boundary:',
      error
    );
    return null;
  }
}

// Telemetry also stores the field's name in plot.
export async function renameField(id, newName) {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      'SELECT name FROM fields WHERE id = $1',
      [id]
    );

    if (!rows[0]) {
      return null;
    }

    await db.execute(
      `UPDATE fields
       SET name = $1
       WHERE id = $2`,
      [newName, id]
    );

    await db.execute(
      `UPDATE telemetry
       SET plot = $1
       WHERE plot = $2`,
      [
        newName,
        rows[0].name
      ]
    );

    return true;
  } catch (error) {
    console.error(
      'Failed to rename field:',
      error
    );
    return null;
  }
}

// Only fields without missions can be removed.
export async function deleteField(id) {
  try {
    const db = await initDatabase();

    const used = await db.select(
      `SELECT COUNT(*) AS total
       FROM missions
       WHERE field_id = $1`,
      [id]
    );

    if (used[0]?.total > 0) {
      return null;
    }

    await db.execute(
      'DELETE FROM fields WHERE id = $1',
      [id]
    );

    return true;
  } catch (error) {
    console.error(
      'Failed to delete field:',
      error
    );
    return null;
  }
}

export async function fetchMissions() {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      `SELECT m.*, f.name AS field_name
       FROM missions m
       JOIN fields f ON f.id = m.field_id
       ORDER BY m.mission_date DESC, m.id DESC`
    );

    const counts = await db.select(
      `SELECT mission_id, COUNT(*) AS total
       FROM telemetry
       GROUP BY mission_id`
    );

    const countById = Object.fromEntries(
      counts.map(row => [
        String(row.mission_id),
        row.total
      ])
    );

    return rows.map(row =>
      rowToMission(
        row,
        countById[String(row.id)] || 0
      )
    );
  } catch (error) {
    console.error(
      'Failed to fetch missions:',
      error
    );
    return [];
  }
}

export async function createMission({
  fieldId,
  name,
  date,
  pins
}) {
  try {
    const db = await initDatabase();

    const inserted = await db.execute(
      `INSERT INTO missions (
         field_id,
         name,
         mission_date,
         pins_geojson,
         status
       )
       VALUES ($1, $2, $3, $4, 'in_progress')`,
      [
        fieldId,
        String(name).trim(),
        date,
        pinsToGeoJSON(pins)
      ]
    );

    const rows = await db.select(
      `SELECT m.*, f.name AS field_name
       FROM missions m
       JOIN fields f ON f.id = m.field_id
       WHERE m.id = $1`,
      [inserted.lastInsertId]
    );

    return rows[0]
      ? rowToMission(rows[0], 0)
      : null;
  } catch (error) {
    console.error(
      'Failed to create mission:',
      error
    );
    return null;
  }
}

export async function updateMissionStatus(
  id,
  status
) {
  try {
    const db = await initDatabase();

    await db.execute(
      `UPDATE missions
       SET status = $1
       WHERE id = $2`,
      [status, id]
    );

    return true;
  } catch (error) {
    console.error(
      'Failed to update mission status:',
      error
    );
    return null;
  }
}

// All georeferenced samples across the missions on one field.
export async function fetchFieldSamples(fieldId) {
  try {
    const db = await initDatabase();

    const rows = await db.select(
      `SELECT t.*
       FROM telemetry t
       JOIN missions m
         ON CAST(t.mission_id AS TEXT) =
            CAST(m.id AS TEXT)
       WHERE m.field_id = $1
         AND t.latitude IS NOT NULL
         AND t.longitude IS NOT NULL
       ORDER BY t.timestamp ASC`,
      [fieldId]
    );

    return rows.map(row => ({
      ...row,
      lat: row.latitude,
      lng: row.longitude,
      coords: [
        row.latitude,
        row.longitude
      ],
      n: row.nitrogen,
      p: row.phosphorus,
      k: row.potassium
    }));
  } catch (error) {
    console.error(
      'Failed to fetch field samples:',
      error
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Field amendments and treatments
// ---------------------------------------------------------------------------

export async function fetchFieldAmendments(fieldId) {
  try {
    const db = await initDatabase();

    return await db.select(
      `SELECT *
       FROM field_amendments
       WHERE field_id = $1
       ORDER BY date DESC, id DESC`,
      [fieldId]
    );
  } catch (error) {
    console.error(
      'Failed to fetch field amendments:',
      error
    );
    return [];
  }
}

export async function createFieldAmendment({
  fieldId,
  date,
  treatment,
  operator
}) {
  try {
    const db = await initDatabase();

    const trimmed = String(
      treatment || ''
    ).trim();

    if (!trimmed) {
      return null;
    }

    await db.execute(
      `INSERT INTO field_amendments (
         field_id,
         date,
         treatment,
         operator
       )
       VALUES ($1, $2, $3, $4)`,
      [
        fieldId,
        date || appDate(),
        trimmed,
        operator || 'Operator'
      ]
    );

    return await fetchFieldAmendments(fieldId);
  } catch (error) {
    console.error(
      'Failed to save field amendment:',
      error
    );
    return null;
  }
}