import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { SnapshotDatabase } from '../../src/repositories/database.js';

export const ids = {
  old: '11111111-1111-4111-8111-111111111111',
  current: '22222222-2222-4222-8222-222222222222',
  next: '33333333-3333-4333-8333-333333333333',
  draft: '44444444-4444-4444-8444-444444444444',
  other: '55555555-5555-4555-8555-555555555555'
};
export async function testDatabase() {
  const db = new PGlite();
  const schema = await readFile(
    new URL('../../../../packages/database/prisma/sql/firebridge_schema_v2.sql', import.meta.url),
    'utf8'
  );
  const tables = new Set([
    'sources',
    'assets',
    'data_releases',
    'release_assets',
    'pipeline_runs',
    'areas',
    'grids',
    'metric_definitions',
    'ingestion_feeds',
    'feed_sources',
    'source_availability',
    'ingestion_subscriptions',
    'data_partitions',
    'release_partitions',
    'release_aliases',
    'release_changes'
  ]);
  // Use the production table definitions. Only PostGIS geometry is replaced: these tests
  // exercise catalog SQL, not spatial predicates. PostGIS remains required in production.
  const statements = [...schema.matchAll(/CREATE TABLE (\w+) \([\s\S]*?\n\);/g)]
    .filter((match) => tables.has(match[1]))
    .map((match) =>
      match[0]
        .replace(/geometry\([^)]*\)/g, 'jsonb')
        .replace('ST_IsValid(geom) AND NOT ST_IsEmpty(geom)', 'geom IS NOT NULL')
    );
  await db.exec('CREATE SCHEMA firebridge; SET search_path=firebridge,public;');
  await db.exec(
    `CREATE FUNCTION public.ST_AsGeoJSON(jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT $1::text';`
  );
  for (const sql of statements) await db.exec(sql);
  const adapter: SnapshotDatabase = {
    snapshot: (read) =>
      db.transaction(async (tx) => {
        await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return read({
          query: async <T>(sql: string, params: unknown[] = []) =>
            (await tx.query<T>(sql, params)).rows
        });
      }),
    close: () => db.close()
  };
  return { db, adapter };
}
export async function seed(db: PGlite) {
  await db.exec(
    'TRUNCATE firebridge.sources,firebridge.data_releases,firebridge.areas,firebridge.metric_definitions,firebridge.ingestion_feeds CASCADE'
  );
  const hash = 'a'.repeat(64);
  await db.exec(`
    INSERT INTO firebridge.sources
      (id,name,provider,kind,platform,instrument,product,collection,processing_stream,documentation_url,citation,license_info,schema_version)
    VALUES
      ('terra','Terra','NASA','hotspots','Terra','MODIS','MCD14ML','6.1','standard','https://example.org','NASA','attribution','1'),
      ('aqua','Aqua','NASA','hotspots','Aqua','MODIS','MCD14ML','6.1','standard','https://example.org','NASA','attribution','1'),
      ('noaa21','NOAA-21','NASA','hotspots','NOAA-21','VIIRS','VJ214IMG','2','standard','https://example.org','NASA','attribution','1');
    INSERT INTO firebridge.metric_definitions VALUES
      ('native_detections_v1','1','detections','native_detections','Native counts','{}',false,false),
      ('harmonized_v1','1','dimensionless_reference_response','harmonized_response','Not validated','{}',true,true);
    INSERT INTO firebridge.areas VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Morocco','1','{}','${hash}','Africa/Casablanca','fixture',now());
    INSERT INTO firebridge.ingestion_feeds VALUES
      ('modis','NASA','adapter','1','https://private.example/MAP_KEY/secret','secret','NASA','{}','active','2026-10-24Z'),
      ('unverified','NASA','adapter','1','private','private','NASA','{}','unverified',null);
    INSERT INTO firebridge.feed_sources VALUES ('modis','terra','{}'),('modis','aqua','{}'),('unverified','noaa21','{}');
    INSERT INTO firebridge.ingestion_subscriptions
      (id,feed_id,area_id,scope_key,mode,interval_seconds,overlap_seconds,history_start,request_config,config_sha256)
      VALUES
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','modis','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','morocco','backfill',3600,0,'2024-01-01Z','{}','${hash}'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','unverified','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','morocco','backfill',3600,0,'2024-01-01Z','{}','${hash}');
    INSERT INTO firebridge.source_availability VALUES
      ('modis','terra','2026-10-23Z','2024-01-01Z','2025-01-01Z','available',null,'{}'),
      ('modis','terra','2026-10-24Z','2024-01-01Z','2026-10-24Z','partial',null,'{}'),
      ('modis','aqua','2026-10-24Z',null,null,'unknown',null,'{}'),
      ('unverified','noaa21','2026-10-24Z','2024-01-01Z','2026-10-24Z','available',null,'{}');
    INSERT INTO firebridge.data_releases
      (id,name,status,stream,code_version,config,config_sha256,manifest_uri,parent_release_id,dataset_kind,scope_key,observation_cutoff,published_at)
    VALUES
      ('${ids.old}','old','published','retrospective','abc123','{"metric_ids":["native_detections_v1"],"manifest_sha256":"${hash}","private":"secret"}','${hash}','s3://private/manifest',null,'satellite','morocco','2024-01-18Z','2026-10-22Z'),
      ('${ids.current}','current','published','retrospective','def456','{"metric_ids":["native_detections_v1"],"manifest_sha256":"${hash}"}','${hash}','s3://private/manifest','${ids.old}','satellite','morocco','2024-01-20Z','2026-10-23Z'),
      ('${ids.next}','next','published','retrospective','ghi789','{"metric_ids":["native_detections_v1"]}','${hash}','s3://private/manifest','${ids.current}','satellite','morocco','2024-01-21Z','2026-10-24Z'),
      ('${ids.draft}','draft','draft','retrospective','draft','{}','${hash}','s3://private/manifest',null,'satellite','morocco','2024-01-20Z',null),
      ('${ids.other}','other','published','retrospective','other','{}','${hash}','s3://private/manifest',null,'satellite','spain','2024-01-20Z','2026-10-23Z');
    INSERT INTO firebridge.release_aliases VALUES ('latest_standard','morocco','${ids.current}',2,'2026-10-24Z');
    INSERT INTO firebridge.pipeline_runs (id,release_id,stage,idempotency_key,status,code_version,config,input_manifest_uri)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${ids.old}','normalize','test','succeeded','abc','{}','private');
    INSERT INTO firebridge.data_partitions
      (id,pipeline_run_id,kind,series_key,partition_key,support_spec,storage_uri,sha256,input_manifest_uri,schema_version,row_count,serving_complete,validation_status)
    VALUES
      ('10000000-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddddd','detections','terra','2024-01-17','{"source_ids":["terra"],"start":"2024-01-17T00:00:00Z","end_exclusive":"2024-01-18T00:00:00Z"}','s3://private/1','${hash}','private','1',10,true,'validated'),
      ('10000000-0000-4000-8000-000000000002','dddddddd-dddd-4ddd-8ddd-dddddddddddd','detections','terra','2024-01-18','{"source_ids":["terra"],"start":"2024-01-18T00:00:00Z","end_exclusive":"2024-01-19T00:00:00Z"}','s3://private/2','${hash}','private','1',0,true,'validated'),
      ('10000000-0000-4000-8000-000000000003','dddddddd-dddd-4ddd-8ddd-dddddddddddd','detections','terra','2024-01-19','{"source_ids":["terra"]}','s3://private/3','${hash}','private','1',0,false,'validated');
    INSERT INTO firebridge.release_partitions VALUES
      ('${ids.old}','terra','2024-01-17','10000000-0000-4000-8000-000000000001'),
      ('${ids.current}','terra','2024-01-17','10000000-0000-4000-8000-000000000001'),
      ('${ids.current}','terra','2024-01-18','10000000-0000-4000-8000-000000000002'),
      ('${ids.current}','terra','2024-01-19','10000000-0000-4000-8000-000000000003');
    INSERT INTO firebridge.assets (id,source_id,native_key,revision,source_url,storage_uri,sha256,byte_size,retrieved_at,validation_status)
      VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','terra','test','1','https://secret?MAP_KEY=secret','s3://private/input','${hash}',42,'2026-10-24Z','accepted');
    INSERT INTO firebridge.release_assets VALUES ('${ids.current}','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','raw');
    INSERT INTO firebridge.release_changes VALUES
      ('20000000-0000-4000-8000-000000000001','${ids.old}','${ids.current}','terra','2024-01-17Z','2024-01-19Z',null,'provider_revision','s3://private/diff','2026-10-23Z'),
      ('20000000-0000-4000-8000-000000000002','${ids.current}','${ids.next}','terra','2024-01-19Z','2024-01-20Z',null,'new_data','s3://private/diff','2026-10-24Z');
  `);
}
