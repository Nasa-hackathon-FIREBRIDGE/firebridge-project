import { randomUUID } from 'node:crypto';
import { prisma } from '@firebridge/database';
import {
  exportInputSchema,
  findResultContext,
  readDetectionBatch,
  resultAvailability,
  resultsConfig,
  type DetectionRow
} from '@firebridge/results';
import { localExportStorage } from '@firebridge/results/storage';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { workerExportsRepository } from '../repositories/exports.repository.js';
import { writeExport } from '../exports/write-export.js';
import { logger } from '../config/logger.js';
import { exportJobSchema } from '../validators/queue-payload.js';

export interface ExportJobPayload {
  job_id: string;
}

export async function processExportJob(bullJob: Job<ExportJobPayload>): Promise<void> {
  const payload = exportJobSchema.safeParse(bullJob.data);
  if (!payload.success) throw new UnrecoverableError('Invalid export task payload.');
  const id = payload.data.job_id;
  const job = await workerExportsRepository.claim(id);
  if (!job) {
    const current = await workerExportsRepository.state(id);
    if (current?.status === 'running') {
      // A duplicate delivery must not acknowledge a still-leased, crashed task.
      await bullJob.moveToDelayed(
        Math.max(Date.now() + 1000, current.lease_expires_at?.getTime() ?? 0) + 1000,
        bullJob.token
      );
      throw new DelayedError();
    }
    return;
  }
  let staging: Awaited<ReturnType<typeof localExportStorage.create>> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const input = exportInputSchema.parse(job.request_spec);
    const key = `${id}.${randomUUID()}.${input.format}`;
    staging = await localExportStorage.create(key);
    const output = staging.output;
    const deadline = Date.now() + resultsConfig.EXPORT_MAX_DURATION_SECONDS * 1000;
    deadlineTimer = setTimeout(
      () => output.destroy(new Error('EXPORT_DURATION_LIMIT')),
      resultsConfig.EXPORT_MAX_DURATION_SECONDS * 1000
    );
    let rowCount = 0;
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(Math.min(15000, resultsConfig.EXPORT_MAX_DURATION_SECONDS * 1000))}, true)`;
        await tx.$executeRaw`SET LOCAL work_mem = '8MB'`;
        const context = await findResultContext(job.analysis_id, tx);
        if (!context || resultAvailability(context) !== 'ready') {
          throw new UnrecoverableError('EXPORT_ANALYSIS_UNAVAILABLE');
        }
        async function* detections(): AsyncGenerator<DetectionRow> {
          let after = '0';
          while (true) {
            if (Date.now() > deadline || output.destroyed) throw new Error('EXPORT_DURATION_LIMIT');
            const batch = await readDetectionBatch(
              tx,
              job!.analysis_id,
              input.filters,
              after,
              Math.min(
                resultsConfig.EXPORT_BATCH_SIZE,
                resultsConfig.EXPORT_MAX_ROWS - rowCount + 1
              ),
              context!
            );
            if (batch.length === 0) return;
            for (const row of batch) {
              if (row.source_id.length > 1024 || (row.confidence_raw?.length ?? 0) > 1024) {
                throw new UnrecoverableError('EXPORT_CELL_SIZE_LIMIT');
              }
              if (++rowCount > resultsConfig.EXPORT_MAX_ROWS)
                throw new UnrecoverableError('EXPORT_ROW_LIMIT');
              if (Date.now() > deadline || output.destroyed)
                throw new Error('EXPORT_DURATION_LIMIT');
              yield row;
            }
            after = batch[batch.length - 1].id;
          }
        }
        await writeExport(input.format, detections(), output);
      },
      {
        isolationLevel: 'RepeatableRead',
        timeout: resultsConfig.EXPORT_MAX_DURATION_SECONDS * 1000 + 2000
      }
    );
    if (Date.now() > deadline) throw new UnrecoverableError('EXPORT_DURATION_LIMIT');
    const file = await staging.commit();
    if (!(await workerExportsRepository.succeed(job, file, rowCount))) {
      await localExportStorage.remove(file.key);
      throw new Error('EXPORT_LEASE_LOST');
    }
    logger.info(
      { jobId: id, format: input.format, rows: rowCount, bytes: file.bytes },
      'Export completed'
    );
  } catch (error) {
    if (staging)
      await staging
        .abort()
        .catch(() => logger.error({ jobId: id }, 'Export temporary cleanup failed'));
    // A database acknowledgement can be lost after a successful commit. Leave
    // renamed files to retention cleanup rather than deleting a published file.
    const limitError =
      error instanceof Error &&
      ['EXPORT_SIZE_LIMIT', 'EXPORT_DURATION_LIMIT'].includes(error.message);
    const terminal =
      error instanceof UnrecoverableError ||
      limitError ||
      job.attempt >= 3 ||
      bullJob.attemptsMade + 1 >= (bullJob.opts.attempts ?? 1);
    await workerExportsRepository.fail(job, terminal);
    logger.error({ jobId: id, attempt: job.attempt, terminal }, 'Export processing failed');
    if (terminal) throw new UnrecoverableError('Export processing failed.');
    throw new Error('Export processing failed.');
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
