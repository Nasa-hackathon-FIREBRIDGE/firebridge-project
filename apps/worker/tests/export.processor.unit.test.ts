import { PassThrough } from 'node:stream';
import type { Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), context: vi.fn(), read: vi.fn(), staging: vi.fn(),
  write: vi.fn(), remove: vi.fn(), abort: vi.fn(), commit: vi.fn() }));
vi.mock('@firebridge/database', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@firebridge/results', async (original) => ({
  ...await original<typeof import('@firebridge/results')>(), findResultContext: mocks.context, readDetectionBatch: mocks.read
}));
vi.mock('@firebridge/results/storage', () => ({ localExportStorage: { create: mocks.staging, remove: mocks.remove } }));
vi.mock('../src/exports/write-export.js', () => ({ writeExport: mocks.write }));

import { processExportJob, type ExportJobPayload } from '../src/processors/export.processor.js';
import { workerExportsRepository } from '../src/repositories/exports.repository.js';
import { resultsConfig } from '@firebridge/results';

const id = '44444444-4444-4444-8444-444444444444';
const claim = { id, analysis_id: id, requested_by: 'alice', attempt: 1,
  request_spec: { format: 'csv' as const, filters: {}, options: {} } };
const task = { data: { job_id: id }, opts: { attempts: 3 }, attemptsMade: 0,
  token: 'lock', moveToDelayed: vi.fn().mockResolvedValue(undefined) } as unknown as Job<ExportJobPayload>;
const row = { id: '1', source_id: 'source', acquired_at: '2026-01-01T00:00:00Z',
  longitude: 0, latitude: 0, confidence_raw: null, day_night: null, frp_mw: null };

beforeEach(() => {
  vi.spyOn(workerExportsRepository, 'claim').mockResolvedValue(claim);
  vi.spyOn(workerExportsRepository, 'state').mockResolvedValue({ status: 'succeeded', lease_expires_at: null });
  vi.spyOn(workerExportsRepository, 'succeed').mockResolvedValue(true);
  vi.spyOn(workerExportsRepository, 'fail').mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((fn) => fn({ $executeRaw: vi.fn().mockResolvedValue(1) }));
  mocks.context.mockResolvedValue({ status: 'ready', component_status: 'ready',
    release_status: 'published', time_basis: 'utc', metric_key: 'native_detections_v1', selection_policy: 'standard', grid_id: null });
  mocks.read.mockResolvedValueOnce([row]).mockResolvedValue([]);
  mocks.commit.mockResolvedValue({ key: `${id}.${id}.csv`, bytes: 32, sha256: 'hash' });
  mocks.abort.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.staging.mockImplementation(async () => ({ output: new PassThrough(), commit: mocks.commit, abort: mocks.abort }));
  mocks.write.mockImplementation(async (_format, rows) => { for await (const row of rows) { void row; } });
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('Export processor lifecycle', () => {
  it('reads by keyset and publishes only after storage commit', async () => {
    await processExportJob(task);
    expect(mocks.read.mock.calls[0].slice(1)).toEqual([id, {}, '0', 1000]);
    expect(mocks.read.mock.calls[1][3]).toBe('1');
    expect(workerExportsRepository.succeed).toHaveBeenCalledWith(claim, expect.objectContaining({ bytes: 32 }), 1);
    expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(workerExportsRepository.succeed).mock.invocationCallOrder[0]);
  });
  it('acknowledges an already completed duplicate without writing', async () => {
    vi.mocked(workerExportsRepository.claim).mockResolvedValue(null);
    await processExportJob(task);
    expect(mocks.staging).not.toHaveBeenCalled();
  });
  it('delays a duplicate that still has a database lease', async () => {
    vi.mocked(workerExportsRepository.claim).mockResolvedValue(null);
    vi.mocked(workerExportsRepository.state).mockResolvedValue({ status: 'running', lease_expires_at: new Date(Date.now() + 60000) });
    task.moveToDelayed = vi.fn().mockResolvedValue(undefined);
    await expect(processExportJob(task)).rejects.toThrow();
    expect(task.moveToDelayed).toHaveBeenCalled();
    expect(mocks.staging).not.toHaveBeenCalled();
  });
  it('cleans staging and returns a transient failure to queued for BullMQ retry', async () => {
    mocks.write.mockRejectedValueOnce(new Error('private DB connection string'));
    await expect(processExportJob(task)).rejects.toThrow('Export processing failed.');
    expect(workerExportsRepository.fail).toHaveBeenCalledWith(claim, false);
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(workerExportsRepository.succeed).not.toHaveBeenCalled();
    await processExportJob(task);
    expect(workerExportsRepository.succeed).toHaveBeenCalledOnce();
  });
  it('marks the final attempt failed', async () => {
    const lastClaim = { ...claim, attempt: 3 };
    vi.mocked(workerExportsRepository.claim).mockResolvedValue(lastClaim);
    mocks.write.mockRejectedValue(new Error('disk error'));
    await expect(processExportJob(task)).rejects.toThrow('Export processing failed.');
    expect(workerExportsRepository.fail).toHaveBeenCalledWith(lastClaim, true);
  });
  it('rechecks analysis availability inside the worker snapshot', async () => {
    mocks.context.mockResolvedValue(null);
    await expect(processExportJob(task)).rejects.toThrow();
    expect(workerExportsRepository.fail).toHaveBeenCalledWith(claim, true);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rejects a stale lease before publishing and removes the orphan attempt', async () => {
    vi.mocked(workerExportsRepository.succeed).mockResolvedValue(false);
    await expect(processExportJob(task)).rejects.toThrow();
    expect(mocks.remove).toHaveBeenCalledWith(`${id}.${id}.csv`);
  });
  it('preserves the renamed file if the database completion acknowledgement is lost', async () => {
    vi.mocked(workerExportsRepository.succeed).mockRejectedValue(new Error('connection lost'));
    await expect(processExportJob(task)).rejects.toThrow();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('stops on the configured row limit before publishing a partial export', async () => {
    const maximum = resultsConfig.EXPORT_MAX_ROWS;
    resultsConfig.EXPORT_MAX_ROWS = 1;
    mocks.read.mockReset().mockResolvedValueOnce([row, { ...row, id: '2' }]);
    try {
      await expect(processExportJob(task)).rejects.toThrow();
      expect(workerExportsRepository.fail).toHaveBeenCalledWith(claim, true);
      expect(mocks.commit).not.toHaveBeenCalled();
    } finally { resultsConfig.EXPORT_MAX_ROWS = maximum; }
  });
  it.each(['EXPORT_SIZE_LIMIT', 'EXPORT_DURATION_LIMIT'])('treats %s as terminal', async (code) => {
    mocks.write.mockRejectedValue(new Error(code));
    await expect(processExportJob(task)).rejects.toThrow();
    expect(workerExportsRepository.fail).toHaveBeenCalledWith(claim, true);
  });
});
