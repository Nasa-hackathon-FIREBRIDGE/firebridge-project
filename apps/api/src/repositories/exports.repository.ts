import { randomUUID } from 'node:crypto';
import { prisma } from '@firebridge/database';
import { findResultContext, resultsConfig, type ExportInput } from '@firebridge/results';
import { assertResultAvailable } from '../middleware/results-access.js';
import { IdempotencyConflictError, NotFoundError, TooManyRequestsError } from '../errors/app-error.js';

export interface ExportJob {
  id: string;
  analysis_id: string;

  kind: string;
  status: string;
  request_hash: string;
  request_spec: unknown;
  result_manifest_uri: string | null;
  result_byte_size: bigint | null;
  expires_at: Date | null;
  created_at: Date;
}

export const exportsRepository = {
  async create(analysisId: string, input: ExportInput, requestHash: string, idempotencyKey: string): Promise<ExportJob> {
    return prisma.$transaction(async (tx) => {
      // A database lock preserves quota and idempotency guarantees across API
      // replicas, including a Redis replay-write failure after SQL commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('export:global', 0))`;
      const context = await findResultContext(analysisId, tx);
      if (!context) throw new NotFoundError('Analysis was not found.');
      assertResultAvailable(context);
      const existing = await tx.$queryRaw<ExportJob[]>`
        SELECT id::text, analysis_id::text, kind, status, request_hash, request_spec,
          result_manifest_uri, result_byte_size, expires_at, created_at
        FROM firebridge.api_jobs WHERE idempotency_key = ${idempotencyKey}
      `;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new IdempotencyConflictError();
        return existing[0];
      }
      const [quota] = await tx.$queryRaw<{ active: bigint; recent: bigint }[]>`
        SELECT (SELECT count(*) FROM firebridge.api_jobs
          WHERE kind = 'export' AND status IN ('queued', 'running')) AS active,
          (SELECT count(*) FROM firebridge.api_jobs WHERE kind = 'export'
            AND created_at > now() - interval '1 hour') AS recent
      `;
      if (Number(quota.active) >= resultsConfig.EXPORT_MAX_ACTIVE || Number(quota.recent) >= resultsConfig.EXPORT_MAX_PER_HOUR) {
        throw new TooManyRequestsError('Export quota exceeded.');
      }
      const id = randomUUID();
      const [job] = await tx.$queryRaw<ExportJob[]>`
        INSERT INTO firebridge.api_jobs
          (id, kind, analysis_id, request_hash, idempotency_key, request_spec, status)
        VALUES (${id}::uuid, 'export', ${analysisId}::uuid, ${requestHash}, ${idempotencyKey},
          ${JSON.stringify(input)}::jsonb, 'queued')
        RETURNING id::text, analysis_id::text, kind, status, request_hash, request_spec,
          result_manifest_uri, result_byte_size, expires_at, created_at
      `;
      await tx.$executeRaw`
        INSERT INTO firebridge.outbox_events
          (id, event_type, aggregate_id, dedupe_key, payload, status, available_at)
        VALUES (${randomUUID()}::uuid, 'export.requested', ${id}, ${`export:${id}:created`},
          ${JSON.stringify({ job_id: id })}::jsonb, 'pending', now())
      `;
      return job;
    }, { timeout: 10000 });
  },

  async findById(id: string): Promise<ExportJob | null> {
    const [job] = await prisma.$queryRaw<ExportJob[]>`
      SELECT id::text, analysis_id::text, kind, status, request_hash, request_spec,
        result_manifest_uri, result_byte_size, expires_at, created_at
      FROM firebridge.api_jobs WHERE id = ${id}::uuid
    `;
    return job ?? null;
  }
};
