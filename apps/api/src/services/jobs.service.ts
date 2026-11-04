/**
 * Jobs service — Phase 2
 */

import { NotFoundError } from '../errors/app-error.js';
import { jobsRepository, type JobViewRecord } from '../repositories/jobs.repository.js';
import type { JobsListQuery } from '../validators/jobs.validator.js';
import { decodeCursor, encodeCursor } from '../utils/sources-cursor.js';
import { parseResultInput } from '../validators/results.validator.js';
import { uuidSchema } from '@firebridge/results';
import { env } from '../config/env.js';
import { createDownloadLink } from '../utils/download-link.js';

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
  download_url: string | null;
}

export const MAX_JOB_ATTEMPTS = 3;

function jobView(job: JobViewRecord): Omit<JobDetailResponse, 'download_url'> {
  const progress =
    job.progress && typeof job.progress === 'object' && !Array.isArray(job.progress)
      ? { ...job.progress }
      : job.progress;
  if (progress && typeof progress === 'object') Reflect.deleteProperty(progress, 'recovery');
  const maxAttempts = job.kind === 'analysis' ? env.ANALYSIS_MAX_ATTEMPTS : MAX_JOB_ATTEMPTS;
  return {
    id: job.id,
    kind: job.kind,
    analysis_id: job.analysis_id,
    status: job.status,
    progress,
    current_stage:
      progress && typeof progress === 'object' && 'stage' in progress
        ? String(progress.stage)
        : job.status,
    attempt: job.attempt,
    max_attempts: maxAttempts,
    retryable:
      job.status === 'failed' &&
      job.attempt < maxAttempts &&
      job.error_code !== 'EVIDENCE_VALIDATION_FAILED',
    error_code: job.error_code,
    expires_at: job.expires_at,
    created_at: job.created_at,
    completed_at: job.completed_at
  };
}

export const jobsService = {
  async list(query: JobsListQuery) {
    const filters = { kind: query.kind, status: query.status, analysis_id: query.analysis_id };
    const after = query.cursor
      ? parseResultInput(uuidSchema, decodeCursor(query.cursor, filters).id)
      : undefined;
    const records = await jobsRepository.list(query, after);
    const more = records.length > query.limit;
    const page = records.slice(0, query.limit);
    return {
      jobs: page.map(jobView),
      nextCursor: more ? encodeCursor({ id: page[page.length - 1].id, filters }) : null
    };
  },
  /**
   * Retrieves a job by ID, calculating real retryability and current stage.
   */
  async getJobById(jobId: string): Promise<JobDetailResponse> {
    const job = await jobsRepository.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Job with id '${jobId}' was not found.`);
    }

    return { ...jobView(job), download_url: job.kind === 'export' && job.status === 'succeeded' && job.expires_at ? createDownloadLink(job.id, job.expires_at) : null };
  }
};
