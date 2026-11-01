import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fixtureDetections, fixturePlan, ids } from '../../../scripts/phase4/fixture.mjs';
import { validateTargets } from '../../../scripts/phase4/environment.mjs';
import { assertExact } from '../../../scripts/phase4/ingestion.mjs';
import { decodeMvtPoints } from '../../../scripts/phase4/mvt.mjs';
import { expectedMvtGroups, parseCsv, verifyExportRows, verifyMvt } from '../../../scripts/phase4/verify.mjs';
import { writeExport } from '../../worker/src/exports/write-export.js';

const testEnv = { TEST_DATABASE_URL: 'postgresql://test:test@localhost:5432/firebridge_test', TEST_REDIS_URL: 'redis://localhost:6379/15' };
const included = fixtureDetections().filter((row) => row.scenario === 'included');
const manifest = { ...fixturePlan(), source_id: 'fixture-source',
  detection_ids: Object.fromEntries(fixtureDetections().map((row, index) => [row.native_record_key, String(index + 1)])) };
function exportRows() {
  return included.map((row) => ({ id: manifest.detection_ids[row.native_record_key], source_id: manifest.source_id,
    acquired_at: row.acquired_at, longitude: row.longitude, latitude: row.latitude,
    confidence_raw: row.confidence_raw, day_night: row.day_night, frp_mw: row.frp_mw }));
}

function uint(value: number) {
  const bytes = [];
  do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Buffer.from(bytes);
}
function bytes(field: number, data: Buffer) { return Buffer.concat([uint(field * 8 + 2), uint(data.length), data]); }
function integer(field: number, value: number) { return Buffer.concat([uint(field * 8), uint(value)]); }
function double(value: number) { const buffer = Buffer.alloc(9); buffer[0] = 25; buffer.writeDoubleLE(value, 1); return buffer; }
function encodedWorldTile(countOffset = 0) {
  const groups = expectedMvtGroups({ z: 0, x: 0, y: 0 });
  const features = groups.map((group, i) => bytes(2, Buffer.concat([
    bytes(2, Buffer.concat([uint(0), uint(i * 2), uint(1), uint(i * 2 + 1)])), integer(3, 1),
    bytes(4, Buffer.concat([uint(9), uint(group.x * 2), uint(group.y * 2)]))
  ])));
  const layer = Buffer.concat([integer(15, 2), bytes(1, Buffer.from('detections')), ...features,
    bytes(3, Buffer.from('count')), bytes(3, Buffer.from('frp_mw')),
    ...groups.flatMap((group) => [bytes(4, double(group.count + countOffset)), bytes(4, double(group.frp_mw))]), integer(5, 4096)]);
  return bytes(3, layer);
}

describe('Deterministic Phase 4 fixture', () => {
  it('has a stable versioned fingerprint and generated UUIDs', () => {
    expect(fixturePlan().dataset_sha256).toBe('89d0f21af494e90da34c53d308cef70b65b0503f222f41826fa0c1f42b929575');
    expect(fixtureDetections()).toEqual(fixtureDetections());
    expect(new Set(Object.values(ids)).size).toBe(Object.keys(ids).length);
    for (const id of Object.values(ids)) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('provides 256 admissible detections and eight independent counterexamples', () => {
    const plan = fixturePlan();
    expect(plan.detections_total).toBe(264);
    expect(plan.detections_expected).toBe(256);
    expect(plan.day_expected).toBe(128);
    expect(plan.night_expected).toBe(128);
    expect(plan.frp_sum_expected).toBe(1408);
    expect(plan.excluded).toHaveLength(8);
    for (const row of included) {
      expect(row.longitude).toBeGreaterThan(-6.4); expect(row.longitude).toBeLessThan(-3.6);
      expect(row.latitude).toBeGreaterThan(34.8); expect(row.latitude).toBeLessThan(35.9);
      expect(Date.parse(row.acquired_at)).toBeGreaterThanOrEqual(Date.parse('2026-08-01T00:00:00Z'));
      expect(Date.parse(row.acquired_at)).toBeLessThan(Date.parse('2026-08-04T00:00:00Z'));
    }
  });
  it('contains a complete 260-row main partition plus isolated bad partitions', () => {
    const rows = fixtureDetections();
    expect(rows.filter((row) => row.partition === 'main')).toHaveLength(260);
    for (const partition of ['other', 'quarantined', 'incomplete']) expect(rows.filter((row) => row.partition === partition)).toHaveLength(1);
    expect(rows.filter((row) => row.partition === null)).toHaveLength(1);
  });
  it('spans four zoom-8 tiles and conserves counts at every tested zoom', () => {
    const tiles = fixturePlan().tile_expectations;
    expect(tiles.filter((tile) => tile.z === 8)).toEqual([
      { z: 8, x: 123, y: 101, detection_count: 64, max_frp_mw: 10.5 },
      { z: 8, x: 124, y: 100, detection_count: 64, max_frp_mw: 10.5 },
      { z: 8, x: 124, y: 101, detection_count: 64, max_frp_mw: 10.5 },
      { z: 8, x: 125, y: 101, detection_count: 64, max_frp_mw: 10.5 }
    ]);
    for (const z of [0, 4, 8, 12, 16, 18]) expect(tiles.filter((tile) => tile.z === z).reduce((sum, tile) => sum + tile.detection_count, 0)).toBe(256);
    expect(expectedMvtGroups({ z: 0, x: 0, y: 0 }).length).toBeLessThan(256);
  });
  it('detects drift without overwriting data, including bigint and timestamp normalization', () => {
    expect(() => assertExact({ id: 1n, at: new Date(0) }, { id: '1', at: '1970-01-01T00:00:00.000Z' }, 'example')).not.toThrow();
    expect(() => assertExact({ coordinate: 10 }, { coordinate: 11 }, 'point')).toThrow('not overwritten');
  });
  it('previews without importing the database, even with unusable connection variables', () => {
    const command = fileURLToPath(new URL('../../../scripts/phase4/seed.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [command], { encoding: 'utf8', env: {
      ...process.env, DATABASE_URL: 'not-a-url', TEST_DATABASE_URL: 'not-a-url', REDIS_URL: 'not-a-url'
    } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No database connection');
    expect(result.stdout).not.toContain('not-a-url');
  });
});

describe('Fixture target isolation', () => {
  it('accepts a separate explicit test database and Redis DB', () => {
    expect(validateTargets(testEnv, { DATABASE_URL: 'postgresql://app:app@localhost/firebridge', REDIS_URL: 'redis://localhost/0' }).name).toBe('firebridge_test');
  });
  it.each([
    { ...testEnv, NODE_ENV: 'production' }, { ...testEnv, TEST_DATABASE_URL: 'postgresql://test:test@localhost/firebridge' },
    { ...testEnv, TEST_REDIS_URL: 'redis://localhost/0' }, { ...testEnv, TEST_DATABASE_URL: '' },
    { ...testEnv, TEST_REDIS_URL: 'redis://localhost/16' }
  ])('refuses an unsafe or missing target', (env) => { expect(() => validateTargets(env)).toThrow(); });
  it('detects the same database across credentials, schema options and loopback aliases', () => {
    expect(() => validateTargets(testEnv, { DATABASE_URL: 'postgresql://app:secret@127.0.0.1/firebridge_test?schema=firebridge' })).toThrow('application database');
  });
  it('detects the same Redis database across default ports and aliases', () => {
    expect(() => validateTargets(testEnv, { REDIS_URL: 'redis://127.0.0.1:6379/15' })).toThrow('application Redis');
  });
});

describe('Fixture artifact verifiers', () => {
  it('decodes MVT dictionaries, geometry, counts and FRP from protobuf', () => {
    const tile = encodedWorldTile();
    expect(decodeMvtPoints(tile)[0].name).toBe('detections');
    expect(verifyMvt(tile, { z: 0, x: 0, y: 0 }).detections).toBe(256);
    expect(() => verifyMvt(encodedWorldTile(1), { z: 0, x: 0, y: 0 })).toThrow('MVT count');
  });
  it('rejects malformed MVT and accepts a genuinely empty tile', () => {
    expect(() => decodeMvtPoints(Buffer.from([26, 128]))).toThrow();
    expect(verifyMvt(Buffer.alloc(0), { z: 8, x: 0, y: 0 }).detections).toBe(0);
    expect(() => verifyMvt(Buffer.alloc(0), { z: 0, x: 0, y: 0 })).toThrow();
  });
  it.each(['csv', 'geojson', 'parquet'] as const)('checks all rows written by the real %s writer', async (format) => {
    const chunks: Buffer[] = [];
    const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    async function* values() { yield* exportRows(); }
    await writeExport(format, values(), output);
    const file = Buffer.concat(chunks);
    let rows;
    if (format === 'csv') {
      const [header, ...content] = parseCsv(file.toString());
      rows = content.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
    } else if (format === 'geojson') {
      rows = JSON.parse(file.toString()).features.map((feature) => ({ ...feature.properties, id: feature.id,
        longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] }));
    } else {
      const require = createRequire(new URL('../../worker/package.json', import.meta.url));
      const { ParquetReader } = require('parquetjs-lite');
      const reader = await ParquetReader.openBuffer(file);
      rows = [];
      try { const cursor = reader.getCursor(); for (let row = await cursor.next(); row; row = await cursor.next()) rows.push(row); }
      finally { await reader.close(); }
    }
    expect(verifyExportRows(rows, manifest, format).verified_rows).toBe(256);
  });
  it('rejects a foreign source or an excluded detection ID', () => {
    const rows = exportRows();
    expect(() => verifyExportRows([{ ...rows[0], source_id: 'foreign' }, ...rows.slice(1)], manifest, 'geojson')).toThrow();
    expect(() => verifyExportRows([{ ...rows[0], id: manifest.detection_ids['exclude-nrt'] }, ...rows.slice(1)], manifest, 'geojson')).toThrow('Unexpected');
  });
});
