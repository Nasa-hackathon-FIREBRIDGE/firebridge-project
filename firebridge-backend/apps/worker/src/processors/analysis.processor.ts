import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AnalysisLeaseLost, InvalidAnalysisTask, workerAnalysesRepository } from '../repositories/analyses.repository.js';
import { analysisJobSchema, type AnalysisJobPayload } from '../validators/queue-payload.js';

export type { AnalysisJobPayload } from '../validators/queue-payload.js';

export async function processAnalysisJob(job: Job<AnalysisJobPayload>): Promise<void> {
  const parsed = analysisJobSchema.safeParse(job.data);
  if (!parsed.success) throw new UnrecoverableError('Invalid analysis task payload.');
  const payload = parsed.data;
  const result = await workerAnalysesRepository.claim(payload).catch((error: unknown) => {
    if (error instanceof InvalidAnalysisTask) throw new UnrecoverableError(error.message);
    throw new Error('Analysis claim unavailable.');
  });
  if (result.kind === 'done') return;
  if (result.kind === 'busy') {
    await job.moveToDelayed(Math.max(Date.now() + 1000, result.until + 1000), job.token);
    throw new DelayedError();
  }
  const { claim } = result;
  const started = Date.now();
  try {
    // The current processor only evaluates resolved components. Keep this bounded;
    // future long-running computation must renew the SQL lease and fence every write.
    const status = await workerAnalysesRepository.complete(payload, claim);
    logger.info({ apiJobId: claim.id, analysisId: claim.analysisId, attempt: claim.attempt,
      status, durationMs: Date.now() - started }, 'Analysis completed');
  } catch (error) {
    const terminal = error instanceof InvalidAnalysisTask || claim.attempt >= env.ANALYSIS_MAX_ATTEMPTS
      || job.attemptsMade + 1 >= (job.opts?.attempts ?? env.ANALYSIS_MAX_ATTEMPTS);
    if (!(error instanceof AnalysisLeaseLost)) {
      try { await workerAnalysesRepository.fail(payload, claim, terminal); }
      catch { throw new Error('Analysis state update unavailable.'); }
    }
    logger.warn({ apiJobId: claim.id, analysisId: claim.analysisId, attempt: claim.attempt, terminal,
      reason: error instanceof AnalysisLeaseLost ? 'lease_lost' : 'processing_failed' }, 'Analysis attempt failed');
    if (terminal) throw new UnrecoverableError('Analysis processing failed.');
    throw new Error('Analysis processing failed.');
  }
}
