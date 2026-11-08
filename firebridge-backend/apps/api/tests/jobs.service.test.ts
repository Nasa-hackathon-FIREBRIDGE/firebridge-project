import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { jobsRepository, type JobViewRecord } from '../src/repositories/jobs.repository.js';
import { jobsService } from '../src/services/jobs.service.js';

const original = env.ANALYSIS_MAX_ATTEMPTS;
const record: JobViewRecord = { id: '44444444-4444-4444-8444-444444444444', kind: 'analysis', analysis_id: null,
  status: 'failed', attempt: 1, progress: { percent: 0, stage: 'retrying', recovery: { reason: 'redis_outcome_unacknowledged' } },
  error_code: 'PROCESSING_ERROR', expires_at: null, created_at: new Date(), completed_at: null };
afterEach(() => { vi.restoreAllMocks(); env.ANALYSIS_MAX_ATTEMPTS = original; });

describe('Job view compatibility', () => {
  it('keeps recovery coordination metadata out of API progress without mutating the record', async () => {
    vi.spyOn(jobsRepository, 'list').mockResolvedValue([record]);
    const { jobs } = await jobsService.list({ limit: 10 });
    expect(jobs[0].progress).toEqual({ percent: 0, stage: 'retrying' });
    expect(record.progress).toHaveProperty('recovery');
  });
  it('reports the same configured analysis attempt limit as the worker', async () => {
    env.ANALYSIS_MAX_ATTEMPTS = 1;
    vi.spyOn(jobsRepository, 'list').mockResolvedValue([record]);
    const { jobs } = await jobsService.list({ limit: 10 });
    expect(jobs[0]).toMatchObject({ max_attempts: 1, retryable: false });
  });
  it('preserves the export attempt limit', async () => {
    env.ANALYSIS_MAX_ATTEMPTS = 1;
    vi.spyOn(jobsRepository, 'list').mockResolvedValue([{ ...record, kind: 'export' }]);
    const { jobs } = await jobsService.list({ limit: 10 });
    expect(jobs[0]).toMatchObject({ max_attempts: 3, retryable: true });
  });
});
