import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { testDatabase, seed } from './helpers/database.js';
import { seedIngestion, ingestionIds, adminToken } from './helpers/ingestion-fixture.js';

describe('Phase 5 operational reads and administrative boundary', () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    fixture = await testDatabase();
    // Metadata suite only; real geometry predicates run in the PostgreSQL suite.
    await fixture.db.exec(`CREATE FUNCTION public.ST_Covers(jsonb,jsonb) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS 'SELECT false'`);
    app = createApp({ database: fixture.adapter, logger: false, ingestionAdminToken: adminToken });
    await app.ready();
  }, 30000);
  beforeEach(async () => {
    await seed(fixture.db);
    await seedIngestion(fixture.db);
  });
  afterAll(async () => {
    await app?.close();
    await fixture?.adapter.close();
  });
  const get = (path: string, token = adminToken) =>
    app.inject({
      url: '/api/v1' + path,
      headers: token ? { authorization: 'Bearer ' + token } : {}
    });
  it('requires valid admin authorization on every administrative ingestion route', async () => {
    for (const path of ['/subscriptions', '/gaps', '/runs/' + ingestionIds.emptyRun])
      expect((await get('/admin/ingestion' + path, '')).statusCode).toBe(401);
    for (const path of ['/backfills', '/subscriptions/' + ingestionIds.subscription + '/refresh'])
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/admin/ingestion' + path, payload: {} }))
          .statusCode
      ).toBe(401);
    expect((await get('/admin/ingestion/subscriptions', 'wrong')).statusCode).toBe(401);
  });
  it('fails closed when administration has no configured token', async () => {
    const closed = createApp({ database: fixture.adapter, logger: false, ingestionAdminToken: '' });
    try {
      expect((await closed.inject('/api/v1/admin/ingestion/subscriptions')).statusCode).toBe(503);
    } finally {
      await closed.close();
    }
  });
  it('lists subscriptions and actual checkpoints without leaking configuration', async () => {
    const res = await get('/admin/ingestion/subscriptions?scope_key=morocco&limit=1');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.subscriptions[0]).toMatchObject({
      id: ingestionIds.subscription,
      credentials: 'not_configured',
      open_gaps: '2',
      checkpoints: [{ stage: 'fetch' }]
    });
    expect(res.body).not.toMatch(
      /credential_ref|request_config|endpoint_template|MAP_KEY|secret|cursor_json/
    );
    const cursor = encodeURIComponent(res.json().data.next_cursor);
    const next = await get(
      '/admin/ingestion/subscriptions?scope_key=morocco&limit=1&cursor=' + cursor
    );
    expect(next.statusCode).toBe(200);
    expect(next.json().data.subscriptions[0].id).not.toBe(ingestionIds.subscription);
    expect(
      (await get('/admin/ingestion/subscriptions?scope_key=morocco&limit=2&cursor=' + cursor))
        .statusCode
    ).toBe(422);
  });
  it('lists gaps with signed cursors and protects them against filter changes', async () => {
    const res = await get('/admin/ingestion/gaps?limit=1');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.gaps[0]).toMatchObject({ kind: 'fetch_failed', source_ids: ['terra'] });
    expect(res.body).not.toMatch(/secret|private|evidence/);
    const cursor = encodeURIComponent(res.json().data.next_cursor);
    expect(
      (await get('/admin/ingestion/gaps?limit=1&cursor=' + cursor)).json().data.gaps[0].source_ids
    ).toEqual(['aqua']);
    expect(
      (await get('/admin/ingestion/gaps?limit=1&status=open&cursor=' + cursor)).statusCode
    ).toBe(422);
  });
  it('represents retired transport gaps as accepted unavailable without a retry deadline', async () => {
    await fixture.db.exec("UPDATE firebridge.ingestion_feeds SET state='retired' WHERE id='modis'");
    const res = await get('/admin/ingestion/gaps?status=accepted_unavailable');
    expect(res.json().data.gaps).toHaveLength(2);
    expect(res.json().data.gaps[0]).toMatchObject({
      kind: 'retired_source',
      status: 'accepted_unavailable',
      next_retry_at: null
    });
    expect((await get('/admin/ingestion/gaps?status=open')).json().data.gaps).toEqual([]);
  });
  it('inspects the actual fetch attempt and distinguishes successful emptiness', async () => {
    const empty = await get('/admin/ingestion/runs/' + ingestionIds.emptyRun);
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data).toMatchObject({
      successful_empty: true,
      record_count: '0',
      assets: [],
      quality_issues: []
    });
    const failed = await get('/admin/ingestion/runs/' + ingestionIds.failedRun);
    expect(failed.json().data).toMatchObject({
      successful_empty: false,
      error_code: 'FETCH_ERROR_RECORDED'
    });
    expect(empty.body + failed.body).not.toMatch(/private|secret|MAP_KEY|Authorization/);
    expect(
      (await get('/admin/ingestion/runs/dddddddd-dddd-4ddd-8ddd-dddddddddddd')).statusCode
    ).toBe(404);
  });
  it('serves public availability with source-specific gaps and no invented acquisition time', async () => {
    const terra = await get('/sources/terra/availability?scope_key=morocco', '');
    expect(terra.statusCode).toBe(200);
    expect(terra.json().data).toMatchObject({
      source_id: 'terra',
      latest_observation_at: null,
      stale: true,
      stale_reason: 'INGESTION_GAPS',
      observation_coverage: null
    });
    expect(terra.json().data.last_success_at).not.toBeNull();
    expect(terra.json().data.gaps).toHaveLength(1);
    expect(terra.json().data.gaps[0].source_ids).toEqual(['terra']);
    const aqua = await get('/sources/aqua/availability?scope_key=morocco', '');
    expect(aqua.json().data.latest_observation_at).toBeNull();
    expect(aqua.json().data.gaps[0].source_ids).toEqual(['aqua']);
    expect(terra.body + aqua.body).not.toMatch(/private|secret|credential_ref|MAP_KEY/);
    expect((await get('/sources/terra/availability?scope_key=spain', '')).statusCode).toBe(404);
  });
  it('validates real dates, interval order, allowed parameters and required scope', async () => {
    for (const path of [
      '/sources/terra/availability',
      '/sources/terra/availability?scope_key=morocco&start=2024-02-30T00:00:00Z',
      '/admin/ingestion/gaps?start=2024-01-20T00:00:00Z&end_exclusive=2024-01-17T00:00:00Z',
      '/admin/ingestion/subscriptions?token=secret',
      '/admin/ingestion/gaps?limit=101'
    ])
      expect((await get(path)).statusCode).toBe(422);
  });
  it('publishes all six route contracts and operational bearer authorization in Swagger', async () => {
    const doc = (await app.inject('/api-docs/json')).json();
    expect(doc.components.securitySchemes.ingestionAdmin).toMatchObject({
      type: 'http',
      scheme: 'bearer'
    });
    expect(doc.paths['/api/v1/admin/ingestion/backfills'].post.security).toEqual([
      { ingestionAdmin: [] }
    ]);
    expect(doc.paths['/api/v1/sources/{source_id}/availability'].get).toBeDefined();
  });
});
