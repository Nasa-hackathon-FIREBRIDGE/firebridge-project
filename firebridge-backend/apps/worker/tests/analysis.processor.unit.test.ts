import type { Job } from 'bullmq';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workerAnalysesRepository, AnalysisLeaseLost, InvalidAnalysisTask } from '../src/repositories/analyses.repository.js';
import { processAnalysisJob, type AnalysisJobPayload } from '../src/processors/analysis.processor.js';

const id = '44444444-4444-4444-8444-444444444444';
const claim = { id, analysisId: id, attempt: 1 };
const data = { job_id: id, analysis_id: id, area_id: id, metric_key: 'native_detections_v1',
  start_date: '2026-01-01', end_date_exclusive: '2026-01-02' };
const task = () => ({ data, opts: { attempts: 3 }, attemptsMade: 0, token: 'lock',
  moveToDelayed: vi.fn().mockResolvedValue(undefined) }) as unknown as Job<AnalysisJobPayload>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(workerAnalysesRepository, 'claim').mockResolvedValue({ kind: 'claimed', claim });
  vi.spyOn(workerAnalysesRepository, 'complete').mockResolvedValue('partial');
  vi.spyOn(workerAnalysesRepository, 'fail').mockResolvedValue(undefined);
});

describe('Analysis processor retries and ownership', () => {
  it('finalizes a claimed task', async () => {
    await processAnalysisJob(task());
    expect(workerAnalysesRepository.complete).toHaveBeenCalledWith(data, claim);
    expect(workerAnalysesRepository.fail).not.toHaveBeenCalled();
  });
  it('does not reprocess a completed duplicate', async () => {
    vi.mocked(workerAnalysesRepository.claim).mockResolvedValue({ kind: 'done' });
    await processAnalysisJob(task());
    expect(workerAnalysesRepository.complete).not.toHaveBeenCalled();
  });
  it('defers a duplicate with a live database lease', async () => {
    vi.mocked(workerAnalysesRepository.claim).mockResolvedValue({ kind: 'busy', until: Date.now() + 60000 });
    const job = task();
    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalled();
    expect(workerAnalysesRepository.complete).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...data, job_id: id + 'x' }, { ...data, start_date: '2026-02-30' },
    { ...data, end_date_exclusive: '2025-01-01' }, { ...data, extra: true }])('rejects invalid payload before SQL', async (invalid) => {
    await expect(processAnalysisJob({ ...task(), data: invalid } as Job<AnalysisJobPayload>)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(workerAnalysesRepository.claim).not.toHaveBeenCalled();
  });
  it('treats a payload-to-database mismatch as fatal without changing another job', async () => {
    vi.mocked(workerAnalysesRepository.claim).mockRejectedValue(new InvalidAnalysisTask('mismatch'));
    await expect(processAnalysisJob(task())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(workerAnalysesRepository.fail).not.toHaveBeenCalled();
  });
  it('returns transient processing failures to queued and can subsequently complete', async () => {
    vi.mocked(workerAnalysesRepository.complete).mockRejectedValueOnce(new Error('private connection details'));
    await expect(processAnalysisJob(task())).rejects.toThrow('Analysis processing failed.');
    expect(workerAnalysesRepository.fail).toHaveBeenCalledWith(data, claim, false);
    await processAnalysisJob(task());
    expect(workerAnalysesRepository.complete).toHaveBeenCalledTimes(2);
  });
  it('marks missing satellite data terminal', async () => {
    vi.mocked(workerAnalysesRepository.complete).mockRejectedValue(new InvalidAnalysisTask('satellite'));
    await expect(processAnalysisJob(task())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(workerAnalysesRepository.fail).toHaveBeenCalledWith(data, claim, true);
  });
  it('bounds database attempts even if Redis retry counters restart', async () => {
    const last = { ...claim, attempt: 3 };
    vi.mocked(workerAnalysesRepository.claim).mockResolvedValue({ kind: 'claimed', claim: last });
    vi.mocked(workerAnalysesRepository.complete).mockRejectedValue(new Error('transient'));
    await expect(processAnalysisJob(task())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(workerAnalysesRepository.fail).toHaveBeenCalledWith(data, last, true);
  });
  it('does not mutate state after losing its lease', async () => {
    vi.mocked(workerAnalysesRepository.complete).mockRejectedValue(new AnalysisLeaseLost());
    await expect(processAnalysisJob(task())).rejects.toThrow();
    expect(workerAnalysesRepository.fail).not.toHaveBeenCalled();
  });
});
