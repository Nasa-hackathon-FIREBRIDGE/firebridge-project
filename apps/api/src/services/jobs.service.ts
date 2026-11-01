/**
 * Jobs service — Phase 2
 */

import { NotFoundError } from '../errors/app-error.js';
import { jobsRepository } from '../repositories/jobs.repository.js';

export interface JobDetailResponse {
  id: string;
  kind: string;
  status: string;
  progress: unknown;
  current_stage: string;
  attempt: number;
  max_attempts: number;
  retryable: boolean;
  error_code: string | null;
  expires_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
  analysis_id: string | null;
}

export const MAX_JOB_ATTEMPTS = 3;

export const jobsService = {
  /**
   * Retrieves a job by ID, calculating real retryability and current stage.
   */
  async getJobById(jobId: string): Promise<JobDetailResponse> {
    const job = await jobsRepository.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Job with id '${jobId}' was not found.`);
    }

    // Dynamic retryability determination based on real system state
    // Jobs can only be retried if they failed and haven't exceeded maximum attempt threshold
    const isFailed = job.status === 'failed';
    const hasAttemptsRemaining = job.attempt < MAX_JOB_ATTEMPTS;
    const retryable = isFailed && hasAttemptsRemaining;

    // Determine current processing stage
    let currentStage = job.status;
    if (job.progress && typeof job.progress === 'object' && 'stage' in job.progress) {
      currentStage = String((job.progress as { stage: unknown }).stage);
    }

    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
      current_stage: currentStage,
      attempt: job.attempt,
      max_attempts: MAX_JOB_ATTEMPTS,
      retryable,
      error_code: job.error_code,
      expires_at: job.expires_at,
      created_at: job.created_at,
      completed_at: job.completed_at,
      analysis_id: job.analysis_id
    };
  }
};
