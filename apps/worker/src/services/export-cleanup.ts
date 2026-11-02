import { opendir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '@firebridge/database';
import { resultsConfig } from '@firebridge/results';
import { localExportStorage } from '@firebridge/results/storage';
import { logger } from '../config/logger.js';
import { workerExportsRepository } from '../repositories/exports.repository.js';

export async function cleanupExports(): Promise<void> {
  // Only Phase 4 export artifacts are removed. Job/audit records are preserved.
  const expired = await prisma.$queryRaw<{ id: string; result_manifest_uri: string }[]>`
    SELECT id::text, result_manifest_uri FROM firebridge.api_jobs
    WHERE kind = 'export' AND expires_at <= now() AND result_manifest_uri IS NOT NULL
    ORDER BY expires_at LIMIT 100
  `;
  for (const job of expired) {
    try {
      await localExportStorage.remove(job.result_manifest_uri);
      await prisma.$executeRaw`
        UPDATE firebridge.api_jobs SET result_manifest_uri = NULL
        WHERE id = ${job.id}::uuid AND result_manifest_uri = ${job.result_manifest_uri} AND expires_at <= now()
      `;
      logger.info({ jobId: job.id }, 'Expired export removed');
    } catch {
      logger.error({ jobId: job.id }, 'Expired export removal failed; will retry');
    }
  }
  await prisma.$executeRaw`
    UPDATE firebridge.api_jobs SET status = 'failed', completed_at = now(),
      lease_expires_at = NULL, error_code = 'EXPORT_ATTEMPTS_EXHAUSTED'
    WHERE kind = 'export' AND status = 'running' AND lease_expires_at <= now() AND attempt >= 3
  `;
  await workerExportsRepository.recoverStale();
  // Also reclaim abandoned attempt files after crashes. Never follow symlinks.
  try {
    const directory = await opendir(resultsConfig.EXPORT_STORAGE_DIR);
    let removed = 0;
    for await (const entry of directory) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.(csv|geojson|parquet)(\.part)?$/.test(entry.name)) continue;
      const filename = resolve(resultsConfig.EXPORT_STORAGE_DIR, entry.name);
      const age = Date.now() - (await stat(filename)).mtimeMs;
      const ttl = (resultsConfig.EXPORT_MAX_DURATION_SECONDS + 120 +
        (entry.name.endsWith('.part') ? 0 : resultsConfig.EXPORT_RETENTION_SECONDS)) * 1000;
      if (age > ttl) {
        await unlink(filename).catch((error: { code?: string }) => { if (error.code !== 'ENOENT') throw error; });
        if (++removed >= 100) break;
      }
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export class ExportCleanup {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private running = false;
  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.pending = cleanupExports().catch(() => logger.error('Export cleanup failed')).finally(() => {
        this.pending = undefined;
        this.schedule(resultsConfig.EXPORT_CLEANUP_INTERVAL_SECONDS * 1000);
      });
    }, delay);
  }
  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.pending;
  }
}
