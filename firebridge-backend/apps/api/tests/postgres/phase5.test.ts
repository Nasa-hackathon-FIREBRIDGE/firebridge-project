import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { seedNativeResults } from '../helpers/native-fixture.js';
import {
  adminToken,
  backfillBody,
  ingestionIds,
  seedIngestion
} from '../helpers/ingestion-fixture.js';

describe('Phase 5 durable requests on real PostgreSQL/PostGIS', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const app = createApp({ logger: false, ingestionAdminToken: adminToken });
  beforeAll(() => app.ready());
  beforeEach(async () => {
    await seedNativeResults(pool);
    await seedIngestion({ exec: (sql) => pool.query(sql) });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  const post = (path: string, payload: unknown, key = 'test-phase5-request-0001') =>
    app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingestion' + path,
      payload,
      headers: { authorization: 'Bearer ' + adminToken, 'idempotency-key': key }
    });
  const count = async (table: 'api_jobs' | 'outbox_events' | 'ingestion_subscriptions') =>
    Number((await pool.query('SELECT count(*) FROM firebridge.' + table)).rows[0].count);
  it('persists subscription, job and outbox atomically without contacting a provider', async () => {
    const before = { jobs: await count('api_jobs'), events: await count('outbox_events') };
    const response = await post('/backfills', backfillBody);
    expect(response.statusCode).toBe(202);
    expect(response.json().data).toMatchObject({
      planned_chunks: 3,
      estimated_bytes: null,
      execution_support: 'planning_only',
      missing_access_requirements: ['provider_credentials'],
      reused: false
    });
    expect(await count('api_jobs')).toBe(before.jobs + 1);
    expect(await count('outbox_events')).toBe(before.events + 1);
    const event = (
      await pool.query('SELECT * FROM firebridge.outbox_events WHERE aggregate_id=$1', [
        response.json().data.job_id
      ])
    ).rows[0];
    expect(event).toMatchObject({ event_type: 'ingestion.plan.requested', status: 'pending' });
    expect(event.payload).toEqual({ job_id: response.json().data.job_id });
    expect((await pool.query('SELECT count(*) FROM firebridge.fetch_runs')).rows[0].count).toBe(
      '2'
    );
    expect(response.body).not.toMatch(/MAP_KEY|credential_ref|endpoint_template|secret/);
  });
  it('replays an identical key from PostgreSQL and rejects a changed request', async () => {
    const first = await post('/backfills', backfillBody);
    const second = await post('/backfills', { ...backfillBody, source_ids: ['aqua', 'terra'] });
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().data.job_id).toBe(first.json().data.job_id);
    const conflict = await post('/backfills', {
      ...backfillBody,
      end_exclusive: '2024-01-19T00:00:00Z'
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
    const restarted = createApp({ logger: false, ingestionAdminToken: adminToken });
    try {
      const replay = await restarted.inject({
        method: 'POST',
        url: '/api/v1/admin/ingestion/backfills',
        headers: {
          authorization: 'Bearer ' + adminToken,
          'idempotency-key': 'test-phase5-request-0001'
        },
        payload: backfillBody
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data.job_id).toBe(first.json().data.job_id);
    } finally {
      await restarted.close();
    }
  });
  it('serializes simultaneous retries and reuses subscription configuration for new jobs', async () => {
    const beforeJobs = await count('api_jobs');
    const responses = await Promise.all([
      post('/backfills', backfillBody),
      post('/backfills', backfillBody)
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 202]);
    expect(new Set(responses.map((r) => r.json().data.job_id)).size).toBe(1);
    expect(await count('api_jobs')).toBe(beforeJobs + 1);
    const another = await post('/backfills', backfillBody, 'test-phase5-request-0002');
    expect(another.statusCode).toBe(202);
    expect(another.json().data.subscription_id).toBe(responses[0].json().data.subscription_id);
    expect(another.json().data.job_id).not.toBe(responses[0].json().data.job_id);
  });
  it('rejects invalid windows, product selection, credentials in options and excessive budgets before writing', async () => {
    const before = {
      jobs: await count('api_jobs'),
      events: await count('outbox_events'),
      subs: await count('ingestion_subscriptions')
    };
    const cases = [
      { ...backfillBody, start: '2024-02-30T00:00:00Z' },
      { ...backfillBody, end_exclusive: '2024-01-16T00:00:00Z' },
      { ...backfillBody, end_exclusive: '2099-01-01T00:00:00Z' },
      { ...backfillBody, resource_budget: { max_chunks: 1, max_bytes: 1000 } },
      { ...backfillBody, source_ids: ['noaa21'] },
      { ...backfillBody, products: ['wrong'] },
      { ...backfillBody, collection: 'wrong' },
      { ...backfillBody, adapter_options: { MAP_KEY: 'secret' } },
      { ...backfillBody, scope_key: 'unregistered' }
    ];
    for (const body of cases)
      expect([404, 422]).toContain((await post('/backfills', body)).statusCode);
    expect(await count('api_jobs')).toBe(before.jobs);
    expect(await count('outbox_events')).toBe(before.events);
    expect(await count('ingestion_subscriptions')).toBe(before.subs);
  });
  it('requires idempotency and verified capabilities; does not accept retired feeds', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingestion/backfills',
      headers: { authorization: 'Bearer ' + adminToken },
      payload: backfillBody
    });
    expect(missing.statusCode).toBe(400);
    await pool.query("UPDATE firebridge.ingestion_feeds SET capability_spec='{}' WHERE id='modis'");
    expect((await post('/backfills', backfillBody)).json().code).toBe('FEED_CAPABILITIES_REQUIRED');
    await pool.query("UPDATE firebridge.ingestion_feeds SET state='retired' WHERE id='modis'");
    expect((await post('/backfills', backfillBody)).json().code).toBe('FEED_NOT_READY');
  });
  it('rolls back the subscription and job if writing the outbox fails', async () => {
    const before = await count('ingestion_subscriptions');
    await pool.query(`CREATE FUNCTION firebridge.test_phase5_reject_event() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'test-only failure'; END $$`);
    await pool.query(`CREATE TRIGGER test_phase5_reject_event BEFORE INSERT ON firebridge.outbox_events
      FOR EACH ROW EXECUTE FUNCTION firebridge.test_phase5_reject_event()`);
    try {
      expect((await post('/backfills', backfillBody)).statusCode).toBe(503);
      expect(await count('api_jobs')).toBe(0);
      expect(await count('ingestion_subscriptions')).toBe(before);
    } finally {
      await pool.query('DROP TRIGGER test_phase5_reject_event ON firebridge.outbox_events');
      await pool.query('DROP FUNCTION firebridge.test_phase5_reject_event()');
    }
  });
  it('queues bounded refresh modes and freezes feed/adapter selection', async () => {
    const input = { mode: 'repair', resource_budget: { max_chunks: 3, max_bytes: 1000000 } };
    const path = '/subscriptions/' + ingestionIds.subscription + '/refresh';
    const first = await post(path, input);
    expect(first.statusCode).toBe(202);
    expect(first.json().data).toMatchObject({
      planned_chunks: 1,
      feed_id: 'modis',
      start: '2024-01-18T00:00:00.000Z',
      end_exclusive: '2024-01-19T00:00:00.000Z'
    });
    expect((await post(path, input)).statusCode).toBe(200);
    expect((await post(path, { ...input, mode: 'poll' })).statusCode).toBe(409);
    const explicit = {
      ...input,
      mode: 'reconcile',
      start: '2024-01-17T00:00:00Z',
      end_exclusive: '2024-01-20T00:00:00Z'
    };
    expect((await post(path, explicit, 'test-phase5-reconcile-1')).statusCode).toBe(202);
    await pool.query("UPDATE firebridge.ingestion_feeds SET adapter_version='2' WHERE id='modis'");
    expect((await post(path, explicit, 'test-phase5-reconcile-2')).json().code).toBe(
      'ADAPTER_VERSION_CHANGED'
    );
  });
  it('keeps availability and gap queries scoped, source-specific, and free of sensitive data', async () => {
    const response = await app.inject('/api/v1/sources/terra/availability?scope_key=phase1_test');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      last_success_at: expect.any(String),
      latest_observation_at: null,
      queried_through: expect.stringContaining('2024-01-18'),
      stale_reason: 'INGESTION_GAPS'
    });
    expect(response.json().data.gaps).toHaveLength(1);
    expect(response.body).not.toMatch(/MAP_KEY|credential_ref|secret|private/);
    const run = await app.inject({
      url: '/api/v1/admin/ingestion/runs/' + ingestionIds.failedRun,
      headers: { authorization: 'Bearer ' + adminToken }
    });
    expect(run.statusCode).toBe(200);
    expect(run.body).not.toMatch(/MAP_KEY|secret|private/);
  });
  it('derives acquisition time from matching source records in the exact area and fetched window', async () => {
    await pool.query(
      `INSERT INTO firebridge.fetch_assets VALUES
      ($1::uuid,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','payload','page-1')`,
      [ingestionIds.emptyRun]
    );
    const terra = await app.inject('/api/v1/sources/terra/availability?scope_key=phase1_test');
    expect(terra.statusCode).toBe(200);
    expect(terra.json().data.latest_observation_at).toContain('2024-01-17 00:00:00.000002');
    const aqua = await app.inject('/api/v1/sources/aqua/availability?scope_key=phase1_test');
    expect(aqua.json().data.latest_observation_at).toBeNull();
    const narrowed = await app.inject(
      '/api/v1/sources/terra/availability?scope_key=phase1_test&start=2024-01-18T00:00:00Z'
    );
    expect(narrowed.json().data.latest_observation_at).toBeNull();
  });
});
