/** Real PostgreSQL/PostGIS/Redis tests, enabled only by the isolated test config. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, rmdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import { detectionSelection, resultsConfig } from '@firebridge/results';
import { localExportStorage } from '@firebridge/results/storage';
import type { Job } from 'bullmq';
import { Worker, QueueEvents } from 'bullmq';
import { createFirebridgeQueue, parseRedisConnection } from '../src/queues/firebridge-queue.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { disconnectRedis } from '../../api/src/config/redis.js';
import { exportsRepository } from '../../api/src/repositories/exports.repository.js';
import { detectionTileSql } from '../../api/src/repositories/tiles.repository.js';
import { processExportJob, type ExportJobPayload } from '../src/processors/export.processor.js';

const analysisId = randomUUID();
const areaId = randomUUID();
const releaseId = randomUUID();
const assetId = randomUUID();
const partitionId = randomUUID();
const pipelineId = randomUUID();
const actor = `phase4-test-${randomUUID()}`;
const source = `test-${randomUUID()}`;
const rowCount = 10000;
let app: Awaited<ReturnType<typeof createApp>>;
const keys: string[] = [];
const task = (id: string) => ({ data: { job_id: id }, opts: { attempts: 3 }, attemptsMade: 0 }) as Job<ExportJobPayload>;

beforeAll(async () => {
  // Fixtures exist exclusively in the explicitly selected *_test database.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
    await tx.$executeRaw`INSERT INTO firebridge.sources
      (id,name,provider,kind,product,collection,processing_stream,documentation_url,citation,license_info,schema_version)
      VALUES (${source},'Phase 4 fixture','test','hotspots','test','test','standard','https://example.test','test','test','1')`;
    await tx.$executeRaw`INSERT INTO firebridge.assets
      (id,source_id,native_key,revision,source_url,storage_uri,sha256,byte_size,retrieved_at,validation_status)
      VALUES (${assetId}::uuid,${source},'fixture','1','https://example.test','test://fixture',${'a'.repeat(64)},0,now(),'accepted')`;
    await tx.$executeRaw`INSERT INTO firebridge.areas
      (id,name,version,geom,geometry_sha256,display_timezone,provenance)
      VALUES (${areaId}::uuid,'Phase 4 test',${analysisId},ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)),${'b'.repeat(64)},'UTC','test')`;
    await tx.$executeRaw`INSERT INTO firebridge.data_releases
      (id,name,status,stream,code_version,config,config_sha256,manifest_uri,dataset_kind,scope_key,observation_cutoff,published_at)
      VALUES (${releaseId}::uuid,${`phase4-${releaseId}`},'published','retrospective','test','{}',${'c'.repeat(64)},'test://release','satellite','test','2026-02-01',now())`;
    await tx.$executeRaw`INSERT INTO firebridge.pipeline_runs
      (id,release_id,stage,idempotency_key,status,code_version,config,input_manifest_uri)
      VALUES (${pipelineId}::uuid,${releaseId}::uuid,'test',${pipelineId},'succeeded','test','{}','test://input')`;
    await tx.$executeRaw`INSERT INTO firebridge.data_partitions
      (id,pipeline_run_id,kind,series_key,partition_key,support_spec,storage_uri,sha256,input_manifest_uri,schema_version,row_count,serving_complete,validation_status)
      VALUES (${partitionId}::uuid,${pipelineId}::uuid,'detections',${source},'2026-01',${JSON.stringify({source_ids:[source]})}::jsonb,'test://partition',${'d'.repeat(64)},'test://input','1',${rowCount+3},true,'validated')`;
    await tx.$executeRaw`INSERT INTO firebridge.release_partitions(release_id,series_key,partition_key,partition_id)
      VALUES (${releaseId}::uuid,${source},'2026-01',${partitionId}::uuid)`;
    await tx.$executeRaw`INSERT INTO firebridge.detections
      (asset_id,source_id,native_record_key,record_sha256,identity_method,processing_level,acquired_at,geom,confidence_raw,confidence_scheme,frp_mw)
      SELECT ${assetId}::uuid,${source},i::text,md5(${source} || i::text) || md5(i::text || ${source}),'native',
        CASE WHEN i = ${rowCount + 3} THEN 'nrt' ELSE 'standard' END,
        CASE WHEN i = ${rowCount + 2} THEN '2027-01-02'::timestamptz ELSE '2026-01-02'::timestamptz END,
        CASE WHEN i = ${rowCount + 1} THEN ST_SetSRID(ST_MakePoint(3,3),4326)
          ELSE ST_SetSRID(ST_MakePoint(0.1 + (i % 100)/125.0,0.1 + (i % 100)/125.0),4326) END,
        '=1+1','test',1.0 FROM generate_series(1,${rowCount + 4}::int) i`;
    // The last detection deliberately belongs to no partition of this release.
    await tx.$executeRaw`INSERT INTO firebridge.partition_detections(partition_id,detection_id)
      SELECT ${partitionId}::uuid,id FROM firebridge.detections
      WHERE source_id = ${source} AND native_record_key::int <= ${rowCount + 3}`;
    await tx.$executeRaw`INSERT INTO firebridge.analyses
      (id,area_id,release_id,start_date,end_date_exclusive,time_basis,metric_key,selection_policy,weighting_version,weather_policy,news_policy,request_spec,cache_key,status,completed_at)
      VALUES (${analysisId}::uuid,${areaId}::uuid,${releaseId}::uuid,'2026-01-01','2026-01-03','utc','native_detections_v1','standard','v1','{}','{}',${JSON.stringify({data_mode:'standard_only',source_ids:[source]})}::jsonb,${analysisId},'ready',now())`;
    await tx.$executeRaw`INSERT INTO firebridge.analysis_components(analysis_id,component,release_id,status)
      VALUES (${analysisId}::uuid,'satellite',${releaseId}::uuid,'ready')`;
    await tx.$executeRaw`INSERT INTO firebridge.api_jobs
      (id,kind,analysis_id,requested_by,request_hash,idempotency_key,request_spec,status)
      VALUES (${randomUUID()}::uuid,'analysis',${analysisId}::uuid,${actor},${analysisId},${analysisId},'{}','succeeded')`;
  }, { timeout: 30000 });
  // Bulk fixture inserts need planner statistics before performance assertions.
  await prisma.$executeRaw`ANALYZE firebridge.detections, firebridge.partition_detections,
    firebridge.release_partitions, firebridge.data_partitions, firebridge.analyses,
    firebridge.analysis_components, firebridge.areas`;
  app = await createApp();
}, 40000);

afterAll(async () => {
  await app?.close();
  for (const key of keys) await localExportStorage.remove(key);
  await disconnectRedis();
  await prisma.$disconnect();
});
describe('Phase 4 real integration and performance', () => {
  it('generates real binary MVT and an empty tile; excludes other AOI/time/stream/release detections', async () => {
    const [count] = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
      return tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count ${detectionSelection(analysisId)}`);
    });
    expect(Number(count.count)).toBe(rowCount);
    const tile = await app.inject({ url: `/api/v1/analyses/${analysisId}/tiles/detections/0/0/0.mvt` });
    expect(tile.statusCode).toBe(200);
    expect(tile.rawPayload.length).toBeGreaterThan(0);
    const empty = await app.inject({ url: `/api/v1/analyses/${analysisId}/tiles/detections/2/0/0.mvt` });
    expect(empty.statusCode).toBe(200);
    expect(empty.rawPayload.length).toBe(0);
  }, 15000);

  it.each(['csv', 'geojson', 'parquet'] as const)('creates, processes and streams a real %s; deduplicates deliveries', async (format) => {
    const response = await app.inject({ method: 'POST', url: `/api/v1/analyses/${analysisId}/exports`,
      headers: { 'idempotency-key': randomUUID() }, payload: { format } });
    expect(response.statusCode).toBe(202);
    const id: string = response.json().data.job_id;
    const events = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM firebridge.outbox_events WHERE aggregate_id = ${id} AND event_type = 'export.requested'`;
    expect(Number(events[0].count)).toBe(1);
    await processExportJob(task(id));
    await processExportJob(task(id));
    const [job] = await prisma.$queryRaw<{ result_manifest_uri: string; attempt: number; status: string }[]>`
      SELECT result_manifest_uri, attempt, status FROM firebridge.api_jobs WHERE id = ${id}::uuid`;
    keys.push(job.result_manifest_uri);
    expect(job.attempt).toBe(1);
    expect(job.status).toBe('succeeded');
    const detail = await app.inject({ url: `/api/v1/jobs/${id}` });
    const file = await app.inject({ url: detail.json().data.download_url });
    expect(file.statusCode).toBe(200);
    if (format === 'csv') {
      expect(file.body.split('\r\n')).toHaveLength(rowCount + 2);
      expect(file.body).toContain('"\'=1+1"');
    } else if (format === 'geojson') {
      expect(file.json().features).toHaveLength(rowCount);
    } else {
      expect(file.rawPayload.subarray(0, 4).toString()).toBe('PAR1');
      expect(file.rawPayload.subarray(-4).toString()).toBe('PAR1');
    }
  }, 30000);

  it('serializes concurrent requests, enforces the global quota and keeps health responsive during exports', async () => {
    const input = { format: 'csv' as const, filters: {}, options: {} };
    const results = await Promise.allSettled([1, 2, 3].map(() => {
      const key = randomUUID();
      return exportsRepository.create(analysisId, input, key, key);
    }));
    const accepted = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    expect(accepted).toHaveLength(2);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.statusCode).toBe(429);
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
    const start = performance.now();
    try {
      const [health] = await Promise.all([
        app.inject({ url: '/api/v1/health/live' }),
        ...accepted.map((job) => processExportJob(task(job.id)))
      ]);
      expect(health.statusCode).toBe(200);
    } finally { clearInterval(timer); }
    for (const job of accepted) {
      const record = await exportsRepository.findById(job.id);
      keys.push(record!.result_manifest_uri!);
    }
    console.info(JSON.stringify({ benchmark: '2 concurrent database exports', rowsEach: rowCount,
      durationMs: performance.now() - start, rssDeltaBytes: peak - baseline }));
  }, 30000);

  it.each([false, true])('handles a real storage failure through BullMQ (permanent=%s)', async (permanent) => {
    const response = await app.inject({ method: 'POST', url: `/api/v1/analyses/${analysisId}/exports`,
      headers: { 'idempotency-key': randomUUID() }, payload: { format: 'csv' } });
    expect(response.statusCode).toBe(202);
    const apiId = response.json().data.job_id;
    const original = resultsConfig.EXPORT_STORAGE_DIR;
    expect(original).toContain('firebridge-exports-test-');
    const blocked = resolve(original, `owned-fault-${randomUUID()}`);
    await writeFile(blocked, 'Synthetic obstruction owned by this test only.', { flag: 'wx' });
    resultsConfig.EXPORT_STORAGE_DIR = blocked;
    const name = `phase4-fault-${randomUUID()}`;
    const queue = createFirebridgeQueue(name);
    const events = new QueueEvents(name, { connection: parseRedisConnection() });
    const errors: string[] = [];
    const worker = new Worker<ExportJobPayload>(name, async (job) => {
      try { await processExportJob(job); }
      catch (error) {
        // A genuine mkdir EEXIST error triggers the normal SQL and BullMQ retry
        // path. Remove only our obstruction to allow the next attempt to work.
        if (!permanent && job.attemptsMade === 0) await unlink(blocked);
        throw error;
      }
    }, { connection: parseRedisConnection(), concurrency: 1 });
    worker.on('error', (error) => { errors.push(error.name); });
    try {
      await events.waitUntilReady();
      const queued = await queue.add('export.requested', { job_id: apiId }, { attempts: 3, backoff: { type: 'fixed', delay: 50 } });
      if (permanent) await expect(queued.waitUntilFinished(events, 20000)).rejects.toThrow();
      else await queued.waitUntilFinished(events, 20000);
      const [record] = await prisma.$queryRaw<{ status: string; attempt: number; result_manifest_uri: string | null; progress: { rows?: number } }[]>`
        SELECT status,attempt,result_manifest_uri,progress FROM firebridge.api_jobs WHERE id = ${apiId}::uuid`;
      expect(record.status).toBe(permanent ? 'failed' : 'succeeded');
      expect(record.attempt).toBe(permanent ? 3 : 2);
      expect(errors).toEqual([]);
      if (permanent) expect(record.result_manifest_uri).toBeNull();
      else {
        expect(record.progress.rows).toBe(rowCount);
        await localExportStorage.remove(record.result_manifest_uri!);
      }
    } finally {
      await worker.close(); await events.close(); await queue.close();
      resultsConfig.EXPORT_STORAGE_DIR = original;
      const info = await stat(blocked);
      if (info.isDirectory()) await rmdir(blocked); else await unlink(blocked);
    }
  }, 30000);

  it('records EXPLAIN ANALYZE, spatial index availability and tile timing on test fixtures', async () => {
    const params = { id: analysisId, layer: 'detections' as const, z: 10, x: 513, y: 510 };
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
      return tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${detectionTileSql(params)}`);
    });
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'firebridge' AND tablename = 'detections'`;
    expect(indexes.some((index) => index.indexdef.includes('USING gist (geom)'))).toBe(true);
    const elapsed: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
        await tx.$queryRaw(detectionTileSql(params));
      });
      elapsed.push(performance.now() - start);
    }
    const directory = resolve(resultsConfig.EXPORT_STORAGE_DIR, 'metrics');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'phase4-postgis.json'), JSON.stringify({ rows: rowCount, plan, indexes, tileMs: elapsed }, null, 2));
    console.info(JSON.stringify({ benchmark: 'PostGIS tiles', rows: rowCount, tileMs: elapsed,
      spatialIndexInPlan: JSON.stringify(plan).includes('detections_geom_gist'), metricsDirectory: directory }));
  }, 30000);
});
