import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fixtureDetections, fixtureKey, fixturePlan, xyz } from './fixture.mjs';
import { decodeMvtPoints } from './mvt.mjs';
import { assertExact } from './ingestion.mjs';

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      rows.push([...row, cell]); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV cell.');
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function near(actual, expected, tolerance = 1e-8) {
  if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - expected) > tolerance) throw new Error('Coordinate or numeric value differs from fixture.');
}

export function verifyExportRows(rows, manifest, format) {
  const expected = fixtureDetections().filter((row) => row.scenario === 'included');
  if (manifest.fixture !== fixtureKey || manifest.dataset_sha256 !== fixturePlan().dataset_sha256) throw new Error('Manifest belongs to another fixture version.');
  assertExact(rows.length, expected.length, `${format} row count`);
  const byId = new Map(expected.map((row) => [manifest.detection_ids[row.native_record_key], row]));
  const seen = new Set();
  for (const row of rows) {
    assertExact(Object.keys(row).sort(), ['id', 'source_id', 'acquired_at', 'longitude', 'latitude', 'confidence_raw', 'day_night', 'frp_mw'].sort(), 'export property whitelist');
    const id = String(row.id);
    const value = byId.get(id);
    if (!value || seen.has(id)) throw new Error('Unexpected or duplicate detection ID.');
    seen.add(id);
    assertExact(row.source_id, manifest.source_id, 'source isolation');
    assertExact(new Date(row.acquired_at).toISOString(), value.acquired_at, 'UTC timestamp');
    assertExact(row.day_night, value.day_night, 'day/night');
    const confidence = format === 'csv' && /^[=+\-@]/.test(value.confidence_raw.trimStart()) ? `'${value.confidence_raw}` : value.confidence_raw;
    assertExact(row.confidence_raw, confidence, 'confidence and CSV neutralization');
    near(row.longitude, value.longitude); near(row.latitude, value.latitude); near(row.frp_mw, value.frp_mw);
  }
  return { format, verified_rows: seen.size };
}

export function expectedMvtGroups(tile) {
  const world = 40075016.68557849;
  const width = world / 2 ** tile.z;
  const cell = width / 64;
  const groups = new Map();
  for (const row of fixtureDetections().filter((value) => value.scenario === 'included')) {
    const position = xyz(row.longitude, row.latitude, tile.z);
    if (position.x !== tile.x || position.y !== tile.y) continue;
    const mx = row.longitude / 360 * world;
    const my = Math.log(Math.tan(Math.PI / 4 + row.latitude * Math.PI / 360)) * world / (2 * Math.PI);
    const x = Math.round((Math.round(mx / cell) * cell - (-world / 2 + tile.x * width)) / width * 4096);
    const y = Math.round(((world / 2 - tile.y * width) - Math.round(my / cell) * cell) / width * 4096);
    const key = `${x}:${y}`;
    const group = groups.get(key) ?? { x, y, count: 0, frp_mw: 0 };
    group.count++; group.frp_mw = Math.max(group.frp_mw, row.frp_mw);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function verifyMvt(buffer, tile) {
  const layers = decodeMvtPoints(buffer);
  const expected = expectedMvtGroups(tile);
  if (expected.length === 0 && layers.length === 0) return { ...tile, features: 0, detections: 0 };
  if (layers.length !== 1 || layers[0].name !== 'detections' || layers[0].extent !== 4096 || layers[0].version !== 2) throw new Error('Unexpected MVT layer, version or extent.');
  const features = layers[0].features;
  assertExact(features.length, expected.length, 'MVT aggregation group count');
  const matched = new Set();
  for (const feature of features) {
    assertExact(Object.keys(feature.properties).sort(), ['count', 'frp_mw'], 'MVT property whitelist');
    const index = expected.findIndex((group, i) => !matched.has(i) && Math.abs(group.x - feature.x) <= 1 && Math.abs(group.y - feature.y) <= 1);
    if (index < 0) throw new Error('MVT point is not at the expected projected position.');
    matched.add(index);
    assertExact(feature.properties.count, expected[index].count, 'MVT count');
    near(feature.properties.frp_mw, expected[index].frp_mw);
  }
  return { ...tile, features: features.length, detections: expected.reduce((sum, group) => sum + group.count, 0) };
}

async function main() {
  const args = process.argv.slice(2);
  const format = args[0];
  if (!format) { console.info('Usage: node scripts/phase4/verify.mjs mvt <file> <z/x/y> | csv|geojson|parquet <file> <manifest.json>'); return; }
  if (format === 'mvt') {
    if (args.length !== 3 || !/^\d+\/\d+\/\d+$/.test(args[2])) throw new Error('Expected file and z/x/y.');
    const [z, x, y] = args[2].split('/').map(Number);
    if (z > 18 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid fixture XYZ.');
    console.info(JSON.stringify(verifyMvt(await readFile(args[1]), { z, x, y })));
    return;
  }
  if (!['csv', 'geojson', 'parquet'].includes(format) || args.length !== 3) throw new Error('Expected format, downloaded file and fixture manifest.');
  const manifest = JSON.parse(await readFile(args[2], 'utf8'));
  let rows;
  if (format === 'csv') {
    const [header, ...values] = parseCsv(await readFile(args[1], 'utf8'));
    assertExact(header, ['id', 'source_id', 'acquired_at', 'longitude', 'latitude', 'confidence_raw', 'day_night', 'frp_mw'], 'CSV columns');
    rows = values.map((row) => {
      if (row.length !== header.length) throw new Error('Invalid CSV column count.');
      return Object.fromEntries(header.map((key, index) => [key, row[index]]));
    });
  } else if (format === 'geojson') {
    const content = JSON.parse(await readFile(args[1], 'utf8'));
    if (content.type !== 'FeatureCollection' || !Array.isArray(content.features)) throw new Error('Expected a GeoJSON FeatureCollection.');
    rows = content.features.map((feature) => {
      if (feature.type !== 'Feature' || feature.geometry?.type !== 'Point') throw new Error('Expected GeoJSON points.');
      return { ...feature.properties, id: feature.id, longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] };
    });
  } else {
    const require = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
    const { ParquetReader } = require('parquetjs-lite');
    const reader = await ParquetReader.openFile(args[1]);
    rows = [];
    try {
      const cursor = reader.getCursor();
      for (let row = await cursor.next(); row; row = await cursor.next()) {
        rows.push(row);
        if (rows.length > 256) throw new Error('Unexpected Parquet row count.');
      }
    } finally { await reader.close(); }
  }
  console.info(JSON.stringify(verifyExportRows(rows, manifest, format)));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
