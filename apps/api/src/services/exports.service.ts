import { createHash } from 'node:crypto';
import { exportFormats, exportInputSchema, type ExportInput } from '@firebridge/results';
import { localExportStorage } from '@firebridge/results/storage';
import { AppError, ConflictError, NotFoundError } from '../errors/app-error.js';
import { requireAvailableResult } from '../middleware/results-access.js';
import { exportsRepository } from '../repositories/exports.repository.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/response.js';

export const exportsService = {
  async create(analysisId: string, input: ExportInput, key: string) {
    const context = await requireAvailableResult(analysisId);
    if (input.filters.source_id && !context.source_ids?.includes(input.filters.source_id))
      throw new ApiError(422, 'INVALID_REQUEST', 'Source filters must narrow the saved analysis.');
    const hash = createHash('sha256')
      .update(JSON.stringify({ analysisId, ...input }))
      .digest('hex');
    const durableKey = `export:${createHash('sha256')
      .update(JSON.stringify([analysisId, key]))
      .digest('hex')}`;
    const job = await exportsRepository.create(analysisId, input, hash, durableKey);
    logger.info({ jobId: job.id, analysisId, format: input.format }, 'Export requested');
    return {
      job_id: job.id,
      analysis_id: analysisId,
      status: job.status,
      format: input.format,
      created_at: job.created_at,
      status_url: `/api/v1/jobs/${job.id}`
    };
  },

  async download(id: string) {
    const job = await exportsRepository.findById(id);
    if (!job || job.kind !== 'export' || !job.analysis_id) {
      throw new NotFoundError('Export job was not found.');
    }
    await requireAvailableResult(job.analysis_id);
    if (job.status !== 'succeeded')
      throw new ConflictError('Export is not successfully completed.');
    const gone = () => new AppError(410, 'EXPORT_GONE', 'Export file is no longer available.');
    if (!job.expires_at || job.expires_at.getTime() <= Date.now() || !job.result_manifest_uri)
      throw gone();
    const input = exportInputSchema.safeParse(job.request_spec);
    if (!input.success)
      throw new AppError(500, 'INVALID_EXPORT_METADATA', 'Invalid export metadata.');
    const format = exportFormats[input.data.format];
    if (
      !job.result_manifest_uri.startsWith(`${id}.`) ||
      !job.result_manifest_uri.endsWith(`.${format.extension}`)
    ) {
      throw new AppError(500, 'INVALID_EXPORT_METADATA', 'Invalid export metadata.');
    }
    try {
      const file = await localExportStorage.openDownload(job.result_manifest_uri);
      if (job.result_byte_size === null || BigInt(file.bytes) !== job.result_byte_size) {
        file.stream.destroy();
        throw new AppError(500, 'INVALID_EXPORT_METADATA', 'Invalid export metadata.');
      }
      logger.info({ jobId: id }, 'Export download started');
      return { ...file, mime: format.mime, filename: `firebridge-${id}.${format.extension}` };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        throw gone();
      throw error;
    }
  }
};
