import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { nativeIds, seedNativeResults } from '../helpers/native-fixture.js';
import { ids } from '../helpers/database.js';
import { disconnectDatabase } from '@firebridge/database';
import { disconnectRedis } from '../../src/config/redis.js';

describe('Phase 3 native results on PostgreSQL/PostGIS', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const app = createApp({ logger: false });
  const get = (path: string, analysis = nativeIds.analysis) =>
    app.inject(`/api/v1/analyses/${analysis}/${path}`);
  beforeAll(() => app.ready());
  beforeEach(() => seedNativeResults(pool));
  afterAll(async () => {
    await app.close();
    await pool.end();
    await Promise.all([disconnectDatabase(), disconnectRedis()]);
  });

  it('clips to the area, time and frozen standard mode and deduplicates membership', async () => {
    const res = await get('detections');
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.returned).toBe(3);
    expect(
      data.features.map((f: { properties: { detection_id: string } }) => f.properties.detection_id)
    ).toEqual(['9007199254740993', '9007199254740994', '9007199254740995']);
    expect(data.features[0].geometry).toEqual({ type: 'Point', coordinates: [-7.5, 30.5] });
    expect(data.features[0].properties.frp_mw).toBeNull();
    expect(data.features[1].properties.frp_mw).toBe(0);
    expect(data.features[0].properties.confidence_raw).toBeNull();
    expect(data.data_release_id).toBe(ids.current);
  });
  it('serves canonical single-source pipeline partitions across native reads and map tiles', async () => {
    await pool.query(`DELETE FROM firebridge.partition_detections pd USING firebridge.detections d
      WHERE d.id=pd.detection_id AND d.source_id='aqua'`);
    await pool.query(`UPDATE firebridge.data_partitions p SET
      row_count=(SELECT count(*) FROM firebridge.partition_detections pd WHERE pd.partition_id=p.id),
      support_spec='{"source_id":"terra","scope_key":"global","bbox":[-180,-90,180,90],"start":"2024-01-17T00:00:00+00:00","end_exclusive":"2024-01-20T00:00:00+00:00","query_complete":true,"processing_stream":"standard","observation_coverage":"unknown"}'::jsonb`);
    await pool.query(`UPDATE firebridge.analyses SET request_spec=request_spec-'source_ids' WHERE id=$1::uuid`, [nativeIds.analysis]);
    const detections = await get('detections');
    expect(detections.statusCode).toBe(200);
    expect(detections.json().data.returned).toBe(2);
    const summary = (await get('summary')).json().data;
    expect(summary.native_detections_by_source).toEqual([
      expect.objectContaining({ source_id: 'terra', count: '2', count_status: 'lower_bound' })
    ]);
    expect(summary.coverage.fraction).toBeNull();
    const tile = await get('tiles/detections/0/0/0.mvt');
    expect(tile.statusCode).toBe(200);
    expect(tile.rawPayload.length).toBeGreaterThan(0);
    // A pipeline whole-world scope must not be mistaken for a narrow dateline AOI.
    await pool.query(`UPDATE firebridge.areas SET geom=ST_Multi(ST_MakeEnvelope(-180,-90,180,90,4326)) WHERE id=$1::uuid`, [nativeIds.area]);
    const global = await get('detections');
    expect(global.statusCode).toBe(200);
    expect(global.json().data.returned).toBe(3);
  });
  it('keeps microsecond precision and bigint IDs across cursor pages', async () => {
    const first = (await get('detections?limit=1')).json().data;
    const second = (
      await get('detections?limit=1&cursor=' + encodeURIComponent(first.next_cursor))
    ).json().data;
    expect(first.features[0].properties.acquired_at).toBe('2024-01-17T00:00:00.000001Z');
    expect(second.features[0].properties.detection_id).toBe('9007199254740994');
    expect(second.features[0].properties.acquired_at).toBe('2024-01-17T00:00:00.000002Z');
    expect(first.truncated).toBe(true);
  });
  it('binds cursors to the analysis, filters, page size, endpoint and trusted identity', async () => {
    const first = (await get('detections?limit=1')).json().data;
    const token = encodeURIComponent(first.next_cursor);
    for (const path of [
      `detections?limit=2&cursor=${token}`,
      `detections?limit=1&source_ids=aqua&cursor=${token}`,
      `detections?limit=1&cursor=${token}x`,
      `provenance?limit=1&cursor=${token}`
    ])
      expect((await get(path)).statusCode).toBe(422);
    expect((await get(`detections?limit=1&cursor=${token}`, nativeIds.other)).statusCode).toBe(422);
    const scoped = await app.nativeResultsService.detections(
      nativeIds.analysis,
      { limit: '1' },
      'tenant:A'
    );
    await expect(
      app.nativeResultsService.detections(
        nativeIds.analysis,
        { limit: '1', cursor: scoped.next_cursor! },
        'tenant:B'
      )
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it('allows source, bbox and time narrowing without widening the saved selection', async () => {
    expect((await get('detections?source_ids=aqua')).json().data.returned).toBe(1);
    expect((await get('detections?bbox=-7.45,30,-7,31')).json().data.returned).toBe(1);
    expect((await get('detections?start=2024-01-18T00:00:00Z')).json().data.returned).toBe(1);
    for (const query of [
      'source_ids=outside',
      'start=2024-01-16T00:00:00Z',
      'end_exclusive=2024-01-21T00:00:00Z',
      'bbox=170,-5,-170,5',
      'limit=5001',
      'confidence_min=10'
    ])
      expect((await get('detections?' + query)).statusCode).toBe(422);
  });
  it('reports per-source counts without inventing comparable response or observation coverage', async () => {
    const data = (await get('summary')).json().data;
    expect(data.native_detections_by_source).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_id: 'terra', count: '2', count_status: 'complete' }),
        expect.objectContaining({ source_id: 'aqua', count: '1', count_status: 'complete' }),
        expect.objectContaining({ source_id: 'noaa21', count: null, count_status: 'unknown' })
      ])
    );
    expect(data.comparable_response.value).toBeNull();
    expect(data.coverage.fraction).toBeNull();
    expect(data.report_counts_by_review_status).toBeNull();
    expect(data.limitations).toContain('DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS');
  });
  it('includes empty days with zero only for verified complete source inventory', async () => {
    const res = await get('calendar');
    expect(res.statusCode).toBe(200);
    const days = res.json().data.periods;
    expect(days).toHaveLength(3);
    expect(days[2].counts_by_source).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_id: 'terra', count: '0', inventory_status: 'complete' }),
        expect.objectContaining({ source_id: 'aqua', count: '0', inventory_status: 'complete' }),
        expect.objectContaining({ source_id: 'noaa21', count: null })
      ])
    );
    expect(days[0].coverage_fraction).toBeNull();
  });
  it('keeps unknown inventory distinct from zero even if serving rows are loaded', async () => {
    await pool.query(
      "UPDATE firebridge.data_partitions SET support_spec=support_spec-'inventory_complete'"
    );
    const data = (await get('calendar')).json().data;
    expect(
      data.periods[2].counts_by_source.every((s: { count: unknown }) => s.count === null)
    ).toBe(true);
    expect(
      data.periods[0].counts_by_source.find((s: { source_id: string }) => s.source_id === 'terra')
    ).toMatchObject({ count: '2', count_status: 'lower_bound' });
  });
  it('keeps dates beyond the pinned cutoff unknown while retaining available observations', async () => {
    await pool.query(`UPDATE firebridge.analyses SET end_date_exclusive='2024-01-22' WHERE id=$1`, [nativeIds.analysis]);
    const summary = (await get('summary')).json().data;
    expect(summary.status).toBe('partial');
    expect(summary.native_detections_by_source).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: 'terra', count: '3', count_status: 'lower_bound', inventory_status: 'partial' }),
      expect.objectContaining({ source_id: 'aqua', count: '1', count_status: 'lower_bound', inventory_status: 'partial' })
    ]));
    const calendar = (await get('calendar')).json().data;
    expect(calendar.status).toBe('partial');
    const tail = calendar.periods.find((period: { start: string }) => period.start.startsWith('2024-01-21'));
    expect(tail.counts_by_source.every((source: { count: unknown; count_status: string }) =>
      source.count === null && source.count_status === 'unknown')).toBe(true);
    expect((await get('detections')).json().data.returned).toBe(4);
  });
  it('groups weeks and months and clips periods to the requested analysis window', async () => {
    for (const resolution of ['week', 'month']) {
      const data = (await get('calendar?resolution=' + resolution)).json().data;
      expect(data.periods).toHaveLength(1);
      expect(data.periods[0].start).toBe('2024-01-17T00:00:00.000Z');
      expect(data.periods[0].end_exclusive).toBe('2024-01-20T00:00:00.000Z');
      expect(
        data.periods[0].counts_by_source.find((s: { source_id: string }) => s.source_id === 'terra')
          .count
      ).toBe('2');
    }
    expect((await get('calendar?start_date=2024-02-30')).statusCode).toBe(422);
  });
  it('never serves an incomplete or inconsistent SQL slice as a complete detection result', async () => {
    await pool.query(
      'UPDATE firebridge.data_partitions SET serving_complete=false WHERE id=$1::uuid',
      [nativeIds.partition]
    );
    expect((await get('detections')).statusCode).toBe(409);
    expect(
      (await get('summary'))
        .json()
        .data.native_detections_by_source.every((s: { count: unknown }) => s.count === null)
    ).toBe(true);
    await pool.query(
      'UPDATE firebridge.data_partitions SET serving_complete=true,row_count=999 WHERE id=$1::uuid',
      [nativeIds.partition]
    );
    expect((await get('detections')).statusCode).toBe(409);
  });
  it('keeps existing results pinned when the current alias changes', async () => {
    const before = await get('summary');
    await pool.query(
      'UPDATE firebridge.release_aliases SET release_id=$1::uuid,generation=generation+1',
      [ids.next]
    );
    const after = await get('summary');
    expect(after.json().data).toEqual(before.json().data);
    expect(after.headers.etag).toBe(before.headers.etag);
  });
  it('returns provenance hashes and citations with pagination and no private paths', async () => {
    const response = await get('provenance?limit=1');
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.assets[0].citation).toBe('NASA');
    const next = await get('provenance?limit=1&cursor=' + encodeURIComponent(data.next_cursor));
    expect(next.json().data.assets[0].role).not.toBe(data.assets[0].role);
    expect(response.body).not.toMatch(
      /s3:\/\/|MAP_KEY|credential_ref|storage_uri|source_url|private|secret/
    );
    expect((await get('provenance?asset_id=' + nativeIds.asset)).statusCode).toBe(200);
  });
  it('honors ETags and keeps request IDs outside the immutable representation', async () => {
    const first = await app.inject({
      url: `/api/v1/analyses/${nativeIds.analysis}/summary`,
      headers: { origin: 'http://localhost:5173' }
    });
    expect(first.headers['access-control-expose-headers']).toContain('ETag');
    const second = await app.inject({
      url: `/api/v1/analyses/${nativeIds.analysis}/summary`,
      headers: { 'if-none-match': String(first.headers.etag) }
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    expect(first.headers['x-request-id']).toBe(first.json().request_id);
  });
  it('returns explicit unsupported output for non-UTC, mixed-mode and unknown quality policies', async () => {
    for (const [update, reason] of [
      ["time_basis='local_solar'", 'TIME_BASIS_NOT_SUPPORTED'],
      [
        'request_spec=request_spec || \'{"data_mode":"best_available"}\'::jsonb',
        'DATA_MODE_NOT_SUPPORTED'
      ],
      [
        'request_spec=request_spec || \'{"confidence_policy":{"minimum":90}}\'::jsonb',
        'QUALITY_POLICY_NOT_SUPPORTED'
      ],
      [
        'request_spec=request_spec || \'{"data_mode":{"credential":"private-secret"}}\'::jsonb',
        'DATA_MODE_NOT_SUPPORTED'
      ]
    ]) {
      await pool.query(
        `UPDATE firebridge.analyses SET time_basis='utc',
        request_spec='{"source_ids":["terra","aqua","noaa21"],"data_mode":"standard_only"}' WHERE id=$1::uuid`,
        [nativeIds.analysis]
      );
      await pool.query('UPDATE firebridge.analyses SET ' + update + ' WHERE id=$1::uuid', [
        nativeIds.analysis
      ]);
      const res = await get('summary');
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('unsupported');
      expect(res.json().data.limitations).toContain(reason);
      expect(res.body).not.toContain('private-secret');
      expect(
        res
          .json()
          .data.native_detections_by_source.every((s: { count: unknown }) => s.count === null)
      ).toBe(true);
    }
  });
  it('reads the analysis created through the integrated Phase 2 API', async () => {
    await pool.query(
      "UPDATE firebridge.data_releases SET status='retired' WHERE id=ANY($1::uuid[])",
      [[ids.next, ids.other]]
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        area_id: nativeIds.area,
        start_date: '2024-01-17',
        end_date_exclusive: '2024-01-20',
        time_basis: 'utc'
      }
    });
    expect(created.statusCode).toBe(202);
    const analysis = created.json().data.id;
    expect(created.json().data.release_id).toBe(ids.current);
    expect((await get('detections', analysis)).json().data.returned).toBe(3);
    expect((await get('summary', analysis)).json().data.native_detections_by_source).toEqual(
      expect.arrayContaining([expect.objectContaining({ source_id: 'terra', count: '2' })])
    );
  });
  it('respects holes in a saved geographic selection', async () => {
    const area = 'a3000000-0000-4000-8000-000000000003';
    await pool.query(
      `INSERT INTO firebridge.areas
      SELECT $1::uuid,'TEST ONLY - hole','1',ST_Multi(ST_Difference(geom,ST_MakeEnvelope(-7.6,30.4,-7.45,30.55,4326))),
        repeat('b',64),'UTC','synthetic-fixture',now() FROM firebridge.areas WHERE id=$2::uuid`,
      [area, nativeIds.area]
    );
    await pool.query('UPDATE firebridge.analyses SET area_id=$1::uuid WHERE id=$2::uuid', [
      area,
      nativeIds.other
    ]);
    const data = (await get('detections', nativeIds.other)).json().data;
    expect(data.returned).toBe(2);
    expect(
      data.features.map((f: { properties: { detection_id: string } }) => f.properties.detection_id)
    ).not.toContain('9007199254740993');
  });
  it('clips a Phase 2 antimeridian area on both sides without selecting Greenwich', async () => {
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        name: 'TEST ONLY - dateline',
        version: 'phase3-dateline',
        display_timezone: 'UTC',
        provenance: 'synthetic-fixture',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [179, -17],
              [-179, -17],
              [-179, -16],
              [179, -16],
              [179, -17]
            ]
          ]
        }
      }
    });
    expect(saved.statusCode).toBe(201);
    await pool.query('UPDATE firebridge.analyses SET area_id=$1::uuid WHERE id=$2::uuid', [
      saved.json().data.id,
      nativeIds.other
    ]);
    for (const [index, longitude] of [179.5, -179.5, 0].entries()) {
      const id = (9007199254741003n + BigInt(index)).toString();
      await pool.query(
        `INSERT INTO firebridge.detections
        (id,asset_id,source_id,native_record_key,record_sha256,identity_method,processing_level,acquired_at,geom,confidence_scheme)
        OVERRIDING SYSTEM VALUE VALUES ($1::bigint,$2::uuid,'terra',$1,$3,'synthetic-fixture','standard',
          '2024-01-18T18:00:00Z',ST_SetSRID(ST_MakePoint($4,-16.5),4326),'fixture')`,
        [id, nativeIds.asset, ['b', 'c', 'd'][index].repeat(64), longitude]
      );
      await pool.query('INSERT INTO firebridge.partition_detections VALUES ($1::uuid,$2::bigint)', [
        nativeIds.partition,
        id
      ]);
    }
    await pool.query(
      'UPDATE firebridge.data_partitions SET row_count=row_count+3 WHERE id=$1::uuid',
      [nativeIds.partition]
    );
    const result = await get('detections', nativeIds.other);
    expect(result.statusCode).toBe(200);
    expect(
      result
        .json()
        .data.features.map(
          (f: { geometry: { coordinates: number[] } }) => f.geometry.coordinates[0]
        )
    ).toEqual([179.5, -179.5]);
    const combined = 'a3000000-0000-4000-8000-000000000004';
    await pool.query(
      `INSERT INTO firebridge.areas
      SELECT $1::uuid,'TEST ONLY - multiple regions','1',
        ST_Multi(ST_CollectionExtract(ST_Collect(geom,ST_MakeEnvelope(-1,0,1,1,4326)),3)),
        repeat('c',64),'UTC','synthetic-fixture',now() FROM firebridge.areas WHERE id=$2::uuid`,
      [combined, saved.json().data.id]
    );
    await pool.query('UPDATE firebridge.analyses SET area_id=$1::uuid WHERE id=$2::uuid', [
      combined,
      nativeIds.other
    ]);
    await pool.query(
      `INSERT INTO firebridge.detections
      (id,asset_id,source_id,native_record_key,record_sha256,identity_method,processing_level,acquired_at,geom,confidence_scheme)
      OVERRIDING SYSTEM VALUE VALUES (9007199254741006,$1::uuid,'terra','composite-region',repeat('e',64),
        'synthetic-fixture','standard','2024-01-18T18:00:00Z',ST_SetSRID(ST_MakePoint(0,0.5),4326),'fixture')`,
      [nativeIds.asset]
    );
    await pool.query(
      'INSERT INTO firebridge.partition_detections VALUES ($1::uuid,9007199254741006)',
      [nativeIds.partition]
    );
    await pool.query(
      'UPDATE firebridge.data_partitions SET row_count=row_count+1 WHERE id=$1::uuid',
      [nativeIds.partition]
    );
    expect((await get('detections', nativeIds.other)).json().data.returned).toBe(3);
  });
  it('rejects inconsistent satellite components and unknown analyses', async () => {
    expect((await get('summary', 'a3000000-0000-4000-8000-000000000099')).statusCode).toBe(404);
    await pool.query(
      "UPDATE firebridge.analysis_components SET release_id=$1::uuid WHERE analysis_id=$2::uuid AND component='satellite'",
      [ids.old, nativeIds.analysis]
    );
    expect((await get('summary')).statusCode).toBe(409);
  });
});
