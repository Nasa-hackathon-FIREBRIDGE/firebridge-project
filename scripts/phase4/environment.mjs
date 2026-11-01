import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { fixtureKey } from './fixture.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export let fixtureDirectory = resolve(root, '.data', fixtureKey);

export function databaseIdentity(raw) {
  const value = new URL(raw);
  const hostname = ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) ? 'loopback' : value.hostname.toLowerCase();
  return `${hostname}:${value.port || '5432'}/${decodeURIComponent(value.pathname.slice(1))}`;
}

export function validateTargets(env, configured = {}) {
  if (env.NODE_ENV === 'production') throw new Error('Production mode is forbidden for Phase 4 fixtures.');
  if (!env.TEST_DATABASE_URL || !env.TEST_REDIS_URL) throw new Error('Set TEST_DATABASE_URL and TEST_REDIS_URL explicitly.');
  const database = new URL(env.TEST_DATABASE_URL);
  const redis = new URL(env.TEST_REDIS_URL);
  const name = decodeURIComponent(database.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !/^[a-zA-Z0-9_]+_test$/.test(name)) {
    throw new Error('The fixture database name must end with _test.');
  }
  if (!['redis:', 'rediss:'].includes(redis.protocol) || !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)) {
    throw new Error('Use a dedicated Redis test DB numbered 1 to 15.');
  }
  for (const original of [configured.DATABASE_URL, env.DATABASE_URL].filter(Boolean)) {
    if (databaseIdentity(original) === databaseIdentity(database.href)) throw new Error('Test database is also configured as the application database; refusing.');
  }
  for (const original of [configured.REDIS_URL, env.REDIS_URL].filter(Boolean)) {
    const existing = new URL(original);
    const normalize = (url) => {
      const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname.toLowerCase();
      return `${host}:${url.port || '6379'}/${Number(url.pathname.slice(1)) || 0}`;
    };
    if (normalize(existing) === normalize(redis)) throw new Error('Test Redis is also configured as the application Redis; refusing.');
  }
  return { name, databaseUrl: database.href, redisUrl: redis.href };
}

export async function configureFixtureEnvironment() {
  let configured = {};
  try { configured = parse(await readFile(resolve(root, '.env'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const target = validateTargets(process.env, configured);
  fixtureDirectory = resolve(root, '.data', fixtureKey, target.name);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = target.databaseUrl;
  process.env.REDIS_URL = target.redisUrl;
  process.env.EXPORT_STORAGE_DIR = resolve(fixtureDirectory, 'exports');
  // No dotenv override, no edits to .env, no development storage reuse.
  return target;
}

export async function inspectTestDatabase(target) {
  const { Prisma, PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    const [server] = await client.$queryRaw`
      SELECT current_database()::text AS name, current_setting('server_version_num')::int AS version`;
    if (server.name !== target.name || server.version < 160000 || server.version >= 170000) throw new Error('Expected the explicitly selected PostgreSQL 16 test database.');
    const [extension] = await client.$queryRaw`
      SELECT e.extversion AS version, n.nspname::text AS namespace FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis'`;
    if (!extension || !/^3\.4(?:\.|$)/.test(extension.version) || !['firebridge', 'public'].includes(extension.namespace)) {
      throw new Error('Expected PostGIS 3.4 in firebridge or public; no extension will be installed by this script.');
    }
    const columns = await client.$queryRaw`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'firebridge'`;
    const required = {
      sources: ['id', 'metadata', 'processing_stream'], areas: ['id', 'geom', 'geometry_sha256', 'version'],
      assets: ['id', 'source_id', 'sha256', 'byte_size'], detections: ['id', 'asset_id', 'source_id', 'geom', 'native_fields'],
      data_releases: ['id', 'config', 'observation_cutoff'], pipeline_runs: ['id', 'release_id', 'config'],
      data_partitions: ['id', 'pipeline_run_id', 'kind', 'row_count', 'serving_complete', 'validation_status'],
      release_assets: ['release_id', 'asset_id', 'role'], release_partitions: ['release_id', 'partition_id'],
      partition_detections: ['partition_id', 'detection_id'], metric_definitions: ['id', 'definition'],
      analyses: ['id', 'area_id', 'release_id', 'cache_key'], analysis_components: ['analysis_id', 'component', 'release_id'],
      api_jobs: ['id', 'requested_by', 'idempotency_key', 'result_manifest_uri', 'expires_at'],
      outbox_events: ['id', 'event_type', 'dedupe_key', 'payload']
    };
    for (const [table, names] of Object.entries(required)) {
      if (names.some((name) => !columns.some((column) => column.table_name === table && column.column_name === name))) {
        throw new Error(`Missing required Phase 4 table or column: ${table}. No migration will be applied by the fixture.`);
      }
    }
    const indexes = await client.$queryRaw`
      SELECT indexname::text,indexdef FROM pg_indexes WHERE schemaname = 'firebridge' AND tablename = 'detections'`;
    if (!indexes.some((index) => index.indexdef.includes('USING gist') && index.indexdef.includes('(geom)'))) {
      throw new Error('Missing detections.geom GiST index. No index will be created automatically.');
    }
    const constraints = await client.$queryRaw`
      SELECT c.conrelid::regclass::text AS relation,c.conname::text,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'firebridge' AND c.contype IN ('f','c','u','p') ORDER BY relation,c.conname`;
    const foreignKeys = await client.$queryRaw`
      SELECT src.relname::text AS source_table,dst.relname::text AS target_table,
        array_to_string(ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum ORDER BY k.ord), ',') AS source_columns,
        array_to_string(ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid = dst.oid AND a.attnum = k.attnum ORDER BY k.ord), ',') AS target_columns
      FROM pg_constraint c JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class dst ON dst.oid = c.confrelid JOIN pg_namespace n ON n.oid = src.relnamespace
      JOIN pg_namespace dn ON dn.oid = dst.relnamespace
      WHERE n.nspname = 'firebridge' AND dn.nspname = 'firebridge' AND c.contype = 'f'`;
    const signatures = new Set(foreignKeys.map((fk) => `${fk.source_table}(${fk.source_columns})>${fk.target_table}(${fk.target_columns})`));
    for (const expected of [
      'assets(source_id)>sources(id)', 'detections(asset_id)>assets(id)', 'detections(source_id)>sources(id)',
      'pipeline_runs(release_id)>data_releases(id)', 'data_partitions(pipeline_run_id)>pipeline_runs(id)',
      'partition_detections(partition_id)>data_partitions(id)', 'partition_detections(detection_id)>detections(id)',
      'release_partitions(release_id)>data_releases(id)',
      'release_partitions(partition_id,series_key,partition_key)>data_partitions(id,series_key,partition_key)',
      'analyses(area_id)>areas(id)', 'analyses(release_id)>data_releases(id)',
      'analysis_components(analysis_id)>analyses(id)', 'analysis_components(release_id)>data_releases(id)',
      'api_jobs(analysis_id)>analyses(id)', 'release_assets(release_id)>data_releases(id)', 'release_assets(asset_id)>assets(id)'
    ]) {
      if (!signatures.has(expected)) throw new Error(`Missing required foreign key: ${expected}. Constraints will not be bypassed.`);
    }
    const geometries = await client.$queryRaw(Prisma.sql`
      SELECT f_table_name AS name,type,srid,coord_dimension FROM ${Prisma.raw(`${extension.namespace}.geometry_columns`)}
      WHERE f_table_schema = 'firebridge' AND f_geometry_column = 'geom' AND f_table_name IN ('areas','detections')`);
    if (!geometries.some((g) => g.name === 'detections' && g.type === 'POINT' && g.srid === 4326 && g.coord_dimension === 2)
      || !geometries.some((g) => g.name === 'areas' && g.type === 'MULTIPOLYGON' && g.srid === 4326 && g.coord_dimension === 2)) {
      throw new Error('Expected areas MultiPolygon and detections Point, both 2D SRID 4326. No geometry schema will be changed.');
    }
    // Existing area services use unqualified PostGIS functions. Select their
    // observed namespace for this process; business tables remain schema-qualified.
    const url = new URL(target.databaseUrl);
    url.searchParams.set('schema', extension.namespace);
    process.env.DATABASE_URL = url.href;
    return { database: server.name, postgis: extension.version, postgis_schema: extension.namespace, geometries, indexes, constraints, foreignKeys };
  } finally { await client.$disconnect(); }
}
