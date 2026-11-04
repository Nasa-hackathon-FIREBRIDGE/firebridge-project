import type pg from 'pg';
import { ids, seed } from './database.js';

export const nativeIds = {
  analysis: 'a3000000-0000-4000-8000-000000000001',
  other: 'a3000000-0000-4000-8000-000000000002',
  area: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  asset: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  partition: '10000000-0000-4000-8000-000000000001'
};

// Synthetic geometry, dates and counts. This fixture must never seed the main database.
export async function seedNativeResults(pool: pg.Pool, expectedDatabase = 'firebridge_phase1_test') {
  const current = await pool.query('SELECT current_database() AS name');
  if ((expectedDatabase !== 'firebridge_phase1_test' && !/^firebridge_http_\d+_test$/.test(expectedDatabase)) || current.rows[0].name !== expectedDatabase)
    throw new Error('Native fixtures require an explicitly isolated test database.');
  await seed({ exec: (sql) => pool.query(sql) }, true);
  const points = [
    ['terra', '2024-01-17T00:00:00.000001Z', -7.5, 30.5, 'standard', null],
    ['terra', '2024-01-17T00:00:00.000002Z', -7.4, 30.5, 'standard', 0],
    ['aqua', '2024-01-18T12:00:00Z', -7.5, 30.6, 'standard', 12],
    ['terra', '2024-01-17T00:00:00.000003Z', -6, 32, 'standard', 1], // Outside the saved area.
    ['terra', '2024-01-20T00:00:00Z', -7.5, 30.5, 'standard', 2], // Exclusive end boundary.
    ['terra', '2024-01-17T00:00:00.000004Z', -7.5, 30.5, 'nrt', 3], // Excluded by the saved mode.
    ['terra', '2024-01-16T23:59:59Z', -7.5, 30.5, 'standard', 4]
  ] as const;
  const client = await pool.connect();
  // Use one connection for the fixture transaction; the API reads only committed data.
  await client.query('BEGIN');
  try {
    for (const [index, point] of points.entries()) {
      const [source, acquired, longitude, latitude, level, frp] = point;
      const id = (9007199254740993n + BigInt(index)).toString();
      await client.query(
        `INSERT INTO firebridge.detections
        (id,asset_id,source_id,native_record_key,record_sha256,identity_method,processing_level,
         acquired_at,geom,confidence_scheme,confidence_raw,frp_mw,brightness_bands)
        OVERRIDING SYSTEM VALUE VALUES ($1::bigint,$2::uuid,$3,$4,$5,'synthetic-fixture',$6,
          $7::timestamptz,ST_SetSRID(ST_MakePoint($8,$9),4326),'fixture',NULL,$10,'{"band_21":null}')`,
        [
          id,
          nativeIds.asset,
          source,
          'fixture-' + id,
          String(index + 1).repeat(64),
          level,
          acquired,
          longitude,
          latitude,
          frp
        ]
      );
      await client.query(
        'INSERT INTO firebridge.partition_detections VALUES ($1::uuid,$2::bigint)',
        [nativeIds.partition, id]
      );
    }
    await client.query(
      `DELETE FROM firebridge.release_partitions WHERE release_id=$1::uuid AND partition_key='2024-01-19'`,
      [ids.current]
    );
    await client.query(
      `UPDATE firebridge.data_partitions SET row_count=CASE WHEN id=$1::uuid THEN 7 ELSE 1 END,
      serving_complete=true,support_spec=$2::jsonb WHERE id=ANY($3::uuid[])`,
      [
        nativeIds.partition,
        JSON.stringify({
          source_ids: ['terra', 'aqua'],
          area_id: nativeIds.area,
          start: '2024-01-17T00:00:00Z',
          end_exclusive: '2024-01-20T00:00:00Z',
          inventory_complete: true
        }),
        [nativeIds.partition, '10000000-0000-4000-8000-000000000002']
      ]
    );
    await client.query('INSERT INTO firebridge.partition_detections VALUES ($1::uuid,$2::bigint)', [
      '10000000-0000-4000-8000-000000000002',
      '9007199254740993'
    ]);
    for (const id of [nativeIds.analysis, nativeIds.other]) {
      await client.query(
        `INSERT INTO firebridge.analyses
        (id,area_id,release_id,start_date,end_date_exclusive,time_basis,metric_key,selection_policy,
         weighting_version,weather_policy,news_policy,request_spec,cache_key,status)
        VALUES ($1::uuid,$2::uuid,$3::uuid,'2024-01-17','2024-01-20','utc','native_detections_v1',
          'standard','v1','{}','{}',$4::jsonb,$5,'partial')`,
        [
          id,
          nativeIds.area,
          ids.current,
          JSON.stringify({ source_ids: ['terra', 'aqua', 'noaa21'], data_mode: 'standard_only' }),
          'synthetic-' + id
        ]
      );
      await client.query(
        `INSERT INTO firebridge.analysis_components VALUES
        ($1::uuid,'satellite',$2::uuid,'ready','[]'),
        ($1::uuid,'weather_historical',NULL,'missing','["TEST_ONLY"]'),
        ($1::uuid,'reports',NULL,'missing','["TEST_ONLY"]')`,
        [id, ids.current]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
