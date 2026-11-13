import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../config/env.js';
import { AnalysisLeaseLost, InvalidAnalysisTask, workerAnalysesRepository, type AnalysisClaim } from '../repositories/analyses.repository.js';
import type { AnalysisJobPayload } from '../validators/queue-payload.js';

type Preparation = { job_id: string; status: string; error_code?: string; result?: { release_id: string } };

export async function prepareHistoricalAnalysis(payload: AnalysisJobPayload, claim: AnalysisClaim): Promise<void> {
  if (!env.HISTORY_SERVICE_URL) return;
  if (!(await workerAnalysesRepository.needsHistoricalPreparation(claim.analysisId))) return;
  const request = async (path: string, body?: unknown): Promise<Preparation> => {
    const response = await fetch(new URL(path, env.HISTORY_SERVICE_URL), {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${env.HISTORY_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error('Historical preparation service is unavailable.');
    const result = await response.json() as Preparation;
    if (!/^[0-9a-f-]{36}$/.test(result.job_id) || !['queued', 'running', 'succeeded', 'failed'].includes(result.status))
      throw new Error('Invalid historical preparation response.');
    return result;
  };
  let job = await request('/jobs', { analysis_id: claim.analysisId });
  const deadline = Date.now() + 35 * 60 * 1000;
  while (Date.now() < deadline) {
    if (!(await workerAnalysesRepository.renew(payload, claim))) throw new AnalysisLeaseLost();
    if (job.status === 'failed') throw new InvalidAnalysisTask('Historical selection could not be prepared.');
    if (job.status === 'succeeded') {
      if (!job.result?.release_id) throw new Error('Historical result is missing its release.');
      await workerAnalysesRepository.attachHistoricalResult(payload, claim, job.job_id, job.result.release_id);
      return;
    }
    await delay(250);
    job = await request('/jobs/' + job.job_id);
  }
  throw new InvalidAnalysisTask('Historical preparation exceeded its time budget.');
}
