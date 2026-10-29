import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ids, seed, testDatabase } from './helpers/database.js';

describe('Phase 1 routes with PostgreSQL queries', () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    fixture = await testDatabase();
    app = createApp({
      database: fixture.adapter,
      logger: false,
      readinessChecks: { database: async () => 1, redis: async () => 'PONG' }
    });
    await app.ready();
  }, 30000);
  beforeEach(async () => {
    await seed(fixture.db);
  });
  afterAll(async () => {
    await app?.close();
    await fixture?.adapter.close();
  });
  const get = (path: string) => app.inject({ method: 'GET', url: '/api/v1' + path });

  it('checks liveness and real catalog readiness', async () => {
    expect((await get('/health/live')).json().status).toBe('ok');
    expect((await get('/health/ready')).statusCode).toBe(200);
    await fixture.db.exec('DELETE FROM firebridge.release_aliases');
    expect((await get('/health/ready')).statusCode).toBe(503);
    expect((await get('/health/live')).statusCode).toBe(200);
  });
  it('keeps catalog readiness scoped to each app and includes the Phase 0 Redis probe', async () => {
    const degraded = createApp({
      database: fixture.adapter,
      logger: false,
      readinessChecks: {
        database: async () => 1,
        redis: async () => {
          throw new Error('Unavailable Redis');
        }
      }
    });
    try {
      const response = await degraded.inject('/api/v1/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json().checks).toMatchObject({
        database: 'ready',
        redis: 'unavailable',
        catalogue: 'ready'
      });
      expect((await get('/health/ready')).statusCode).toBe(200);
      expect((await degraded.inject('/api/v1/health/live')).statusCode).toBe(200);
    } finally {
      await degraded.close();
    }
  });
  it('serves a scoped catalog and the common response envelope', async () => {
    const response = await get('/catalog?scope_key=morocco');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schema_version: '1',
      warnings: [],
      data: { scope_key: 'morocco' }
    });
    expect(response.headers['x-request-id']).toBe(response.json().request_id);
    expect(response.json().data.release_aliases[0].release_id).toBe(ids.current);
    expect(response.json().data.metrics.map((m: { id: string }) => m.id)).toEqual([
      'native_detections_v1'
    ]);
  });
  it('uses the default scope', async () => {
    expect((await get('/catalog')).json().data.scope_key).toBe('morocco');
  });
  it('reports no published snapshot for a completely empty database', async () => {
    await fixture.db.exec(
      'TRUNCATE firebridge.sources,firebridge.data_releases,firebridge.areas,firebridge.ingestion_feeds CASCADE'
    );
    expect((await get('/catalog')).json().error.code).toBe('NO_PUBLISHED_SNAPSHOT');
    expect((await get('/health/ready')).statusCode).toBe(503);
  });
  it('keeps geographic support attached to the release that publishes each metric', async () => {
    await fixture.db.exec(`
      INSERT INTO firebridge.grids VALUES
        ('morocco_grid','1',6933,5000,0,0,'{"type":"MultiPolygon","coordinates":[]}',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{}');
      UPDATE firebridge.data_releases SET config='{"metric_ids":["harmonized_v1"],"grid_ids":["morocco_grid"]}'
        WHERE id='${ids.next}';
      INSERT INTO firebridge.release_aliases VALUES ('latest_experiment','morocco','${ids.next}',1,now());
    `);
    const metrics = (await get('/catalog')).json().data.metrics;
    expect(
      metrics.find((m: { id: string }) => m.id === 'native_detections_v1').supported_extent
    ).toEqual([]);
    expect(
      metrics.find((m: { id: string }) => m.id === 'harmonized_v1').supported_extent[0].grid_id
    ).toBe('morocco_grid');
  });
  it('separates provider availability from local inventory, retaining unknown dates', async () => {
    const sources = (await get('/catalog')).json().data.sources;
    const terra = sources.find((s: { source_id: string }) => s.source_id === 'terra');
    const aqua = sources.find((s: { source_id: string }) => s.source_id === 'aqua');
    const noaa = sources.find((s: { source_id: string }) => s.source_id === 'noaa21');
    expect(terra.availability_status).toBe('partial');
    expect(terra.ingested_intervals).toHaveLength(2);
    expect(terra.ingested_interval).toBeNull();
    expect(aqua.provider_available_interval).toEqual({ start: null, end_exclusive: null });
    expect(aqua.ingested_interval).toBeNull();
    expect(noaa.availability_status).toBe('unknown');
    expect(noaa.provider_availability).toEqual([]);
    expect(noaa.ingested_intervals).toEqual([]);
  });
  it('does not expose private manifests, configuration or credentials', async () => {
    for (const path of [
      '/catalog',
      '/releases/' + ids.current,
      '/releases/' + ids.current + '?membership=assets',
      '/updates?scope_key=morocco&after_release_id=' + ids.old
    ]) {
      const response = await get(path);
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(
        /s3:\/\/|secret|MAP_KEY|manifest_uri|storage_uri|credential_ref/
      );
    }
  });
  it('distinguishes unknown scopes from known scopes without a snapshot', async () => {
    expect((await get('/catalog?scope_key=unknown')).statusCode).toBe(404);
    expect((await get('/catalog?scope_key=spain')).statusCode).toBe(503);
  });
  it('rejects malformed filters and unknown query parameters', async () => {
    for (const path of [
      '/catalog?scope_key=',
      '/catalog?scope_key=morocco&unexpected=1',
      '/catalog?scope_key=morocco&scope_key=spain',
      '/releases/not-a-uuid',
      '/releases/' + ids.current + '?limit=101',
      '/releases/' + ids.current + '?limit=0',
      '/updates',
      '/updates?scope_key=morocco&component=invalid'
    ]) {
      expect((await get(path)).statusCode, path).toBe(422);
    }
  });
  it('returns only published exact releases', async () => {
    const response = await get('/releases/' + ids.current);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: ids.current,
      parent_release_id: ids.old,
      partition_counts: [{ partitions: 3, row_count: '10', serving_complete: false }]
    });
    expect((await get('/releases/' + ids.draft)).statusCode).toBe(404);
    expect((await get('/releases/99999999-9999-4999-8999-999999999999')).statusCode).toBe(404);
  });
  it('supports conditional requests and binds the ETag to the selected membership page', async () => {
    const first = await get('/releases/' + ids.current + '?limit=1');
    const etag = first.headers.etag;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const same = await app.inject({
      method: 'GET',
      url: '/api/v1/releases/' + ids.current + '?limit=1',
      headers: { 'if-none-match': String(etag) }
    });
    expect(same.statusCode).toBe(304);
    expect(same.body).toBe('');
    const different = await app.inject({
      method: 'GET',
      url: '/api/v1/releases/' + ids.current + '?limit=2',
      headers: { 'if-none-match': String(etag) }
    });
    expect(different.statusCode).toBe(200);
    expect(different.headers.etag).not.toBe(etag);
  });
  it('paginates signed partition membership without omissions or duplicates', async () => {
    let cursor: string | null = null;
    const partitions: string[] = [];
    do {
      const response = await get(
        '/releases/' + ids.current + '?limit=1' + (cursor ? '&cursor=' + cursor : '')
      );
      expect(response.statusCode).toBe(200);
      const page = response.json().data.membership;
      partitions.push(...page.items.map((p: { partition_id: string }) => p.partition_id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(partitions).toHaveLength(3);
    expect(new Set(partitions).size).toBe(3);
  });
  it('rejects tampered cursors and reuse under another release, limit or membership', async () => {
    const cursor = (await get('/releases/' + ids.current + '?limit=1')).json().data.membership
      .next_cursor;
    for (const path of [
      '/releases/' + ids.current + '?limit=1&cursor=' + cursor + 'x',
      '/releases/' + ids.old + '?limit=1&cursor=' + cursor,
      '/releases/' + ids.current + '?limit=2&cursor=' + cursor,
      '/releases/' + ids.current + '?limit=1&membership=assets&cursor=' + cursor
    ])
      expect((await get(path)).json().error.code).toBe('INVALID_CURSOR');
  });
  it('lists input asset provenance separately from normalized record sources', async () => {
    const data = (await get('/releases/' + ids.current + '?membership=assets')).json().data;
    expect(data.membership.items[0]).toMatchObject({
      source_id: 'terra',
      byte_size: '42',
      validation_status: 'accepted'
    });
    expect(data.source_composition.map((s: { role: string }) => s.role)).toEqual([
      'input',
      'record'
    ]);
  });
  it('compares release UUIDs even when record counts are equal', async () => {
    const initial = (await get('/updates?scope_key=morocco')).json().data;
    expect(initial).toMatchObject({
      has_updates: false,
      comparison: 'baseline_not_provided',
      changes: []
    });
    const unchanged = (
      await get('/updates?scope_key=morocco&after_release_id=' + ids.current)
    ).json().data;
    expect(unchanged.has_updates).toBe(false);
    const updated = (await get('/updates?scope_key=morocco&after_release_id=' + ids.old)).json()
      .data;
    expect(updated).toMatchObject({
      has_updates: true,
      changes: [{ reason: 'provider_revision' }]
    });
  });
  it('collects changes through intermediate releases', async () => {
    await fixture.db.query('UPDATE firebridge.release_aliases SET release_id=$1,generation=3', [
      ids.next
    ]);
    const data = (await get('/updates?scope_key=morocco&after_release_id=' + ids.old)).json().data;
    expect(data.history_complete).toBe(true);
    expect(data.changes.map((c: { reason: string }) => c.reason)).toEqual([
      'new_data',
      'provider_revision'
    ]);
  });
  it('flags a baseline outside the current parent history', async () => {
    const response = await get('/updates?scope_key=morocco&after_release_id=' + ids.next);
    expect(response.json().data).toMatchObject({ has_updates: true, history_complete: false });
    expect(response.json().warnings).toContain('BASELINE_NOT_ANCESTOR');
  });
  it('validates baseline scope and requested filters', async () => {
    expect(
      (await get('/updates?scope_key=morocco&after_release_id=' + ids.other)).json().error.code
    ).toBe('INCOMPATIBLE_BASELINE');
    expect((await get('/updates?scope_key=morocco&after_release_id=' + ids.draft)).statusCode).toBe(
      404
    );
    expect((await get('/updates?scope_key=morocco&alias=missing')).statusCode).toBe(422);
    expect((await get('/updates?scope_key=morocco&component=weather')).statusCode).toBe(422);
  });
  it('does not mutate releases when polling updates', async () => {
    for (let i = 0; i < 3; i++) await get('/updates?scope_key=morocco&after_release_id=' + ids.old);
    expect(
      (
        await fixture.db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM firebridge.data_releases'
        )
      ).rows[0].n
    ).toBe(5);
    expect((await get('/releases/' + ids.old)).json().data.id).toBe(ids.old);
  });
  it('enforces read-only database transactions', async () => {
    await expect(
      fixture.adapter.snapshot((db) => db.query('DELETE FROM firebridge.release_aliases'))
    ).rejects.toThrow(/read-only/i);
    expect((await get('/catalog')).statusCode).toBe(200);
  });
  it('returns sanitized 503 responses when the production database cannot be reached', async () => {
    const unavailable = createApp({ logger: false });
    try {
      for (const path of ['/catalog', '/releases/' + ids.current, '/updates?scope_key=morocco']) {
        const response = await unavailable.inject('/api/v1' + path);
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe('DATABASE_UNAVAILABLE');
        expect(response.body).not.toMatch(/postgresql:|unused|ECONNREFUSED/);
      }
      const readiness = await unavailable.inject('/api/v1/health/ready');
      expect(readiness.statusCode).toBe(503);
      expect(readiness.json().checks.database).toBe('unavailable');
      expect(readiness.json().checks.catalogue).toBe('unavailable');
      expect((await unavailable.inject('/api/v1/health/live')).statusCode).toBe(200);
    } finally {
      await unavailable.close();
    }
  });
  it('generates OpenAPI documentation for all three implemented routes', async () => {
    const response = await app.inject('/api-docs/json');
    expect(response.statusCode).toBe(200);
    const paths = response.json().paths;
    for (const path of ['/api/v1/catalog/', '/api/v1/releases/{release_id}', '/api/v1/updates/'])
      expect(paths[path]?.get).toBeDefined();
  });
  it('keeps other resource scaffolds reachable', async () => {
    expect((await get('/areas')).statusCode).toBe(501);
    expect((await app.inject('/health')).statusCode).toBe(404);
    expect((await get('/nonexistent')).statusCode).toBe(404);
  });
});
