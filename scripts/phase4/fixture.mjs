import { createHash } from 'node:crypto';

export const fixtureKey = 'phase4-rif-v1';
export const actor = 'phase4-fixture:rif:v1';
export const instant = '2026-08-05T00:00:00.000Z';
export const startDate = '2026-08-01';
export const endDate = '2026-08-04';
export const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function fixtureUuid(label) {
  const hash = sha256(`${fixtureKey}:${label}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export const ids = Object.fromEntries(['release', 'other-release', 'asset', 'other-asset', 'pipeline', 'other-pipeline',
  'main', 'overlap', 'quarantined', 'incomplete', 'other'].map((key) => [key, fixtureUuid(key)]));
export const areaInput = {
  name: 'PHASE4 synthetic Rif AOI', version: fixtureKey, display_timezone: 'Africa/Casablanca', provenance: fixtureKey,
  geometry: { type: 'Polygon', coordinates: [[[-6.4, 34.8], [-3.6, 34.8], [-3.6, 35.9], [-6.4, 35.9], [-6.4, 34.8]]] }
};
export const sourceInput = {
  name: 'PHASE4 synthetic hotspots', provider: 'FIREBRIDGE local test fixtures', kind: 'hotspots',
  platform: 'synthetic', instrument: 'synthetic', product: 'SYNTHETIC-DETECTIONS', collection: fixtureKey,
  processingStream: 'standard', documentationUrl: 'https://example.invalid/firebridge/phase4',
  citation: 'Synthetic coordinates near Moroccan localities; these records are not observed fires.',
  licenseInfo: 'Locally generated test data.', nativeResolutionM: 375, schemaVersion: '1',
  metadata: { phase4_fixture: fixtureKey, synthetic: true }
};
export const clusters = [
  { key: 'larache', longitude: -6.156, latitude: 35.193 },
  { key: 'chefchaouen', longitude: -5.264, latitude: 35.169 },
  { key: 'tetouan', longitude: -5.363, latitude: 35.589 },
  { key: 'al-hoceima', longitude: -3.931, latitude: 35.245 }
];
const dangerous = ['=1+1', '+SUM(1,1)', '-test', '@test', '  =1+1', 'quoted,"text"\nsecond line'];
export function fixtureDetections() {
  const rows = clusters.flatMap((cluster, clusterIndex) => Array.from({ length: 64 }, (_, i) => ({
    native_record_key: `${cluster.key}-${String(i).padStart(3, '0')}`,
    longitude: Number((cluster.longitude + (i % 8 - 3.5) * 0.001).toFixed(7)),
    latitude: Number((cluster.latitude + (Math.floor(i / 8) - 3.5) * 0.001).toFixed(7)),
    acquired_at: new Date(Date.UTC(2026, 7, 1 + i % 3, 10 + clusterIndex, i % 60)).toISOString(),
    processing_level: 'standard', confidence_raw: clusterIndex === 0 && i < dangerous.length ? dangerous[i] : '85',
    day_night: i % 2 === 0 ? 'day' : 'night', frp_mw: 1 + (i % 20) / 2,
    scenario: 'included', partition: 'main', asset: 'asset'
  })));
  const base = { ...rows[0], longitude: -5.28, latitude: 35.18, confidence_raw: 'counterexample' };
  const excluded = [
    { scenario: 'outside-aoi', longitude: -7.5898, latitude: 33.5731 },
    { scenario: 'before-start', acquired_at: '2026-07-31T23:59:59.000Z' },
    { scenario: 'at-exclusive-end', acquired_at: '2026-08-04T00:00:00.000Z' },
    { scenario: 'nrt', processing_level: 'nrt' },
    { scenario: 'unlinked', partition: null },
    { scenario: 'other-release', partition: 'other', asset: 'other-asset' },
    { scenario: 'quarantined', partition: 'quarantined' },
    { scenario: 'incomplete', partition: 'incomplete' }
  ].map((patch) => ({ ...base, ...patch, native_record_key: `exclude-${patch.scenario}` }));
  return [...rows, ...excluded];
}

export function xyz(longitude, latitude, z) {
  const size = 2 ** z;
  const radians = latitude * Math.PI / 180;
  return { z, x: Math.floor((longitude + 180) / 360 * size),
    y: Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size) };
}

export function expectedTiles(rows = fixtureDetections().filter((row) => row.scenario === 'included')) {
  return [0, 4, 8, 12, 16, 18].flatMap((z) => {
    const tiles = new Map();
    for (const row of rows) {
      const tile = xyz(row.longitude, row.latitude, z);
      const key = `${tile.x}/${tile.y}`;
      const entry = tiles.get(key) ?? { ...tile, detection_count: 0, max_frp_mw: 0 };
      entry.detection_count++;
      entry.max_frp_mw = Math.max(entry.max_frp_mw, row.frp_mw);
      tiles.set(key, entry);
    }
    return [...tiles.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  });
}

export function fixturePlan() {
  const rows = fixtureDetections();
  const included = rows.filter((row) => row.scenario === 'included');
  return { fixture: fixtureKey, dataset_sha256: sha256(rows), actor, srid: 4326,
    start_date: startDate, end_date_exclusive: endDate, generated_ids: ids,
    source: sourceInput.name, area: areaInput, clusters,
    detections_total: rows.length, detections_expected: included.length,
    day_expected: included.filter((row) => row.day_night === 'day').length,
    night_expected: included.filter((row) => row.day_night === 'night').length,
    frp_sum_expected: included.reduce((sum, row) => sum + row.frp_mw, 0),
    excluded: rows.filter((row) => row.scenario !== 'included').map((row) => row.scenario),
    tile_expectations: expectedTiles(included), empty_tile: { z: 8, x: 0, y: 0, detection_count: 0 },
    execution: 'Preview only. No database connection. Apply requires --apply --confirm-database <name>.' };
}
