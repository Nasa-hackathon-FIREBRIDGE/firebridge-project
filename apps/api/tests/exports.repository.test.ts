import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), execute: vi.fn(), context: vi.fn() }));
vi.mock('@firebridge/database', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@firebridge/results', async (original) => ({
  ...await original<typeof import('@firebridge/results')>(), findResultContext: mocks.context
}));
import { exportsRepository } from '../src/repositories/exports.repository.js';

const id = '33333333-3333-4333-8333-333333333333';
const input = { format: 'csv' as const, filters: {}, options: {} };
beforeEach(() => {
  mocks.transaction.mockImplementation((callback) => callback({ $executeRaw: mocks.execute, $queryRaw: mocks.query }));
  mocks.execute.mockResolvedValue(1);
  mocks.context.mockResolvedValue({ status: 'ready', component_status: 'ready',
    release_status: 'published', time_basis: 'utc', metric_key: 'native_detections_v1', selection_policy: 'standard', grid_id: null });
});
afterEach(() => vi.resetAllMocks());

describe('Export job and transactional outbox', () => {
  it('creates job and event on the same transaction client after taking a global quota lock', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ active: 0n, recent: 0n }])
      .mockResolvedValueOnce([{ id, analysis_id: id, status: 'queued' }]);
    expect((await exportsRepository.create(id, input, 'hash', 'key')).id).toBe(id);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(String(mocks.execute.mock.calls[0][0])).toContain('pg_advisory_xact_lock');
    expect(String(mocks.query.mock.calls[2][0])).toContain('INSERT INTO firebridge.api_jobs');
    expect(String(mocks.execute.mock.calls[1][0])).toContain('INSERT INTO firebridge.outbox_events');
  });
  it('propagates an outbox insert failure so PostgreSQL rolls back the job', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ active: 0n, recent: 0n }])
      .mockResolvedValueOnce([{ id }]);
    mocks.execute.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('outbox failed'));
    await expect(exportsRepository.create(id, input, 'hash', 'key')).rejects.toThrow('outbox failed');
  });
  it('recovers the durable idempotent job after Redis replay state is lost', async () => {
    mocks.query.mockResolvedValueOnce([{ id, request_hash: 'same' }]);
    expect((await exportsRepository.create(id, input, 'same', 'key')).id).toBe(id);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it('rejects a durable idempotency key reused for different input', async () => {
    mocks.query.mockResolvedValueOnce([{ id, request_hash: 'different' }]);
    await expect(exportsRepository.create(id, input, 'hash', 'key')).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each([{ active: 2n, recent: 2n }, { active: 0n, recent: 10n }])('enforces quota before insertion', async (quota) => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([quota]);
    await expect(exportsRepository.create(id, input, 'hash', 'key')).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
