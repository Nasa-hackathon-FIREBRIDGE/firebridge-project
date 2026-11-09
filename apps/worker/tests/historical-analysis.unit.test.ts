import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ needs: vi.fn(), renew: vi.fn(), attach: vi.fn(), fetch: vi.fn() }));
vi.mock('../src/config/env.js', () => ({ env: { HISTORY_SERVICE_URL: 'http://history:8090', HISTORY_SERVICE_TOKEN: 'fixture-only-history-token-32-characters' } }));
vi.mock('../src/repositories/analyses.repository.js', () => ({
  AnalysisLeaseLost: class AnalysisLeaseLost extends Error {},
  InvalidAnalysisTask: class InvalidAnalysisTask extends Error {},
  workerAnalysesRepository: { needsHistoricalPreparation: mocks.needs, renew: mocks.renew, attachHistoricalResult: mocks.attach }
}));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));
import { prepareHistoricalAnalysis } from '../src/services/historical-analysis.js';

const payload = { job_id: '11111111-1111-4111-8111-111111111111', analysis_id: '22222222-2222-4222-8222-222222222222', area_id: '33333333-3333-4333-8333-333333333333', metric_key: 'native_detections_v1', start_date: '2020-01-01', end_date_exclusive: '2021-01-01' };
const claim = { id: payload.job_id, analysisId: payload.analysis_id, attempt: 1 };
const job = '44444444-4444-4444-8444-444444444444';
const release = '55555555-5555-4555-8555-555555555555';
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe('durable historical preparation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); mocks.needs.mockResolvedValue(true); mocks.renew.mockResolvedValue(true); });
  afterEach(() => vi.unstubAllGlobals());
  it('leaves ordinary native analyses on their existing path', async () => {
    mocks.needs.mockResolvedValue(false);
    await prepareHistoricalAnalysis(payload, claim);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('renews the lease while polling and attaches exactly one validated result', async () => {
    mocks.fetch.mockResolvedValueOnce(response({ job_id: job, status: 'queued' }))
      .mockResolvedValueOnce(response({ job_id: job, status: 'running' }))
      .mockResolvedValueOnce(response({ job_id: job, status: 'succeeded', result: { release_id: release } }));
    await prepareHistoricalAnalysis(payload, claim);
    expect(mocks.renew).toHaveBeenCalledTimes(3);
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith(payload, claim, job, release);
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-only-history-token-32-characters');
  });
  it('cannot attach after losing its lease', async () => {
    mocks.fetch.mockResolvedValue(response({ job_id: job, status: 'succeeded', result: { release_id: release } }));
    mocks.renew.mockResolvedValue(false);
    await expect(prepareHistoricalAnalysis(payload, claim)).rejects.toThrow();
    expect(mocks.attach).not.toHaveBeenCalled();
  });
  it('keeps failed selections from becoming ready', async () => {
    mocks.fetch.mockResolvedValue(response({ job_id: job, status: 'failed', error_code: 'history_selection_too_large' }));
    await expect(prepareHistoricalAnalysis(payload, claim)).rejects.toThrow('could not be prepared');
    expect(mocks.attach).not.toHaveBeenCalled();
  });
  it('rejects malformed service responses', async () => {
    mocks.fetch.mockResolvedValue(response({ job_id: '../path', status: 'succeeded' }));
    await expect(prepareHistoricalAnalysis(payload, claim)).rejects.toThrow('Invalid historical preparation response');
    expect(mocks.attach).not.toHaveBeenCalled();
  });
});
