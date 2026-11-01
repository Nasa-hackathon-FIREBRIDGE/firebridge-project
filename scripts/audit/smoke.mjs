import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { verifyMvt, verifyExportRows, parseCsv } from '../phase4/verify.mjs';
import { auditDirectory } from './process.mjs';
import { sourceInput } from '../phase4/fixture.mjs';

const emptyId = '00000000-0000-4000-8000-000000000001';
export async function smoke({ baseUrl = 'http://127.0.0.1:3104/api/v1', databaseUrl, redisUrl, exportRun }) {
  const base = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost'].includes(base.hostname) || !new URL(databaseUrl).pathname.endsWith('_test') || new URL(redisUrl).pathname !== '/15') {
    throw new Error('Smoke tests require loopback HTTP, an isolated *_test database and Redis DB 15.');
  }
  const manifest = JSON.parse(await readFile(resolve(auditDirectory, '../phase4-rif-v1/firebridge_phase4_test/manifest.json')));
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2500 });
  redis.on('error', () => undefined);
  const redisAddress = new URL(redisUrl);
  const queue = new Queue('firebridge-exports', { connection: {
    host: redisAddress.hostname, port: Number(redisAddress.port) || 6379, db: 15,
    username: redisAddress.username ? decodeURIComponent(redisAddress.username) : undefined,
    password: redisAddress.password ? decodeURIComponent(redisAddress.password) : undefined
  } });
  const results = [];
  const files = resolve(auditDirectory, 'http'); await mkdir(files, { recursive: true });
  const id = manifest.analysis_id;
  async function request(label, method, path, expected, { body, extraHeaders = {}, validate, sideEffect = 'read-only' } = {}) {
    const started = performance.now();
    let response, buffer;
    // Respect the actual limiter. A retry waits rather than changing security
    // settings. Repository quota errors have no Retry-After and remain final.
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(`${baseUrl}${path}`, { method, headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      buffer = Buffer.from(await response.arrayBuffer());
      if (response.status !== 429 || !response.headers.has('retry-after') || (expected === 429 && label !== 'Export active quota')) break;
      console.info(`Rate limiter active during ${label}; waiting before retry without changing limits.`);
      const until = Date.now() + Math.min(60, Number(response.headers.get('retry-after')) || 60) * 1000;
      while (Date.now() < until) await delay(Math.min(1000, until - Date.now()));
    }
    let json;
    try { if (response.headers.get('content-type')?.includes('json')) json = JSON.parse(buffer.toString()); } catch { /* assertion below reports invalid JSON */ }
    const record = { label, endpoint: path, method, expected, actual: response.status,
      contentType: response.headers.get('content-type'), durationMs: Number((performance.now() - started).toFixed(2)),
      response: json ? { status: json.status, code: json.code, message: json.message } : { bytes: buffer.length },
      sideEffect, result: 'PASS' };
    const value = { response, buffer, json };
    try { assert.equal(response.status, expected); await validate?.(value, record); }
    catch (error) { record.result = 'FAIL'; record.error = error.message; }
    results.push(record);
    console.info(`${record.result} ${label}: HTTP ${response.status}`);
    return value;
  }
  async function jobEffects(jobId) {
    const job = await db.api_jobs.findUnique({ where: { id: jobId } });
    assert.equal(job?.requested_by, 'anonymous');
    const event = await db.$queryRaw`SELECT payload FROM firebridge.outbox_events WHERE dedupe_key = ${`export:${jobId}:created`}`;
    assert.equal(event.length, 1); assert.equal(event[0].payload.job_id, jobId);
    return job;
  }
  async function waitJob(jobId, statuses = ['succeeded']) {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const job = await db.api_jobs.findUnique({ where: { id: jobId } });
      if (statuses.includes(job?.status)) return job;
      if (job?.status === 'failed') throw new Error(`Worker failed for fixture job ${jobId}`);
      await delay(100);
    }
    throw new Error(`Worker timeout for fixture job ${jobId}`);
  }
  try {
    // The isolated database/Redis guards above and this resource probe remain in place.
    const probe = await fetch(`${baseUrl}/analyses/${id}`);
    assert.equal(probe.status, 200, 'Target must contain the isolated fixture before smoke writes.');
    assert.equal((await probe.json()).data.id, id);
    await request('Liveness', 'GET', '/health/live', 200, { validate: ({ json }) => assert.equal(json.status, 'ok') });
    await request('Readiness', 'GET', '/health/ready', 200, { validate: ({ json }) => {
      assert.equal(json.checks.database, 'ready'); assert.equal(json.checks.redis, 'ready');
    } });
    await request('Sources list', 'GET', '/sources?limit=1', 200, { validate: ({ json }) => assert.ok(json.data.sources.length) });
    await request('Areas list', 'GET', '/areas?limit=1', 200, { validate: ({ json }) => assert.ok(json.data.areas.length) });
    await request('Area detail', 'GET', `/areas/${manifest.area_id}`, 200, { validate: ({ json }) => assert.equal(json.data.id, manifest.area_id) });
    await request('Analysis list', 'GET', '/analyses?limit=1', 200, { validate: ({ json }) => assert.ok(json.data.analyses.length) });
    await request('Analysis detail', 'GET', `/analyses/${id}`, 200, { validate: ({ json }) => {
      assert.equal(json.data.id, id); assert.ok(['ready', 'partial'].includes(json.data.status)); assert.ok(json.data.completed_at);
    } });
    await request('Jobs list', 'GET', '/jobs?limit=1', 200, { validate: ({ json }) => {
      assert.equal(json.data.jobs.length, 1); assert.ok(json.data.nextCursor); assert.ok(!JSON.stringify(json).includes('result_manifest_uri'));
    } });
    await request('Job detail', 'GET', `/jobs/${manifest.analysis_job_id}`, 200, { validate: ({ json }) => assert.equal(json.data.id, manifest.analysis_job_id) });

    // Inspect the exact cache namespace for this owned fixture, without FLUSHDB.
    const [context] = await db.$queryRaw`SELECT a.cache_key,a.completed_at,a.status,c.release_id::text
      FROM firebridge.analyses a JOIN firebridge.analysis_components c ON c.analysis_id=a.id AND c.component='satellite' WHERE a.id=${id}::uuid`;
    const version = createHash('sha256').update(JSON.stringify([context.cache_key, context.release_id, context.completed_at, context.status])).digest('hex');
    const cacheKey = `phase4:tile:v1:${id}:${version}:detections:0:0:0`;
    await redis.del(cacheKey);
    const tilePath = `/analyses/${id}/tiles/detections/0/0/0.mvt`;
    let firstTile;
    await request('MVT populated / cache miss', 'GET', tilePath, 200, { validate: ({ response, buffer }, record) => {
      assert.equal(response.headers.get('content-type'), 'application/vnd.mapbox-vector-tile');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-tile-cache'), 'MISS');
      assert.equal(verifyMvt(buffer, { z: 0, x: 0, y: 0 }).detections, 256);
      firstTile = buffer; record.sideEffect = 'owned Redis tile entry created; decoded 256 detections';
    } });
    assert.ok(await redis.exists(cacheKey));
    await request('MVT cache hit', 'GET', tilePath, 200, { validate: ({ response, buffer }) => {
      assert.equal(response.headers.get('x-tile-cache'), 'HIT'); assert.deepEqual(buffer, firstTile);
    } });
    for (const [x, y] of [[123, 101], [124, 100], [124, 101], [125, 101]]) {
      await request(`MVT zoom 8 ${x}/${y}`, 'GET', `/analyses/${id}/tiles/detections/8/${x}/${y}.mvt`, 200,
        { validate: ({ buffer }) => assert.equal(verifyMvt(buffer, { z: 8, x, y }).detections, 64) });
    }
    await request('MVT empty', 'GET', `/analyses/${id}/tiles/detections/8/0/0.mvt`, 200,
      { validate: ({ buffer }) => assert.equal(verifyMvt(buffer, { z: 8, x: 0, y: 0 }).detections, 0) });

    const exports = {};
    for (const format of ['csv', 'geojson', 'parquet']) {
      const created = await request(`Export ${format}`, 'POST', `/analyses/${id}/exports`, 202, {
        body: { format, filters: {}, options: {} }, extraHeaders: { 'idempotency-key': `phase4-rif-v1:${exportRun}:${format}` },
        validate: async ({ json }, record) => { const job = await jobEffects(json.data.job_id); assert.equal(job.kind, 'export');
          record.sideEffect = 'same transactional job/outbox as the seeded request; no duplicate'; }
      });
      const job = await waitJob(created.json.data.job_id); exports[format] = job;
      await request(`Download ${format}`, 'GET', `/jobs/${job.id}/download`, 200, { validate: async ({ response, buffer }, record) => {
        assert.equal(BigInt(buffer.length), job.result_byte_size);
        assert.equal(createHash('sha256').update(buffer).digest('hex'), job.result_sha256);
        assert.ok(response.headers.get('content-disposition').includes(`firebridge-${job.id}.${format}`));
        const expectedMime = { csv: 'text/csv', geojson: 'application/geo+json', parquet: 'application/vnd.apache.parquet' }[format];
        assert.ok(response.headers.get('content-type').startsWith(expectedMime));
        await writeFile(resolve(files, `export.${format}`), buffer);
        let rows;
        if (format === 'csv') { const [header, ...values] = parseCsv(buffer.toString()); rows = values.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i]]))); }
        else if (format === 'geojson') rows = JSON.parse(buffer).features.map((feature) => ({ ...feature.properties, id: feature.id,
          longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] }));
        else {
          const { ParquetReader } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('parquetjs-lite');
          const reader = await ParquetReader.openBuffer(buffer); rows = [];
          try { const cursor = reader.getCursor(); for (let row = await cursor.next(); row; row = await cursor.next()) rows.push(row); }
          finally { await reader.close(); }
        }
        assert.equal(verifyExportRows(rows, manifest, format).verified_rows, 256);
        record.sideEffect = 'downloaded file SHA-256/length verified against SQL; 256 complete rows validated';
      } });
    }
    await request('Repeated export idempotency key', 'POST', `/analyses/${id}/exports`, 202, {
      body: { format: 'csv', filters: {}, options: {} }, extraHeaders: { 'idempotency-key': `phase4-rif-v1:${exportRun}:csv` },
      validate: ({ json }) => assert.equal(json.data.job_id, exports.csv.id), sideEffect: 'same job; no duplicate'
    });
    await request('Idempotency conflict', 'POST', `/analyses/${id}/exports`, 409, {
      body: { format: 'geojson' }, extraHeaders: { 'idempotency-key': `phase4-rif-v1:${exportRun}:csv` },
      validate: ({ json }) => assert.equal(json.code, 'IDEMPOTENCY_CONFLICT')
    });
    await request('Missing Idempotency-Key', 'POST', `/analyses/${id}/exports`, 400, { body: { format: 'csv' },
      validate: ({ json }) => assert.equal(json.code, 'MISSING_IDEMPOTENCY_KEY') });
    await request('Invalid export format', 'POST', `/analyses/${id}/exports`, 400, { body: { format: 'pdf' }, extraHeaders: { 'idempotency-key': `bad-${exportRun}` } });

    await request('Source creation', 'POST', '/sources', 201, {
      body: { ...sourceInput, name: 'PHASE4 HTTP synthetic source', metadata: { phase4_fixture: 'phase4-http-smoke', synthetic: true } },
      extraHeaders: { 'idempotency-key': 'phase4-http-source-v1' }, sideEffect: 'synthetic source created or idempotently replayed',
      validate: async ({ json }) => assert.equal((await db.source.findUnique({ where: { id: json.data.id } })).metadata.phase4_fixture, 'phase4-http-smoke')
    });
    const existingArea = await db.areas.findFirst({ where: { version: 'phase4-http-v1', provenance: 'phase4-http-smoke' }, select: { id: true } });
    const area = await request('Area creation/reuse', 'POST', '/areas', existingArea ? 200 : 201, {
      body: { ...manifest.area, name: 'PHASE4 HTTP synthetic AOI', version: 'phase4-http-v1', provenance: 'phase4-http-smoke' },
      sideEffect: existingArea ? 'same immutable AOI reused' : 'synthetic AOI created',
      validate: async ({ json }) => assert.equal((await db.areas.findUnique({ where: { id: json.data.id } })).version, 'phase4-http-v1')
    });
    const existingAnalysis = await db.analyses.findFirst({ where: { area_id: area.json.data.id,
      api_jobs: { some: { kind: 'analysis', requested_by: 'anonymous' } } }, select: { id: true } });
    const analysis = await request('Analysis creation/reuse', 'POST', '/analyses', existingAnalysis ? 200 : 202, {
      body: { area_id: area.json.data.id, start_date: manifest.start_date, end_date_exclusive: manifest.end_date_exclusive, time_basis: 'utc' },
      extraHeaders: { 'idempotency-key': 'phase4-http-analysis-v1' },
      validate: async ({ json }, record) => {
        const job = await db.api_jobs.findUnique({ where: { id: json.data.job_id } });
        assert.equal(job.analysis_id, json.data.id); assert.equal(job.requested_by, 'anonymous');
        const events = await db.$queryRaw`SELECT payload FROM firebridge.outbox_events WHERE dedupe_key=${`analysis:${json.data.id}:created`}`;
        assert.equal(events.length, 1); assert.equal(events[0].payload.job_id, job.id);
        record.sideEffect = 'owned analysis, job and original outbox event verified in SQL';
      }
    });
    await waitJob(analysis.json.data.job_id, ['succeeded', 'partial']);
    const beforeInvalid = await Promise.all([db.source.count(), db.areas.count(), db.analyses.count()]);
    for (const path of ['/sources', '/areas', '/analyses']) await request(`Invalid body ${path}`, 'POST', path, 400,
      { body: { unexpected: true }, validate: ({ json }) => assert.equal(json.status, 'error'), sideEffect: 'rejected without a new business record' });
    assert.deepEqual(await Promise.all([db.source.count(), db.areas.count(), db.analyses.count()]), beforeInvalid);

    for (const [label, path, expected] of [
      ['Missing analysis', `/analyses/${emptyId}`, 404], ['Missing job', `/jobs/${emptyId}`, 404],
      ['Missing download', `/jobs/${emptyId}/download`, 404], ['Invalid analysis UUID', '/analyses/not-a-uuid', 400],
      ['Invalid job UUID', '/jobs/not-a-uuid', 400], ['Invalid tile UUID', '/analyses/not-a-uuid/tiles/detections/0/0/0.mvt', 400],
      ['Invalid zoom', `/analyses/${id}/tiles/detections/19/0/0.mvt`, 400],
      ['Invalid x', `/analyses/${id}/tiles/detections/8/256/0.mvt`, 400],
      ['Invalid y', `/analyses/${id}/tiles/detections/8/0/256.mvt`, 400],
      ['Unknown layer', `/analyses/${id}/tiles/sql/0/0/0.mvt`, 400],
      ['Invalid jobs query', '/jobs?limit=0', 400], ['Invalid analysis query', '/analyses?limit=0', 400],
      ['Missing area', `/areas/${emptyId}`, 404], ['Invalid area UUID', '/areas/not-a-uuid', 400],
      ['Invalid areas query', '/areas?limit=0', 400], ['Invalid source query', '/sources?limit=0', 400]
    ]) await request(label, 'GET', path, expected, { validate: ({ json }) => assert.equal(json.status, 'error') });

    await queue.pause();
    try {
      const pending = await request('Queue export while export worker paused', 'POST', `/analyses/${id}/exports`, 202,
        { body: { format: 'csv' }, extraHeaders: { 'idempotency-key': `pending-${exportRun}` }, sideEffect: 'new queued export and outbox' });
      await request('Pending download', 'GET', `/jobs/${pending.json.data.job_id}/download`, 409);
      await request('Second active export', 'POST', `/analyses/${id}/exports`, 202,
        { body: { format: 'geojson' }, extraHeaders: { 'idempotency-key': `pending-2-${exportRun}` }, sideEffect: 'second active export and outbox' });
      await request('Export active quota', 'POST', `/analyses/${id}/exports`, 429,
        { body: { format: 'parquet' }, extraHeaders: { 'idempotency-key': `over-quota-${exportRun}` }, validate: ({ json }) => assert.equal(json.message, 'Export quota exceeded.') });
    } finally { await queue.resume(); }

    // Cover every registered planned endpoint with its honest 501 response.
    const schema = await (await fetch(`${base.origin}/api-docs/json`)).json();
    await writeFile(resolve(auditDirectory, 'openapi.json'), JSON.stringify(schema, null, 2));
    for (const [path, operations] of Object.entries(schema.paths)) {
      if (!/^\/api\/v1\/(catalog|releases|updates|detections|tiles|cells|weather|reports|provenance|explanations|exports|admin)(\/|$)/.test(path)) continue;
      for (const method of ['get', 'post']) if (method in operations) {
        await request(`Planned ${method.toUpperCase()} ${path}`, method.toUpperCase(), path.replace('/api/v1', '').replace(/\{[^}]+\}/g, emptyId), 501,
          { ...(method === 'post' ? { body: {} } : {}), validate: ({ json }) => assert.equal(json.status, 'planned') });
      }
    }
    // Expire naturally according to the real test worker's retention setting.
    const expires = exports.csv.expires_at.getTime();
    if (expires - Date.now() > 181000) throw new Error('Expiry test requires the dedicated worker retention of 180 seconds.');
    console.info('Waiting for actual fixture export expiry; no SQL expiry fields are changed.');
    while (Date.now() <= expires + 500) await delay(Math.min(1000, expires + 501 - Date.now()));
    await request('Expired download', 'GET', `/jobs/${exports.csv.id}/download`, 410);
    return results;
  } finally {
    await queue.resume().catch(() => undefined); await queue.close(); redis.disconnect(); await db.$disconnect();
    await writeFile(resolve(auditDirectory, 'http-results.json'), JSON.stringify(results, null, 2));
  }
}
