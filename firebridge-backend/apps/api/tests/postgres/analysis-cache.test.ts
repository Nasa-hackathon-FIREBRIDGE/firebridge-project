import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { analysesRepository } from '../../src/repositories/analyses.repository.js';
import { analysesService } from '../../src/services/analyses.service.js';
import { analysisCreateSchema } from '../../src/validators/analyses.validator.js';
import { seedNativeResults, nativeIds } from '../helpers/native-fixture.js';
import { ids } from '../helpers/database.js';

describe('Analysis cache identity and durable request retries', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp({ logger: false });
  const body = {
    area_id: nativeIds.area,
    start_date: '2024-01-17',
    end_date_exclusive: '2024-01-20'
  };
  beforeAll(() => app.ready());
  beforeEach(async () => {
    await seedNativeResults(pool);
    await pool.query(`UPDATE firebridge.data_releases SET created_at=now()-interval '1 hour';
      UPDATE firebridge.data_releases SET status='retired'
      WHERE id IN ('${ids.next}','${ids.other}')`);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
  const post = (payload: unknown = body, key?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload,
      headers: key ? { 'idempotency-key': key } : {}
    });
  async function publish(kind: 'satellite' | 'weather' | 'reports' = 'satellite') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO firebridge.data_releases
      (id,name,status,stream,code_version,config,config_sha256,manifest_uri,
       dataset_kind,scope_key,observation_cutoff,published_at)
      SELECT $1::uuid,$2,'published',stream,code_version,config,config_sha256,manifest_uri,
        $3,scope_key,observation_cutoff,now() FROM firebridge.data_releases WHERE id=$4::uuid`,
      [id, 'TEST ONLY - cache ' + id, kind, ids.current]
    );
    return id;
  }
  const stored = async (id: string) =>
    (
      await pool.query(
        'SELECT release_id::text,cache_key,request_spec FROM firebridge.analyses WHERE id=$1',
        [id]
      )
    ).rows[0];

  it('reuses identical intent and the same resolved versions without duplicate work', async () => {
    const first = await post();
    const second = await post();
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(second.json().data.job_id).toBe(first.json().data.job_id);
    expect(
      (
        await pool.query('SELECT count(*) FROM firebridge.api_jobs WHERE analysis_id=$1', [
          first.json().data.id
        ])
      ).rows[0].count
    ).toBe('1');
  });

  it('creates a distinct analysis after a new satellite publication and preserves the old snapshot', async () => {
    const first = (await post()).json().data;
    const original = await stored(first.id);
    const release = await publish();
    const second = await post();
    expect(second.statusCode).toBe(202);
    expect(second.json().data.release_id).toBe(release);
    expect(second.json().data.id).not.toBe(first.id);
    expect((await stored(second.json().data.id)).cache_key).not.toBe(original.cache_key);
    expect(await stored(first.id)).toEqual(original);
    const old = await app.inject('/api/v1/analyses/' + first.id);
    expect(old.json().data.release_id).toBe(ids.current);
    expect((await post()).json().data.id).toBe(second.json().data.id);
  });

  it.each(['weather', 'reports'] as const)(
    'distinguishes missing, initial and revised %s components',
    async (kind) => {
      const first = (await post()).json().data;
      const one = await publish(kind);
      const second = await post();
      expect(second.statusCode).toBe(202);
      expect(second.json().data.id).not.toBe(first.id);
      expect(second.json().data.release_id).toBe(ids.current);
      await pool.query(
        "UPDATE firebridge.data_releases SET created_at=now()-interval '1 second' WHERE id=$1",
        [one]
      );
      const two = await publish(kind);
      const third = await post();
      expect(third.statusCode).toBe(202);
      expect(third.json().data.id).not.toBe(second.json().data.id);
      const component = (
        await pool.query(
          `SELECT release_id::text FROM firebridge.analysis_components
      WHERE analysis_id=$1 AND component=$2`,
          [third.json().data.id, kind === 'weather' ? 'weather_historical' : 'reports']
        )
      ).rows[0];
      expect(component.release_id).toBe(two);
    }
  );

  it('includes all request policies while ignoring JSON object-key ordering', async () => {
    const first = await post({
      ...body,
      weather_policy: { enabled: true, options: { model: 'x', fallback: false } }
    });
    const same = await post({
      ...body,
      weather_policy: { options: { fallback: false, model: 'x' }, enabled: true }
    });
    expect(same.statusCode).toBe(200);
    expect(same.json().data.id).toBe(first.json().data.id);
    for (const change of [
      { weather_policy: { enabled: false } },
      { news_policy: { review_policy: 'reviewed' } },
      { baseline_spec: { year: 2023 } }
    ])
      expect((await post({ ...body, ...change })).statusCode).toBe(202);
  });

  it("reuses a public cached analysis across different idempotency keys", async () => {
    const input = analysisCreateSchema.parse(body);
    const first = await analysesService.createAnalysis(input, 'cache-request-one');
    const second = await analysesService.createAnalysis(input, 'cache-request-two');
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.detail.analysis.id).toBe(first.detail.analysis.id);
  });

  it('replays an explicit request key across publication changes and rejects different intent', async () => {
    const first = (await post(body, 'cache-retry-original')).json().data;
    const release = await publish();
    const retry = await post(body, 'cache-retry-original');
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.id).toBe(first.id);
    expect(retry.json().data.release_id).toBe(ids.current);
    const fresh = await post(body, 'cache-retry-new-intent');
    expect(fresh.statusCode).toBe(202);
    expect(fresh.json().data.release_id).toBe(release);
    const conflict = await post(
      { ...body, end_date_exclusive: '2024-01-19' },
      'cache-retry-original'
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('durably binds a new request key to a cache hit without creating another job', async () => {
    const first = (await post()).json().data;
    const hit = await post(body, 'cache-hit-alias');
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data.job_id).toBe(first.job_id);
    await publish();
    const restarted = createApp({ logger: false });
    try {
      const retry = await restarted.inject({
        method: 'POST',
        url: '/api/v1/analyses',
        payload: body,
        headers: { 'idempotency-key': 'cache-hit-alias' }
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().data.id).toBe(first.id);
    } finally {
      await restarted.close();
    }
    expect(
      (
        await pool.query('SELECT count(*) FROM firebridge.api_jobs WHERE analysis_id=$1', [
          first.id
        ])
      ).rows[0].count
    ).toBe('1');
  });

  it('serializes simultaneous equivalent creations through retry-safe uniqueness', async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 202]);
    expect(new Set(responses.map((r) => r.json().data.id)).size).toBe(1);
  });

  it('rejects concurrent different requests under the same explicit key without orphan work', async () => {
    const before = (await pool.query('SELECT count(*) FROM firebridge.analyses')).rows[0].count;
    const responses = await Promise.all([
      post(body, 'cache-concurrent-key'),
      post({ ...body, end_date_exclusive: '2024-01-19' }, 'cache-concurrent-key')
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    expect(
      Number((await pool.query('SELECT count(*) FROM firebridge.analyses')).rows[0].count)
    ).toBe(Number(before) + 1);
  });

  it('preserves explicit retries of legacy jobs and stops reusing their unversioned cache key', async () => {
    const first = (await post(body, 'cache-legacy-key')).json().data;
    await pool.query('DELETE FROM firebridge.analysis_request_keys WHERE job_id=$1', [
      first.job_id
    ]);
    await pool.query("UPDATE firebridge.analyses SET cache_key='legacy-unversioned' WHERE id=$1", [
      first.id
    ]);
    await pool.query(
      "UPDATE firebridge.api_jobs SET request_hash='legacy-unversioned' WHERE id=$1",
      [first.job_id]
    );
    expect((await post(body, 'cache-legacy-key')).json().data.id).toBe(first.id);
    const fresh = await post();
    expect(fresh.statusCode).toBe(202);
    expect(fresh.json().data.id).not.toBe(first.id);
    expect((await app.inject('/api/v1/analyses/' + first.id)).statusCode).toBe(200);
  });

  it('keeps release selection and cache lookup within one consistent snapshot during publication', async () => {
    let reached!: () => void, resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = analysesRepository.findByCacheKey;
    vi.spyOn(analysesRepository, 'findByCacheKey').mockImplementationOnce(async (...args) => {
      reached();
      await proceed;
      return original(...args);
    });
    const pending = post();
    await entered;
    let next: string;
    try {
      next = await publish();
    } finally {
      resume();
    }
    const first = await pending;
    expect(first.statusCode).toBe(202);
    expect(first.json().data.release_id).toBe(ids.current);
    const second = await post();
    expect(second.statusCode).toBe(202);
    expect(second.json().data.release_id).toBe(next!);
  });
});
