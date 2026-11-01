import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), remove: vi.fn() }));
vi.mock('@firebridge/database', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute } }));
vi.mock('@firebridge/results/storage', () => ({ localExportStorage: { remove: mocks.remove } }));
import { cleanupExports } from '../src/services/export-cleanup.js';
import { workerExportsRepository } from '../src/repositories/exports.repository.js';

beforeEach(() => {
  vi.spyOn(workerExportsRepository, 'recoverStale').mockResolvedValue(undefined);
  mocks.query.mockResolvedValue([]);
  mocks.execute.mockResolvedValue(1);
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('Export expiration and recovery', () => {
  it('removes an expired managed file before clearing its reference, preserving the job record', async () => {
    mocks.query.mockResolvedValue([{ id: 'job', result_manifest_uri: 'managed.csv' }]);
    await cleanupExports();
    expect(mocks.remove).toHaveBeenCalledWith('managed.csv');
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]);
    expect(String(mocks.query.mock.calls[0][0])).toContain('expires_at <= now()');
    expect(String(mocks.execute.mock.calls[0][0])).toContain('result_manifest_uri = NULL');
    expect(String(mocks.execute.mock.calls)).not.toContain('DELETE');
    expect(workerExportsRepository.recoverStale).toHaveBeenCalledOnce();
  });
  it('keeps failed removals retryable and continues with the remaining files', async () => {
    mocks.query.mockResolvedValue([{ id: 'first', result_manifest_uri: 'first.csv' }, { id: 'second', result_manifest_uri: 'second.csv' }]);
    mocks.remove.mockRejectedValueOnce(new Error('storage failure')).mockResolvedValue(undefined);
    await cleanupExports();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0]).toContain('second');
    expect(workerExportsRepository.recoverStale).toHaveBeenCalledOnce();
  });
});
