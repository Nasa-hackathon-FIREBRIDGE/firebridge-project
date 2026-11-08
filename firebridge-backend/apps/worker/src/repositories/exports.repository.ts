import { prisma } from '@firebridge/database';
import { resultsConfig, type ExportInput } from '@firebridge/results';
import type { StoredFile } from '@firebridge/results/storage';

export interface ClaimedExport {
  id: string;
  analysis_id: string;

  request_spec: ExportInput;
  attempt: number;
}

export const workerExportsRepository = {
  async claim(id: string): Promise<ClaimedExport | null> {
    const [job] = await prisma.$queryRaw<ClaimedExport[]>`
      UPDATE firebridge.api_jobs SET status = 'running', attempt = attempt + 1,
        lease_expires_at = now() + (${resultsConfig.EXPORT_MAX_DURATION_SECONDS + 60} * interval '1 second'),
        error_code = NULL, progress = '{"stage":"exporting","percent":0}'::jsonb
      WHERE id = ${id}::uuid AND kind = 'export' AND attempt < 3
        AND (status = 'queued' OR (status = 'running' AND lease_expires_at <= now()))
      RETURNING id::text, analysis_id::text, request_spec, attempt
    `;
    return job ?? null;
  },

  async state(id: string) {
    const [job] = await prisma.$queryRaw<{ status: string; lease_expires_at: Date | null }[]>`
      SELECT status, lease_expires_at FROM firebridge.api_jobs WHERE id = ${id}::uuid AND kind = 'export'
    `;
    return job;
  },

  async succeed(job: ClaimedExport, file: StoredFile, rows: number): Promise<boolean> {
    const updated = await prisma.$executeRaw`
      UPDATE firebridge.api_jobs SET status = 'succeeded', completed_at = now(), lease_expires_at = NULL,
        result_manifest_uri = ${file.key}, result_sha256 = ${file.sha256}, result_byte_size = ${BigInt(file.bytes)},
        expires_at = now() + (${resultsConfig.EXPORT_RETENTION_SECONDS} * interval '1 second'),
        progress = ${JSON.stringify({ stage: 'completed', percent: 100, rows })}::jsonb
      WHERE id = ${job.id}::uuid AND status = 'running' AND attempt = ${job.attempt}
        AND lease_expires_at > now()
    `;
    return updated === 1;
  },

  async fail(job: ClaimedExport, terminal: boolean): Promise<void> {
    await prisma.$executeRaw`
      UPDATE firebridge.api_jobs SET status = ${terminal ? 'failed' : 'queued'},
        lease_expires_at = NULL, error_code = 'EXPORT_PROCESSING_ERROR',
        completed_at = CASE WHEN ${terminal} THEN now() ELSE NULL END,
        progress = ${JSON.stringify({ stage: terminal ? 'failed' : 'retrying', percent: 0 })}::jsonb
      WHERE id = ${job.id}::uuid AND status = 'running' AND attempt = ${job.attempt}
    `;
  },

  async recoverStale(): Promise<void> {
    // Recover an attempt even if BullMQ exhausted its stalled-job handling while
    // the worker was offline. The old attempt is fenced by status and attempt.
    await prisma.$executeRaw`
      WITH stale AS (
        SELECT id FROM firebridge.api_jobs WHERE kind = 'export' AND status = 'running'
          AND lease_expires_at <= now() AND attempt < 3 LIMIT 100 FOR UPDATE SKIP LOCKED
      ), recovered AS (
        UPDATE firebridge.api_jobs j SET status = 'queued', lease_expires_at = NULL
        FROM stale WHERE j.id = stale.id RETURNING j.id, j.attempt
      )
      INSERT INTO firebridge.outbox_events(id,event_type,aggregate_id,dedupe_key,payload,status,available_at)
      SELECT gen_random_uuid(), 'export.requested', id::text,
        'export:' || id::text || ':recovery:' || attempt::text,
        jsonb_build_object('job_id', id::text), 'pending', now() FROM recovered
      ON CONFLICT (dedupe_key) DO NOTHING
    `;
  }
};
