import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import type { AnalysisJobPayload } from '../validators/queue-payload.js';

export class InvalidAnalysisTask extends Error {}
export class AnalysisLeaseLost extends Error {}

interface AnalysisState {
  id: string;
  area_id: string;
  metric_key: string;
  start_date: string;
  end_date_exclusive: string;
  status: string;
  completed_at: Date | null;
}
interface JobState {
  id: string;
  status: string;
  attempt: number;
  lease_expires_at: Date | null;
  completed_at: Date | null;
  lease_live: boolean;
}
export interface AnalysisClaim { id: string; analysisId: string; attempt: number }
type ClaimResult = { kind: 'claimed'; claim: AnalysisClaim } | { kind: 'done' } | { kind: 'busy'; until: number };

// Always lock analysis before API job, including recovery and finalization.
async function lockState(tx: Prisma.TransactionClient, payload: AnalysisJobPayload) {
  const [analysis] = await tx.$queryRaw<AnalysisState[]>`
    SELECT id::text, area_id::text, metric_key, start_date::text, end_date_exclusive::text, status, completed_at
    FROM firebridge.analyses WHERE id = ${payload.analysis_id}::uuid FOR UPDATE
  `;
  const [job] = await tx.$queryRaw<JobState[]>`
    SELECT id::text, status, attempt, completed_at, lease_expires_at, coalesce(lease_expires_at > now(), false) AS lease_live
    FROM firebridge.api_jobs WHERE id = ${payload.job_id}::uuid AND kind = 'analysis'
      AND analysis_id = ${payload.analysis_id}::uuid FOR UPDATE
  `;
  if (!analysis || !job || analysis.area_id !== payload.area_id || analysis.metric_key !== payload.metric_key
    || analysis.start_date !== payload.start_date || analysis.end_date_exclusive !== payload.end_date_exclusive) {
    throw new InvalidAnalysisTask('Analysis task does not match its durable records.');
  }
  return { analysis, job };
}

export const workerAnalysesRepository = {
  async claim(payload: AnalysisJobPayload): Promise<ClaimResult> {
    return prisma.$transaction(async (tx) => {
      const { analysis, job } = await lockState(tx, payload);
      if (!['queued', 'running'].includes(job.status) || job.completed_at) return { kind: 'done' };
      if (!['queued', 'running'].includes(analysis.status) || analysis.completed_at) {
        // Repair a legacy split finalization without executing the analysis again.
        const status = analysis.status === 'ready' ? 'succeeded' : analysis.status === 'partial' ? 'partial' : 'failed';
        await tx.$executeRaw`
          UPDATE firebridge.api_jobs SET status = ${status}, completed_at = coalesce(${analysis.completed_at}, now()),
            lease_expires_at = NULL, progress = progress || '{"percent":100,"stage":"completed"}'::jsonb
          WHERE id = ${job.id}::uuid
        `;
        return { kind: 'done' };
      }
      if (job.status === 'running' && job.lease_live) {
        return { kind: 'busy', until: job.lease_expires_at!.getTime() };
      }
      const [other] = await tx.$queryRaw<{ lease_expires_at: Date }[]>`
        SELECT lease_expires_at FROM firebridge.api_jobs WHERE analysis_id = ${analysis.id}::uuid
          AND kind = 'analysis' AND id <> ${job.id}::uuid AND status = 'running' AND lease_expires_at > now()
        LIMIT 1
      `;
      if (other) return { kind: 'busy', until: other.lease_expires_at.getTime() };
      if (job.attempt >= env.ANALYSIS_MAX_ATTEMPTS) {
        await tx.$executeRaw`UPDATE firebridge.api_jobs SET status = 'failed', completed_at = now(),
          lease_expires_at = NULL, error_code = 'PROCESSING_ERROR' WHERE id = ${job.id}::uuid`;
        await tx.$executeRaw`UPDATE firebridge.analyses SET status = 'failed', completed_at = now(),
          error_code = 'PROCESSING_ERROR' WHERE id = ${analysis.id}::uuid`;
        return { kind: 'done' };
      }
      await tx.$executeRaw`
        UPDATE firebridge.api_jobs SET status = 'running', attempt = attempt + 1, error_code = NULL,
          lease_expires_at = now() + (${env.ANALYSIS_LEASE_SECONDS} * interval '1 second'),
          progress = progress || '{"percent":10,"stage":"resolving_data"}'::jsonb
        WHERE id = ${job.id}::uuid
      `;
      await tx.$executeRaw`UPDATE firebridge.analyses SET status = 'running', error_code = NULL WHERE id = ${analysis.id}::uuid`;
      return { kind: 'claimed', claim: { id: job.id, analysisId: analysis.id, attempt: job.attempt + 1 } };
    }, { timeout: 10000 });
  },

  async complete(payload: AnalysisJobPayload, claim: AnalysisClaim): Promise<'ready' | 'partial'> {
    return prisma.$transaction(async (tx) => {
      const { analysis, job } = await lockState(tx, payload);
      if (job.status !== 'running' || job.attempt !== claim.attempt || !job.lease_live
        || job.completed_at || analysis.completed_at || analysis.status !== 'running') throw new AnalysisLeaseLost();
      const components = await tx.$queryRaw<{ component: string; status: string; release_id: string | null }[]>`
        SELECT component, status, release_id::text FROM firebridge.analysis_components
        WHERE analysis_id = ${claim.analysisId}::uuid FOR SHARE
      `;
      if (!components.some((c) => c.component === 'satellite' && c.status === 'ready' && c.release_id)) {
        throw new InvalidAnalysisTask('Required satellite component is unavailable.');
      }
      const status = components.some((c) => c.component !== 'satellite' && c.status !== 'ready') ? 'partial' : 'ready';
      await tx.$executeRaw`
        UPDATE firebridge.analyses SET status = ${status}, completed_at = now(), error_code = NULL
        WHERE id = ${claim.analysisId}::uuid
      `;
      await tx.$executeRaw`
        UPDATE firebridge.api_jobs SET status = ${status === 'ready' ? 'succeeded' : 'partial'},
          completed_at = now(), lease_expires_at = NULL, error_code = NULL,
          progress = progress || '{"percent":100,"stage":"completed"}'::jsonb
        WHERE id = ${claim.id}::uuid
      `;
      return status;
    }, { timeout: 10000 });
  },

  async fail(payload: AnalysisJobPayload, claim: AnalysisClaim, terminal: boolean): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const { analysis, job } = await lockState(tx, payload);
      // A completion commit can succeed even when its acknowledgement is lost.
      if (job.status !== 'running' || job.attempt !== claim.attempt || !job.lease_live
        || job.completed_at || analysis.completed_at || analysis.status !== 'running') return;
      await tx.$executeRaw`
        UPDATE firebridge.analyses SET status = ${terminal ? 'failed' : 'queued'},
          completed_at = CASE WHEN ${terminal} THEN now() ELSE NULL END, error_code = 'PROCESSING_ERROR'
        WHERE id = ${claim.analysisId}::uuid
      `;
      await tx.$executeRaw`
        UPDATE firebridge.api_jobs SET status = ${terminal ? 'failed' : 'queued'}, lease_expires_at = NULL,
          completed_at = CASE WHEN ${terminal} THEN now() ELSE NULL END, error_code = 'PROCESSING_ERROR',
          progress = progress || ${JSON.stringify({ percent: 0, stage: terminal ? 'failed' : 'retrying' })}::jsonb
        WHERE id = ${claim.id}::uuid
      `;
    }, { timeout: 10000 });
  }
};
