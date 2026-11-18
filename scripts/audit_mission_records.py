#!/usr/bin/env python3
"""Read-only audit of a TEST mission's SQLite records.

This detects missing plot labels (the earlier GIS02 -> Crop Assessment bug),
invalid mission-to-field links, missing values and broken SQLite integrity.
It does NOT test the UI or future telemetry writes.
"""
import argparse
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--db', required=True, help='Path to test database (opened read-only)')
parser.add_argument('--mission-id', type=int, required=True)
parser.add_argument('--allow-missing-plot', action='store_true', help='Diagnostic only: do not fail on NULL plot')
a = parser.parse_args()
path = Path(a.db).resolve()
if not path.is_file():
    parser.error(f'Database does not exist: {path}')
conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
conn.execute('PRAGMA query_only = ON')
try:
    integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
    assert integrity == 'ok', f'SQLite integrity failed: {integrity}'
    mission = conn.execute('''SELECT m.id, m.name, f.id, f.name
        FROM missions m JOIN fields f ON m.field_id=f.id WHERE m.id=?''', (a.mission_id,)).fetchone()
    assert mission is not None, f'Mission {a.mission_id} has no valid field association'
    mid, mname, fid, fname = mission
    samples = conn.execute('''SELECT id, plot, ph, moisture, latitude, longitude
        FROM telemetry WHERE mission_id=? ORDER BY id''', (mid,)).fetchall()
    assert samples, f'Mission {mid} has no telemetry records'
    missing_plot = [s[0] for s in samples if not str(s[1] or '').strip()]
    mislabeled = [(s[0], s[1]) for s in samples if str(s[1] or '').strip() and s[1].strip() != fname]
    missing_ph = [s[0] for s in samples if s[2] is None]
    missing_moisture = [s[0] for s in samples if s[3] is None]
    missing_coords = [s[0] for s in samples if s[4] is None or s[5] is None]
    print(f'DB: {path}\nIntegrity: {integrity}\nMission: {mid} {mname}\nField: {fid} {fname}')
    print(f'Telemetry records: {len(samples)}')
    print(f'Missing plot labels: {len(missing_plot)}; mislabeled rows: {len(mislabeled)}')
    print(f'Missing pH: {len(missing_ph)}; moisture: {len(missing_moisture)}; coordinates: {len(missing_coords)}')
    assert not mislabeled, f'Incorrect plot associations: {mislabeled}'
    assert a.allow_missing_plot or not missing_plot, f'Missing plot label row IDs: {missing_plot}'
    assert not missing_ph and not missing_moisture, 'Some samples lack the expected analysis metrics'
    assert not missing_coords, 'Some samples lack coordinates required by GIS heatmapping'
    print('PASS: all configured database audits passed (read only)')
finally:
    conn.close()
