import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@firebridge/database', () => ({ prisma: db }));
import { AnalysisRecovery } from '../src/services/analysis-recovery.js';
import { env } from '../src/config/env.js';

const id = '44444444-4444-4444-8444-444444444444';
const candidate = { id, analysis_id: id };
const payload = { analysis_id: id, job_id: id, area_id: id, metric_key: 'native_detections_v1',
  start_date: '2026-01-01', end_date_exclusive: '2026-01-02' };
const event = { dedupe_key: `analysis:${id}:created`, payload, status: 'delivered' };
const getJob = vi.fn();
const add = vi.fn();
const retry = vi.fn();
const queue = { getJob, add } as unknown as Queue;
const recovery = () => new AnalysisRecovery(queue, new Date('2026-11-01T00:00:00Z'));
const records = (status = 'queued', attempt = 0, changedEvent: unknown = event) => {
  db.$queryRaw.mockReset().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([{ id }])
    .mockResolvedValueOnce([{ status, attempt, recovery_attempts: 0 }]).mockResolvedValueOnce([changedEvent]);
};
const metadata = () => db.$executeRaw.mock.calls.flat().find((v) => typeof v === 'string' && v.startsWith('{'));

beforeEach(() => {
  vi.resetAllMocks();
  records();
  db.$transaction.mockImplementation((fn) => fn(db));
  db.$executeRaw.mockResolvedValue(1);
  getJob.mockResolvedValue(undefined);
  add.mockResolvedValue({ id });
  retry.mockResolvedValue(undefined);
});

describe('Analysis reconciliation', () => {
  it('re-enqueues missing work under SQL locks using the original deterministic ID', async () => {
    expect(await recovery().reconcile()).toBe(1);
    expect(add).toHaveBeenCalledWith('analysis.requested', payload, expect.objectContaining({ jobId: `analysis__${id}__created` }));
    expect(String(db.$queryRaw.mock.calls[1][0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(String(db.$queryRaw.mock.calls[2][0])).toContain('FOR UPDATE OF j SKIP LOCKED');
    expect(JSON.parse(metadata())).toMatchObject({ action: 'reenqueued', attempts: 1 });
  });
  it('recovers an abandoned running lease without resetting the durable processing attempt', async () => {
    records('running', 1);
    expect(await recovery().reconcile()).toBe(1);
    expect(JSON.parse(metadata())).toMatchObject({ reason: 'expired_processing_lease' });
    expect(String(db.$executeRaw.mock.calls)).not.toContain('attempt = 0');
  });
  it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])('leaves %s Redis work alone', async (state) => {
    getJob.mockResolvedValue({ getState: async () => state });
    expect(await recovery().reconcile()).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(JSON.parse(metadata())).toMatchObject({ reason: 'queue_present', attempts: 0 });
  });
  it('quarantines completed Redis work with nonterminal SQL instead of blindly replaying it', async () => {
    getJob.mockResolvedValue({ getState: async () => 'completed' });
    expect(await recovery().reconcile()).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(JSON.parse(metadata())).toMatchObject({ reason: 'redis_completed_database_nonterminal', attempts: env.RECOVERY_MAX_ATTEMPTS });
  });
  it('retries retained failed Redis records without creating another ID', async () => {
    getJob.mockResolvedValue({ getState: async () => 'failed', retry });
    expect(await recovery().reconcile()).toBe(1);
    expect(retry).toHaveBeenCalledWith('failed');
    expect(add).not.toHaveBeenCalled();
  });
  it('records ambiguous enqueue outcomes with a bounded backoff', async () => {
    add.mockRejectedValue(new Error('acknowledgement lost'));
    expect(await recovery().reconcile()).toBe(0);
    expect(JSON.parse(metadata())).toMatchObject({ reason: 'redis_outcome_unacknowledged', action: 'retry_scheduled', attempts: 1 });
  });
  it('quarantines exhausted business attempts', async () => {
    records('running', env.ANALYSIS_MAX_ATTEMPTS);
    expect(await recovery().reconcile()).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(JSON.parse(metadata())).toMatchObject({ reason: 'processing_attempts_exhausted' });
  });
  it('skips records locked by another recovery owner', async () => {
    db.$queryRaw.mockReset().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]);
    expect(await recovery().reconcile()).toBe(0);
    expect(getJob).not.toHaveBeenCalled();
  });
  it('rechecks eligibility after taking locks', async () => {
    db.$queryRaw.mockReset().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]);
    expect(await recovery().reconcile()).toBe(0);
    expect(getJob).not.toHaveBeenCalled();
  });
  it('filters terminal results, recent jobs, live leases, retry limits and records before the cutoff', async () => {
    db.$queryRaw.mockReset().mockResolvedValue([]);
    await recovery().reconcile();
    const sql = db.$queryRaw.mock.calls[0][1];
    expect(sql.sql).toContain('j.completed_at IS NULL AND a.completed_at IS NULL');
    expect(sql.sql).toContain('j.created_at >=');
    expect(sql.sql).toContain('j.lease_expires_at <= now()');
    expect(sql.values).toContainEqual(new Date('2026-11-01T00:00:00Z'));
    expect(add).not.toHaveBeenCalled();
  });
});
