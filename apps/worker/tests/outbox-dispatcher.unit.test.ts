import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn() }));
vi.mock('@firebridge/database', () => ({ prisma: db }));
import { OutboxDispatcher } from '../src/services/outbox-dispatcher.js';
import { bullJobId, retryDelayMs, parseRedisConnection } from '../src/queues/firebridge-queue.js';
import { env } from '../src/config/env.js';

const id = '44444444-4444-4444-8444-444444444444';
const event = { id, event_type: 'export.requested', aggregate_id: id, payload: { job_id: id },
  dedupe_key: `export:${id}:created`, attempts: 1 };
const add = vi.fn();
const queue = { add } as unknown as Queue;
const dispatcher = () => new OutboxDispatcher({ queue, batchSize: 2 });

beforeEach(() => {
  vi.resetAllMocks();
  db.$queryRaw.mockResolvedValueOnce([event]).mockResolvedValue([]);
  db.$executeRaw.mockResolvedValue(1);
  add.mockResolvedValue({ id: bullJobId(event.dedupe_key) });
});

describe('Outbox delivery fencing and retries', () => {
  it('refuses an unscoped test queue so tests cannot steal business events', () => {
    expect(() => new OutboxDispatcher({ queue: { name: 'test-queue' } as Queue })).toThrow('explicit aggregate scope');
  });
  it('acknowledges only after Redis and preserves existing deterministic IDs', async () => {
    expect(await dispatcher().dispatchBatch()).toBe(1);
    expect(add).toHaveBeenCalledWith('export.requested', { job_id: id }, expect.objectContaining({
      jobId: `export__${id}__created`, attempts: 3, backoff: { type: 'exponential', delay: 1000, jitter: 0.5 }
    }));
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(db.$executeRaw.mock.invocationCallOrder[0]);
    const sql = String(db.$executeRaw.mock.calls[0][0]);
    expect(sql).toContain("status = 'dispatching' AND attempts =");
    expect(sql).toContain('lease_expires_at > now()');
    expect(String(db.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE SKIP LOCKED');
  });
  it('leaves an unavailable or ambiguously acknowledged enqueue retryable', async () => {
    add.mockRejectedValue(new Error('connection interrupted after commit'));
    const instance = dispatcher();
    expect(await instance.dispatchBatch()).toBe(0);
    expect(String(db.$executeRaw.mock.calls[0][0])).toContain("status = 'pending'");
    expect(instance.metrics.retries).toBe(1);
  });
  it('retries the same ID after a database failure following successful enqueue', async () => {
    db.$executeRaw.mockRejectedValueOnce(new Error('SQL acknowledgement lost')).mockResolvedValue(1);
    expect(await dispatcher().dispatchBatch()).toBe(0);
    expect(add).toHaveBeenCalledOnce();
    expect(String(db.$executeRaw.mock.calls[1][0])).toContain("status = 'pending'");
  });
  it('does not acknowledge a reclaimed lease', async () => {
    db.$executeRaw.mockResolvedValue(0);
    const instance = dispatcher();
    expect(await instance.dispatchBatch()).toBe(0);
    expect(instance.metrics.leaseLost).toBe(1);
  });
  it.each([
    { ...event, event_type: 'unknown' },
    { ...event, payload: { job_id: 'bad' } },
    { ...event, aggregate_id: 'unrelated' }
  ])('quarantines malformed or unsupported events', async (invalid) => {
    db.$queryRaw.mockReset().mockResolvedValueOnce([invalid]).mockResolvedValue([]);
    const instance = dispatcher();
    await instance.dispatchBatch();
    expect(add).not.toHaveBeenCalled();
    expect(instance.metrics.exhausted).toBe(1);
    expect(db.$executeRaw.mock.calls[0]).toContain(env.OUTBOX_MAX_ATTEMPTS);
  });
  it('bounds the final dispatch retry', async () => {
    db.$queryRaw.mockReset().mockResolvedValueOnce([{ ...event, attempts: env.OUTBOX_MAX_ATTEMPTS }]).mockResolvedValue([]);
    add.mockRejectedValue(new Error('offline'));
    const instance = dispatcher();
    await instance.dispatchBatch();
    expect(instance.metrics.exhausted).toBe(1);
  });
  it('shares an in-flight batch and waits for it during shutdown', async () => {
    let release!: () => void;
    add.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const instance = dispatcher();
    const first = instance.dispatchBatch();
    expect(instance.dispatchBatch()).toBe(first);
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    let stopped = false;
    const stop = instance.stop().then(() => { stopped = true; });
    expect(stopped).toBe(false);
    release();
    await stop;
    expect(await first).toBe(1);
  });
  it('caps exponential jitter and decodes Redis authentication/TLS/database without changing worker retry behavior', () => {
    for (const attempt of [1, 2, 10, 10000]) {
      const delay = retryDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(3600000);
    }
    expect(parseRedisConnection('rediss://user:p%40ss@example.test:6380/5')).toMatchObject({
      host: 'example.test', port: 6380, db: 5, username: 'user', password: 'p@ss', tls: {}, maxRetriesPerRequest: null
    });
  });
});
