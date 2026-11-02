/**
 * Jobs repository — PostgreSQL parameterized queries for api_jobs
 */

import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import { NotFoundError, ServiceUnavailableError } from '../errors/app-error.js';
import type { ApiJobRecord } from './analyses.repository.js';
import type { JobsListQuery } from '../validators/jobs.validator.js';

export type JobViewRecord = Pick<ApiJobRecord, 'id' | 'kind' | 'analysis_id' | 'status' | 'attempt' | 'progress'
  | 'error_code' | 'expires_at' | 'created_at' | 'completed_at'>;

async function wrapDbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ServiceUnavailableError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('connection') ||
      (error instanceof Prisma.PrismaClientInitializationError) ||
      (error instanceof Prisma.PrismaClientRustPanicError)
    ) {
      throw new ServiceUnavailableError('Database is currently unavailable.');
    }

    throw error;
  }
}

export const jobsRepository = {
  async list(query: JobsListQuery, after?: string): Promise<JobViewRecord[]> {
    return wrapDbCall(() => prisma.$queryRaw<JobViewRecord[]>(Prisma.sql`
      SELECT id::text,kind,analysis_id::text,status,attempt,progress,error_code,expires_at,created_at,completed_at
      FROM firebridge.api_jobs WHERE TRUE
        ${query.kind ? Prisma.sql`AND kind = ${query.kind}` : Prisma.empty}
        ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
        ${query.analysis_id ? Prisma.sql`AND analysis_id = ${query.analysis_id}::uuid` : Prisma.empty}
        ${after ? Prisma.sql`AND id > ${after}::uuid` : Prisma.empty}
      ORDER BY id LIMIT ${query.limit + 1}
    `));
  },
  /**
   * Finds a job by its unique UUID id.
   */
  async findById(jobId: string): Promise<ApiJobRecord | null> {
    return wrapDbCall(async () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(jobId)) {
        return null;
      }

      const rows = await prisma.$queryRaw<ApiJobRecord[]>`
        SELECT
          id::text,
          kind,
          analysis_id::text,
          explanation_id::text,
          requested_by,
          request_hash,
          idempotency_key,
          request_spec,
          status,
          attempt,
          progress,
          error_code,
          expires_at,
          created_at,
          completed_at
        FROM firebridge.api_jobs
        WHERE id = ${jobId}::uuid
        LIMIT 1;
      `;

      return rows[0] ?? null;
    });
  }
};
