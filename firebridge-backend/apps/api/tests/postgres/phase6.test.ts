import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  seedContext,
  seedScientificContext,
  seedComparison,
  contextId,
  contextIds
} from '../helpers/context-fixture.js';
import { nativeIds } from '../helpers/native-fixture.js';
import { ids } from '../helpers/database.js';
import { createDatabase } from '../../src/repositories/database.js';

describe('Phase 6 frozen context on PostgreSQL/PostGIS', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = createApp({ logger: false });
  const get = (path: string, id = nativeIds.analysis) =>
    app.inject(`/api/v1/analyses/${id}/${path}`);
  const post = (payload: unknown = {}, key = 'explanation-test-1') =>
    app.inject({
      method: 'POST',
      url: `/api/v1/analyses/${nativeIds.analysis}/explanations`,
      payload,
      headers: { 'idempotency-key': key }
    });
  beforeAll(() => app.ready());
  beforeEach(() => seedContext(pool));
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('keeps native point coverage unknown and absent context missing rather than zero', async () => {
    const coverage = await get('coverage');
    expect(coverage.statusCode).toBe(200);
    expect(coverage.json().data).toMatchObject({
      status: 'unsupported',
      observation_coverage_status: 'unknown',
      coverage_fraction: null
    });
    for (const endpoint of ['weather', 'reports']) {
      const response = await get(endpoint, nativeIds.other);
      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('missing');
    }
  });
  it('serves exact weather members clipped to the saved area, not all records in a published asset', async () => {
    const response = await get('weather');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.series.map((v: { id: string }) => v.id)).toEqual(['1001', '1002']);
    expect(response.json().data.series[1]).toMatchObject({
      value: 25,
      data_kind: 'forecast',
      context_component: 'weather_recent'
    });
    expect(response.body).not.toMatch(/MAP_KEY|s3:\/\/|private|secret/);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('keeps UTC boundaries when the database connection has another default timezone', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('options', '-c timezone=Pacific/Honolulu');
    const database = createDatabase(url.toString());
    const alternate = createApp({ database, logger: false });
    try {
      const response = await alternate.inject(`/api/v1/analyses/${nativeIds.analysis}/weather`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.series.map((v: { id: string }) => v.id)).toEqual([
        '1001',
        '1002'
      ]);
    } finally {
      await alternate.close();
      await database.close();
    }
  });
  it('paginates weather and binds its cursor to the analysis and filters', async () => {
    const first = await get('weather?limit=1');
    const cursor = first.json().data.next_cursor;
    expect(cursor).toBeTruthy();
    const next = await get('weather?limit=1&cursor=' + encodeURIComponent(cursor));
    expect(next.json().data.series.map((v: { id: string }) => v.id)).toEqual(['1002']);
    expect(
      (await get('weather?limit=1&context=recent&cursor=' + encodeURIComponent(cursor))).statusCode
    ).toBe(422);
    expect(
      (await get('weather?limit=1&cursor=' + encodeURIComponent(cursor), nativeIds.other))
        .statusCode
    ).toBe(422);
  });
  it('serves only prepared weather summaries bound to the exact context inputs', async () => {
    const daily = await get('weather?resolution=day&context=historical');
    expect(daily.statusCode, daily.body).toBe(200);
    expect(daily.json().data.series).toHaveLength(1);
    expect(daily.json().data.series[0]).toMatchObject({
      value: 20,
      spatial_method: 'area_weighted'
    });
    await pool.query(`UPDATE firebridge.weather_summaries SET input_manifest_uri='stale'`);
    expect((await get('weather?resolution=day&context=historical')).json().data.status).toBe(
      'missing'
    );
  });
  it('does not follow a moved alias and refuses a broken context manifest', async () => {
    await pool.query('UPDATE firebridge.release_aliases SET release_id=$1', [ids.next]);
    expect((await get('weather')).json().data.context_release_ids).toContain(contextIds.historical);
    await pool.query('UPDATE firebridge.data_partitions SET row_count=3 WHERE id=$1', [
      contextId(21)
    ]);
    const response = await get('weather');
    expect(response.json().data).toMatchObject({ status: 'unavailable', series: [] });
  });
  it('preserves missing weather and refuses foreign-scope versions', async () => {
    await pool.query(
      `UPDATE firebridge.weather_values SET quality_status='missing',value=NULL WHERE id=1001`
    );
    expect((await get('weather')).json().data).toMatchObject({
      status: 'partial',
      series: [{ value: null }, { value: 25 }]
    });
    await pool.query(`UPDATE firebridge.data_releases SET scope_key='foreign' WHERE id=$1`, [
      contextIds.historical
    ]);
    expect((await get('weather')).statusCode).toBe(409);
  });
  it('preserves uncertain report claims and exact membership without exposing private URLs', async () => {
    const first = await get('reports?limit=1');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data.reports[0]).toMatchObject({
      event_id: contextId(41),
      relation: 'candidate',
      independence: 'unknown',
      location_precision: 'province',
      geometry: null,
      url: 'https://reports.example.org/article/1'
    });
    const next = await get(
      'reports?limit=1&cursor=' + encodeURIComponent(first.json().data.next_cursor)
    );
    expect(next.json().data.reports.map((r: { event_id: string }) => r.event_id)).toEqual([
      contextId(42)
    ]);
    const reviewed = await get('reports?review_status=reviewed');
    expect(reviewed.json().data.returned).toBe(1);
    expect(reviewed.body).not.toMatch(/MAP_KEY|s3:\/\/|token=|private|secret/);
  });
  it('compares native source counts while refusing unprepared scientific comparisons', async () => {
    const native = await get('comparison?resolution=month');
    expect(native.statusCode, native.body).toBe(200);
    expect(native.json().data.unit).toBe('detections');
    expect(
      native.json().data.series.find((v: { source_id: string }) => v.source_id === 'terra')
        .values[0].count
    ).toBe('2');
    expect((await get('comparison?view=common_response')).json().data).toMatchObject({
      status: 'unsupported',
      series: null
    });
  });
  it('serves prepared coverage and bounded cell evidence only with the validated scientific receipt', async () => {
    await seedScientificContext(pool);
    const coverage = await get('coverage', contextIds.science);
    expect(coverage.statusCode, coverage.body).toBe(200);
    expect(coverage.json().data).toMatchObject({
      status: 'ready',
      coverage_fraction: 1,
      observed_cell_days: '3',
      cloud_land_m2: null
    });
    const cell = await get('cells/6001?limit=1', contextIds.science);
    expect(cell.statusCode, cell.body).toBe(200);
    expect(cell.json().data).toMatchObject({ status: 'ready', returned: 1 });
    expect(cell.json().data.observations[0]).toMatchObject({
      retained_detection_count: 0,
      retained_any: false
    });
    expect(cell.body).not.toMatch(/s3:\/\/|private|secret/);
    expect(
      (
        await get(
          'cells/6001?limit=1&cursor=' + encodeURIComponent(cell.json().data.next_cursor),
          contextIds.science
        )
      ).json().data.observations[0].retained_detection_count
    ).toBe(1);
    expect((await get('cells/9999', contextIds.science)).statusCode).toBe(404);
  });
  it('refuses a missing mask or incomplete daily support rather than reporting false coverage', async () => {
    await seedScientificContext(pool);
    await pool.query(
      `DELETE FROM firebridge.observation_assets WHERE observation_id=$1 AND role='fire_mask'`,
      [contextId(110)]
    );
    expect((await get('coverage', contextIds.science)).json().data.status).toBe('unavailable');
    expect((await get('cells/6001', contextIds.science)).json().data.status).toBe('unavailable');
  });
  it('serves only the pinned validated comparison artifact and rejects invalid probabilities', async () => {
    await seedScientificContext(pool);
    await seedComparison(pool);
    const response = await get(
      'comparison?view=common_response&resolution=month',
      contextIds.science
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      status: 'ready',
      experiment_id: contextId(152),
      series: [{ source_id: 'terra', values: [{ value: 0.5 }] }]
    });
    await pool.query(
      `UPDATE firebridge.evaluations SET metrics=jsonb_set(metrics,'{public_comparison_v1,series,0,values,0,value}','42')`
    );
    expect(
      (await get('comparison?view=common_response&resolution=month', contextIds.science)).json()
        .data.status
    ).toBe('unsupported');
  });
  it('freezes evidence, job and outbox atomically and replays durable keys across cache aliases', async () => {
    const first = await post({ language: 'fr', question: 'Analyse une autre zone' });
    expect(first.statusCode, first.body).toBe(202);
    const result = first.json().data;
    expect(result).toMatchObject({
      status: 'queued',
      output: null,
      generation_mode: 'deterministic_template'
    });
    const second = await post(
      { language: 'fr', question: 'Analyse une autre zone' },
      'explanation-test-2'
    );
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().data.explanation_id).toBe(result.explanation_id);
    expect((await post({ language: 'en' })).statusCode).toBe(409);
    const events = await pool.query(
      `SELECT payload FROM firebridge.outbox_events WHERE event_type='explanation.requested'`
    );
    expect(events.rows).toEqual([{ payload: { job_id: result.job_id } }]);
    expect(
      (await pool.query('SELECT count(*) FROM firebridge.explanation_request_keys')).rows[0].count
    ).toBe('2');
    await expect(
      app.explanationService.get(result.explanation_id, 'another-actor')
    ).rejects.toMatchObject({ statusCode: 404 });
    const detail = await app.inject('/api/v1/explanations/' + result.explanation_id);
    expect(detail.statusCode).toBe(200);
  });
  it('serializes concurrent explanation retries into a single job', async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 202]);
    expect(new Set(responses.map((r) => r.json().data.job_id)).size).toBe(1);
  });
  it('rejects invalid filters and dates before returning context', async () => {
    for (const path of [
      'coverage?start_date=2024-02-30',
      'coverage?start_date=2023-01-01',
      'weather?variables=temperature,,wind',
      'reports?limit=0',
      'cells/9999999999999999999'
    ])
      expect((await get(path)).statusCode, path).toBe(422);
  });
});
