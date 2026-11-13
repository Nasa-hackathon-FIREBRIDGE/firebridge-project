import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { HISTORICAL_MAX_WINDOW_DAYS } from '@firebridge/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { seedNativeResults, nativeIds } from '../helpers/native-fixture.js';

describe('historical routing and immutable analysis identity', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp({ logger: false });
  let catalog: string;
  const body = { area_id: nativeIds.area, start_date: '2020-01-01', end_date_exclusive: '2021-01-01' };
  const previousUrl = env.HISTORY_SERVICE_URL;
  const post = (value: unknown = body) => app.inject({ method: 'POST', url: '/api/v1/analyses', payload: value });
  beforeAll(() => app.ready());
  beforeEach(async () => {
    env.HISTORY_SERVICE_URL = 'http://history:8090';
    await seedNativeResults(pool);
    catalog = randomUUID();
    await pool.query(`INSERT INTO firebridge.data_releases
      (id,name,status,stream,code_version,config,config_sha256,manifest_uri,dataset_kind,scope_key,observation_cutoff,published_at)
      VALUES ($1,'TEST ONLY archive catalog','published','retrospective','archive-selection-v1',
        '{"engine":"archive-selection-v1","start":"2000-11-01","end_exclusive":"2026-08-01"}',
        $2,'objects/fixture.json','satellite','phase1_test','2026-08-01',now())`, [catalog, 'a'.repeat(64)]);
  });
  afterEach(() => { env.HISTORY_SERVICE_URL = previousUrl; });
  afterAll(async () => { await app.close(); await pool.end(); });
  it('queues missing historical data instead of treating a later cutoff as proof of coverage', async () => {
    const response = await post();
    expect(response.statusCode).toBe(202);
    const id = response.json().data.id;
    const { rows } = await pool.query(`SELECT a.release_id,a.request_spec,c.status FROM firebridge.analyses a
      JOIN firebridge.analysis_components c ON c.analysis_id=a.id AND c.component='satellite' WHERE a.id=$1`, [id]);
    expect(rows[0].release_id).toBe(catalog);
    expect(rows[0].request_spec.history_catalog_id).toBe(catalog);
    expect(rows[0].status).toBe('missing');
  });
  it('reuses the same archive request without creating duplicate work', async () => {
    const first = await post();
    const second = await post();
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
  });
  it('queues an overlapping selection beyond the standard cutoff without shortening the saved dates', async () => {
    const request = { ...body, start_date: '2025-03-09', end_date_exclusive: '2026-11-09' };
    const response = await post(request);
    expect(response.statusCode).toBe(202);
    const { rows } = await pool.query(`SELECT release_id,start_date::text,end_date_exclusive::text,request_spec
      FROM firebridge.analyses WHERE id=$1`, [response.json().data.id]);
    expect(rows[0]).toMatchObject({ release_id: catalog, start_date: request.start_date,
      end_date_exclusive: request.end_date_exclusive, request_spec: { history_catalog_id: catalog } });
    const repeat = await post(request);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().data.id).toBe(response.json().data.id);
  });
  it('queues an interval overlapping the beginning of the archive', async () => {
    const response = await post({ ...body, start_date: '2000-10-25', end_date_exclusive: '2000-11-02' });
    expect(response.statusCode).toBe(202);
    const { rows } = await pool.query('SELECT release_id FROM firebridge.analyses WHERE id=$1', [response.json().data.id]);
    expect(rows[0].release_id).toBe(catalog);
  });
  it.each([
    ['2026-08-01', '2026-11-09'],
    ['2027-01-01', '2027-02-01'],
    ['2000-10-01', '2000-11-01']
  ])('rejects a non-overlapping archive interval %s to %s', async (start, end) => {
    const response = await post({ ...body, start_date: start, end_date_exclusive: end });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NO_COMPATIBLE_RELEASE');
    expect((await pool.query('SELECT count(*) AS n FROM firebridge.analyses WHERE start_date=$1 AND end_date_exclusive=$2', [start, end])).rows[0].n).toBe('0');
  });
  it('never treats a metadata-only catalog as prepared data when historical routing is disabled', async () => {
    env.HISTORY_SERVICE_URL = undefined;
    const result = await post();
    expect(result.statusCode).toBe(202);
    expect(result.json().data.release_id).not.toBe(catalog);
    const { rows } = await pool.query('SELECT request_spec FROM firebridge.analyses WHERE id=$1', [result.json().data.id]);
    expect(rows[0].request_spec.history_catalog_id).toBeUndefined();
  });
  it('rejects dates before the archive starts', async () => {
    const result = await post({ ...body, start_date: '1980-01-01', end_date_exclusive: '1981-01-01' });
    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe('NO_COMPATIBLE_RELEASE');
  });
  it('rejects unsupported historical time interpretation before scheduling computation', async () => {
    const result = await post({ ...body, time_basis: 'local_solar' });
    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe('UNSUPPORTED_HISTORICAL_SELECTION');
  });
  it.each(['2014-01-01', '2000-01-01'])('queues the longer historical window starting %s', async (start) => {
    const request = { ...body, start_date: start, end_date_exclusive: '2026-11-11' };
    const result = await post(request);
    expect(result.statusCode).toBe(202);
    expect(result.json().data).toMatchObject({ start_date: start, end_date_exclusive: request.end_date_exclusive });
    const repeat = await post(request);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().data.id).toBe(result.json().data.id);
  });
  it('accepts the exact historical window limit', async () => {
    const end = new Date(Date.parse(body.start_date) + HISTORICAL_MAX_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    expect((await post({ ...body, end_date_exclusive: end })).statusCode).toBe(202);
  });
  it('rejects one day beyond the historical window limit before creating work', async () => {
    const end = new Date(Date.parse(body.start_date) + (HISTORICAL_MAX_WINDOW_DAYS + 1) * 86400000).toISOString().slice(0, 10);
    const result = await post({ ...body, end_date_exclusive: end });
    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe('HISTORICAL_WINDOW_TOO_LARGE');
    expect(result.json().message).toBe('Select at most 10980 days per historical analysis.');
    expect((await pool.query('SELECT count(*) AS n FROM firebridge.analyses WHERE end_date_exclusive=$1', [end])).rows[0].n).toBe('0');
  });
});
