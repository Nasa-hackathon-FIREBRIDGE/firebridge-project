import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });
const defaultPaginationSecret = 'firebridge-dev-secret-key-32-chars-long';
const postgresUrl = z
  .string()
  .url()
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol));
const redisUrl = z
  .string()
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol));
const corsOrigins = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  )
  .refine((origins) =>
    origins.every((origin) => {
      try {
        const url = new URL(origin);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
      } catch {
        return false;
      }
    })
  );
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_NAME: z.string().min(1).default('firebridge-api'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: corsOrigins,
    PAGINATION_SECRET: z.string().min(16).default(defaultPaginationSecret),
    CURSOR_SECRET: z.string().min(32),
    INGESTION_ADMIN_TOKEN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(32).optional()
    ),
    DEFAULT_SCOPE_KEY: z.string().min(1).default('morocco'),
    MAX_AOI_VERTICES: z.coerce.number().int().positive().default(5000),
    MAX_AOI_AREA_KM2: z.coerce.number().positive().default(250000),
    MAX_EVIDENCE_CELL_DAYS: z.coerce.number().int().positive().default(2000),
    MAX_POINTS_PER_PAGE: z.coerce.number().int().positive().default(5000)
  })
  .refine(
    (data) => data.NODE_ENV !== 'production' || data.PAGINATION_SECRET !== defaultPaginationSecret,
    { path: ['PAGINATION_SECRET'], message: 'Set a custom pagination secret in production.' }
  );
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    'Invalid environment configuration: ' +
      [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ')
  );
}
export const env = parsed.data;
