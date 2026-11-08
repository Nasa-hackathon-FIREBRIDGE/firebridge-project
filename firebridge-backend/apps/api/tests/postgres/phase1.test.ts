import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDatabase } from '@firebridge/database';
import { createApp } from '../../src/app.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { ids, seed } from '../helpers/database.js';

// This suite intentionally leaves its synthetic fixture in the dedicated test database
// so the same three endpoints can be inspected manually after a successful run.
describe('Phase 1 on migrated PostgreSQL/PostGIS and Redis', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  let app: ReturnType<typeof createApp> | undefined;
  beforeAll(async () => {
    const result = await pool.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'firebridge_phase1_test') {
      throw new Error('Refusing to seed a database other than firebridge_phase1_test.');
    }
    const migrations = await pool.query(
      'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    );
    expect(migrations.rows.map((row) => row.migration_name)).toContain(
      '20261031000000_phase1_catalog_versions'
    );
    await seed({ exec: (sql) => pool.query(sql) }, true);
    app = createApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await pool.end();
    await Promise.all([disconnectDatabase(), disconnectRedis()]);
  });
  const get = (path: string) => app!.inject('/api/v1' + path);

  it('uses PostGIS geometry with SRID 4326 and real spatial functions', async () => {
    const result = await pool.query(`
      SELECT PostGIS_Version() AS version, ST_SRID(geom) AS srid,
        ST_IsValid(geom) AS valid, ST_AsGeoJSON(geom)::jsonb AS geometry
      FROM firebridge.areas LIMIT 1`);
    expect(result.rows[0]).toMatchObject({
      srid: 4326,
      valid: true,
      geometry: { type: 'MultiPolygon' }
    });
    expect(result.rows[0].version).toMatch(/^3\./);
  });

  it('serves the scoped catalog through the real pg repository', async () => {
    const response = await get('/catalog?scope_key=phase1_test');
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.release_aliases[0].release_id).toBe(ids.current);
    expect(data.releases[0].name).toBe('TEST ONLY - current');
    expect(data.sources).toHaveLength(3);
    expect(
      data.sources.find((source: { source_id: string }) => source.source_id === 'noaa21')
        .availability_status
    ).toBe('unknown');
    expect(data.metrics.map((metric: { id: string }) => metric.id)).toEqual([
      'native_detections_v1'
    ]);
    expect(response.headers['x-request-id']).toBe(response.json().request_id);
    expect(response.body).not.toMatch(/s3:\/\/|MAP_KEY|credential_ref|manifest_uri|storage_uri/);
  });

  it('reads exact releases, keyset pages and asset membership', async () => {
    const first = await get('/releases/' + ids.current + '?limit=1');
    expect(first.statusCode).toBe(200);
    expect(first.json().data.partition_counts[0]).toMatchObject({
      partitions: 3,
      row_count: '10',
      serving_complete: false
    });
    const cursor = first.json().data.membership.next_cursor;
    expect(cursor).toEqual(expect.any(String));
    const second = await get(
      '/releases/' + ids.current + '?limit=1&cursor=' + encodeURIComponent(cursor)
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().data.membership.items[0].partition_id).not.toBe(
      first.json().data.membership.items[0].partition_id
    );
    const assets = await get('/releases/' + ids.current + '?membership=assets');
    expect(assets.statusCode).toBe(200);
    expect(assets.json().data.membership.items[0]).toMatchObject({ role: 'raw', byte_size: '42' });
    expect((await get('/releases/' + ids.draft)).statusCode).toBe(404);
  });

  it('compares a baseline against the current published alias', async () => {
    const response = await get('/updates?scope_key=phase1_test&after_release_id=' + ids.old);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      has_updates: true,
      history_complete: true,
      changes: [{ reason: 'provider_revision', revision_records: 1 }]
    });
    const current = await get('/updates?scope_key=phase1_test&after_release_id=' + ids.current);
    expect(current.json().data.has_updates).toBe(false);
  });

  it('honors release ETags on PostgreSQL responses', async () => {
    const first = await get('/releases/' + ids.current);
    const cached = await app!.inject({
      url: '/api/v1/releases/' + ids.current,
      headers: { 'if-none-match': String(first.headers.etag) }
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
  });

  it('verifies PostgreSQL, Redis and the catalog without mocked probes', async () => {
    const response = await get('/health/ready');
    expect(response.statusCode).toBe(200);
    expect(response.json().data.checks).toMatchObject({
      database: 'ready',
      redis: 'ready',
      catalogue: 'ready'
    });
  });

  it('retains the Prisma Sources API on the migrated schema', async () => {
    const response = await get('/sources?provider=NASA&limit=10');
    expect(response.statusCode).toBe(200);
    expect(response.json().data.sources).toHaveLength(3);
    expect(response.json().data.sources[0]).toHaveProperty('processingStream', 'standard');
  });

  it('enforces hashes, nonnegative counts and composite partition references', async () => {
    await expect(pool.query("UPDATE firebridge.assets SET sha256='invalid'")).rejects.toMatchObject(
      { code: '23514' }
    );
    await expect(
      pool.query('UPDATE firebridge.data_partitions SET row_count=-1')
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE firebridge.release_partitions SET series_key='different-series'")
    ).rejects.toMatchObject({ code: '23503' });
  });
});
