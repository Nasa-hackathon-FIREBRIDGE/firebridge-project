import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const parsed = z.object({
  TILE_MAX_ZOOM: z.coerce.number().int().min(0).max(22).default(18),
  TILE_CACHE_SECONDS: z.coerce.number().int().min(1).max(300).default(60),
  TILE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  TILE_MAX_BYTES: z.coerce.number().int().min(1024).max(16777216).default(2097152),
  TILE_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(120),
  EXPORT_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(5),
  DOWNLOAD_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
  EXPORT_MAX_ACTIVE: z.coerce.number().int().min(1).max(20).default(2),
  EXPORT_MAX_PER_HOUR: z.coerce.number().int().min(1).max(100).default(10),
  EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(10000000).default(1000000),
  EXPORT_MAX_BYTES: z.coerce.number().int().min(1024).max(2147483648).default(268435456),
  EXPORT_MAX_DURATION_SECONDS: z.coerce.number().int().min(5).max(1800).default(300),
  EXPORT_RETENTION_SECONDS: z.coerce.number().int().min(60).max(2592000).default(86400),
  EXPORT_BATCH_SIZE: z.coerce.number().int().min(1).max(2000).default(1000),
  EXPORT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  EXPORT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  EXPORT_STORAGE_DIR: z.string().min(1).default(resolve(dirname(fileURLToPath(import.meta.url)), '../../../.data/exports'))
}).safeParse(process.env);

if (!parsed.success) throw new Error('Invalid Phase 4 configuration.');
export const resultsConfig = parsed.data;
