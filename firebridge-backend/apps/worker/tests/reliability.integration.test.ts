/** Runs only against the explicit isolated *_test database and Redis DB 1–15. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { prisma } from '@firebridge/database';
import { Worker, type Job, type Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFirebridgeQueue, bullJobId, parseRedisConnection } from '../src/queues/firebridge-queue.js';
import { OutboxDispatcher } from '../src/services/outbox-dispatcher.js';
import { AnalysisRecovery } from '../src/services/analysis-recovery.js';
import { processAnalysisJob, type AnalysisJobPayload } from '../src/processors/analysis.processor.js';
import { workerAnalysesRepository, AnalysisLeaseLost, InvalidAnalysisTask } from '../src/repositories/analyses.repository.js';
import { collectWorkerMetrics } from '../src/services/worker-metrics.js';

const area = randomUUID();
const release = randomUUID();
const queue = createFirebridgeQueue(`reliability-${randomUUID()}`);
const cutoff = new Date(Date.now() - 3600000);
const queues: Queue[] = [queue];

beforeAll(async () => {
  await queue.waitUntilReady();
  await prisma.$executeRaw`INSERT INTO firebridge.areas(id,name,version,geom,geometry_sha256,display_timezone,provenance)
    VALUES (${area}::uuid,'Reliability fixture',${area},ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)),${area},'UTC','reliability-test')`;
  await prisma.$executeRaw`INSERT INTO firebridge.data_releases
    (id,name,status,stream,code_version,config,config_sha256,manifest_uri,dataset_kind,scope_key,observation_cutoff)
    VALUES (${release}::uuid,${release},'published','retrospective','test','{}',${release},'test://fixture','satellite','test',now())`;
  await prisma.$executeRaw`INSERT INTO firebridge.metric_definitions
    (id,version,unit,family,description,definition,requires_masks,requires_model)
    VALUES ('native_detections_v1','1','count','native_detections','test','{}',false,false) ON CONFLICT DO NOTHING`;
});
afterAll(async () => { await Promise.all(queues.map((q) => q.close())); await prisma.$disconnect(); });

async function fixture(eventStatus: 'pending' | 'delivered' | 'dispatching' = 'delivered') {
  const analysis = randomUUID();
  const id = randomUUID();
  const event = randomUUID();
  const payload: AnalysisJobPayload = { analysis_id: analysis, job_id: id, area_id: area,
    metric_key: 'native_detections_v1', start_date: '2026-01-01', end_date_exclusive: '2026-01-02' };
  const dedupe = `analysis:${analysis}:created`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO firebridge.analyses
      (id,area_id,release_id,start_date,end_date_exclusive,time_basis,metric_key,selection_policy,weighting_version,
        weather_policy,news_policy,request_spec,cache_key,status)
      VALUES (${analysis}::uuid,${area}::uuid,${release}::uuid,'2026-01-01','2026-01-02','utc',
        'native_detections_v1','standard','v1','{}','{}','{}',${analysis},'queued')`;
    await tx.$executeRaw`INSERT INTO firebridge.analysis_components(analysis_id,component,release_id,status)
      VALUES (${analysis}::uuid,'satellite',${release}::uuid,'ready'),(${analysis}::uuid,'reports',NULL,'missing')`;
    await tx.$executeRaw`INSERT INTO firebridge.api_jobs
      (id,kind,analysis_id,requested_by,request_hash,idempotency_key,request_spec,status,created_at)
      VALUES (${id}::uuid,'analysis',${analysis}::uuid,'reliability-test',${id},${id},'{}','queued',now()-interval '5 minutes')`;
    await tx.$executeRaw`INSERT INTO firebridge.outbox_events
      (id,event_type,aggregate_id,dedupe_key,payload,status,available_at,lease_expires_at)
      VALUES (${event}::uuid,'analysis.requested',${analysis},${dedupe},${JSON.stringify(payload)}::jsonb,
        ${eventStatus},now(),CASE WHEN ${eventStatus} = 'dispatching' THEN now()-interval '1 second' ELSE NULL END)`;
  });
  return { id, analysis, event, payload, dedupe, bullId: bullJobId(dedupe) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const task = (f: Fixture) => ({ data: f.payload, opts: { attempts: 3 }, attemptsMade: 0 }) as Job<AnalysisJobPayload>;
const dispatch = (f: Fixture, target = queue) => new OutboxDispatcher({ queue: target, batchSize: 1, aggregateIds: [f.analysis] });
async function state(f: Fixture) {
  const [row] = await prisma.$queryRaw<{ status: string; attempt: number; analysis_status: string;
    progress: { recovery?: { reason: string; action: string } }; completed_at: Date | null }[]>`
    SELECT j.status,j.attempt,j.progress,j.completed_at,a.status AS analysis_status FROM firebridge.api_jobs j
    JOIN firebridge.analyses a ON a.id=j.analysis_id WHERE j.id=${f.id}::uuid`;
  return row;
}

describe('Reliability with real PostgreSQL and Redis', () => {
  it('concurrent dispatchers enqueue one deterministic job', async () => {
    const f = await fixture('pending');
    const results = await Promise.all([dispatch(f).dispatchBatch(), dispatch(f).dispatchBatch()]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await queue.getJob(f.bullId))?.data).toEqual(f.payload);
    const [event] = await prisma.$queryRaw<{ attempts: number; status: string }[]>`
      SELECT attempts,status FROM firebridge.outbox_events WHERE id=${f.event}::uuid`;
    expect(event).toEqual({ attempts: 1, status: 'delivered' });
  });
  it('recovers an expired dispatch lease', async () => {
    const f = await fixture('dispatching');
    expect(await dispatch(f).dispatchBatch()).toBe(1);
    expect(await queue.getJob(f.bullId)).toBeDefined();
  });
  it('keeps a real refused Redis connection retryable with a bounded command wait', async () => {
    const f = await fixture('pending');
    const offline = createFirebridgeQueue(`offline-${randomUUID()}`, 'redis://127.0.0.1:1/15', {
      connection: { host: '127.0.0.1', port: 1, db: 15, maxRetriesPerRequest: 1,
        enableOfflineQueue: false, commandTimeout: 500, connectTimeout: 500, retryStrategy: () => null }
    });
    offline.on('error', () => undefined);
    try {
      expect(await dispatch(f, offline).dispatchBatch()).toBe(0);
      const [row] = await prisma.$queryRaw<{ status: string; attempts: number }[]>`
        SELECT status,attempts FROM firebridge.outbox_events WHERE id=${f.event}::uuid`;
      expect(row).toEqual({ status: 'pending', attempts: 1 });
    } finally { await offline.close(); }
  });
  it('fences a late acknowledgement after a second dispatcher reclaims the lease', async () => {
    const f = await fixture('pending');
    let releaseAdd!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseAdd = resolve; });
    const delayedQueue = { add: async (...args: Parameters<Queue['add']>) => {
      entered(); await gate; return queue.add(...args);
    } } as unknown as Queue;
    const old = dispatch(f, delayedQueue);
    const pending = old.dispatchBatch();
    await waiting;
    await prisma.$executeRaw`UPDATE firebridge.outbox_events SET lease_expires_at=now()-interval '1 second' WHERE id=${f.event}::uuid`;
    expect(await dispatch(f).dispatchBatch()).toBe(1);
    releaseAdd();
    expect(await pending).toBe(0);
    expect(old.metrics.leaseLost).toBe(1);
  });
  it('converges after a lost acknowledgement following real Redis enqueue', async () => {
    const f = await fixture('pending');
    const ambiguous = { add: async (...args: Parameters<Queue['add']>) => {
      await queue.add(...args); throw new Error('injected lost enqueue acknowledgement');
    } } as unknown as Queue;
    expect(await dispatch(f, ambiguous).dispatchBatch()).toBe(0);
    await prisma.$executeRaw`UPDATE firebridge.outbox_events SET available_at=now() WHERE id=${f.event}::uuid`;
    expect(await dispatch(f).dispatchBatch()).toBe(1);
    expect((await queue.getJob(f.bullId))?.id).toBe(f.bullId);
  });
  it('concurrent duplicate executions increment the durable attempt only once', async () => {
    const f = await fixture();
    const job = { ...task(f), token: 'lock', moveToDelayed: vi.fn().mockResolvedValue(undefined) } as unknown as Job<AnalysisJobPayload>;
    await Promise.allSettled([processAnalysisJob(job), processAnalysisJob(job)]);
    expect(await state(f)).toMatchObject({ status: 'partial', analysis_status: 'partial', attempt: 1 });
    await processAnalysisJob(job);
    expect((await state(f)).attempt).toBe(1);
  });
  it('completes ready analyses only when all components are ready', async () => {
    const f = await fixture();
    await prisma.$executeRaw`UPDATE firebridge.analysis_components SET status='ready',release_id=${release}::uuid
      WHERE analysis_id=${f.analysis}::uuid AND component='reports'`;
    await processAnalysisJob(task(f));
    expect(await state(f)).toMatchObject({ status: 'succeeded', analysis_status: 'ready', attempt: 1 });
  });
  it('fails both durable records when the required satellite component is missing', async () => {
    const f = await fixture();
    await prisma.$executeRaw`UPDATE firebridge.analysis_components SET status='missing',release_id=NULL
      WHERE analysis_id=${f.analysis}::uuid AND component='satellite'`;
    await expect(processAnalysisJob(task(f))).rejects.toThrow();
    expect(await state(f)).toMatchObject({ status: 'failed', analysis_status: 'failed', attempt: 1 });
  });
  it('rejects a payload bound to a different area without touching the durable job', async () => {
    const f = await fixture();
    await expect(workerAnalysesRepository.claim({ ...f.payload, area_id: randomUUID() })).rejects.toBeInstanceOf(InvalidAnalysisTask);
    expect(await state(f)).toMatchObject({ status: 'queued', analysis_status: 'queued', attempt: 0 });
  });
  it('fences stale attempts and survives a failed attempt followed by retry', async () => {
    const f = await fixture();
    const first = await workerAnalysesRepository.claim(f.payload);
    expect(first.kind).toBe('claimed');
    if (first.kind !== 'claimed') throw new Error('claim missing');
    await workerAnalysesRepository.fail(f.payload, first.claim, false);
    const second = await workerAnalysesRepository.claim(f.payload);
    if (second.kind !== 'claimed') throw new Error('retry missing');
    await expect(workerAnalysesRepository.complete(f.payload, first.claim)).rejects.toBeInstanceOf(AnalysisLeaseLost);
    await workerAnalysesRepository.complete(f.payload, second.claim);
    await workerAnalysesRepository.fail(f.payload, second.claim, true);
    expect(await state(f)).toMatchObject({ status: 'partial', analysis_status: 'partial', attempt: 2 });
  });
  it('repairs legacy split finalization without re-executing a completed analysis', async () => {
    const f = await fixture();
    await prisma.$executeRaw`UPDATE firebridge.analyses SET status='ready',completed_at=now() WHERE id=${f.analysis}::uuid`;
    await processAnalysisJob(task(f));
    expect(await state(f)).toMatchObject({ status: 'succeeded', analysis_status: 'ready', attempt: 0 });
  });
  it('coordinates concurrent missing-job recovery and leaves terminal jobs with removed Redis records untouched', async () => {
    const f = await fixture();
    await Promise.all([new AnalysisRecovery(queue, cutoff, [f.analysis]).reconcile(), new AnalysisRecovery(queue, cutoff, [f.analysis]).reconcile()]);
    expect(await queue.getJob(f.bullId)).toBeDefined();
    expect((await state(f)).progress.recovery?.action).toBe('reenqueued');
    const done = await fixture();
    await processAnalysisJob(task(done));
    await new AnalysisRecovery(queue, cutoff, [done.analysis]).reconcile();
    expect(await queue.getJob(done.bullId)).toBeUndefined();
    expect((await state(done)).attempt).toBe(1);
  });
  it('recovers abandoned running jobs and never selects records before the cutoff', async () => {
    const f = await fixture();
    await workerAnalysesRepository.claim(f.payload);
    await prisma.$executeRaw`UPDATE firebridge.api_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=${f.id}::uuid`;
    const historical = await fixture();
    await prisma.$executeRaw`UPDATE firebridge.api_jobs SET created_at=now()-interval '2 days' WHERE id=${historical.id}::uuid`;
    await new AnalysisRecovery(queue, cutoff, [f.analysis, historical.analysis]).reconcile();
    expect(await queue.getJob(f.bullId)).toBeDefined();
    expect(await state(f)).toMatchObject({ status: 'queued', attempt: 1 });
    expect(await queue.getJob(historical.bullId)).toBeUndefined();
  });
  it('keeps an idle worker alive, then recovers a real process crash through BullMQ stalled handling', async () => {
    const f = await fixture();
    const dedicated = createFirebridgeQueue(`crash-${randomUUID()}`);
    queues.push(dedicated);
    await dedicated.waitUntilReady();
    const script = `import { Worker } from 'bullmq';
      import { workerAnalysesRepository } from './dist/repositories/analyses.repository.js';
      import { parseRedisConnection } from './dist/queues/firebridge-queue.js';
      const w = new Worker(process.argv[1], async job => {
        await workerAnalysesRepository.claim(job.data); console.log('CLAIMED');
        await new Promise(() => {});
      }, { connection: parseRedisConnection(), lockDuration: 1000, stalledInterval: 1000 });
      w.on('ready', () => console.log('READY')); w.on('error', () => {});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, dedicated.name], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    let replacement: Worker | undefined;
    try {
      await vi.waitFor(() => expect(output).toContain('READY'), { timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(child.exitCode).toBeNull();
      await dedicated.add('analysis.requested', f.payload, { jobId: f.bullId, attempts: 3 });
      await vi.waitFor(() => expect(output).toContain('CLAIMED'), { timeout: 5000 });
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
      await prisma.$executeRaw`UPDATE firebridge.api_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=${f.id}::uuid`;
      replacement = new Worker(dedicated.name, processAnalysisJob,
        { connection: parseRedisConnection(), lockDuration: 1000, stalledInterval: 1000 });
      replacement.on('error', () => undefined);
      await vi.waitFor(async () => expect(await state(f)).toMatchObject({ status: 'partial', attempt: 2 }), { timeout: 10000 });
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); await replacement?.close(); }
  }, 25000);
  it('reports bounded real dependency and queue metrics', async () => {
    const metrics = await collectWorkerMetrics(queue, queue);
    expect(metrics.databaseAvailable).toBe(true);
    expect(metrics.redisAvailable).toBe(true);
    expect(metrics.analysisQueue).toHaveProperty('waiting');
  });
});
