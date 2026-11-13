import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
dotenv.config({ path: rootEnvPath });

const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  REDIS_URL: redisUrlSchema,
  DATABASE_URL: z.string().optional(),
  HISTORY_SERVICE_URL: z.string().url().optional(),
  HISTORY_SERVICE_TOKEN: z.string().min(32).optional(),
  WORKER_AUTOSTART: z.enum(['true', 'false']).optional(),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(15).max(300).default(30),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  ANALYSIS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ANALYSIS_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(60),
  ANALYSIS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(5),
  RECOVERY_ENABLED: z.enum(['true', 'false']).default('false'),
  RECOVERY_CREATED_AFTER: z.preprocess((value) => value === '' ? undefined : value, z.iso.datetime({ offset: true }).optional()),
  RECOVERY_INTERVAL_MS: z.coerce.number().int().min(5000).max(3600000).default(30000),
  RECOVERY_STALE_SECONDS: z.coerce.number().int().min(30).max(86400).default(120),
  RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  RECOVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5)
}).refine((value) => !value.HISTORY_SERVICE_URL || !!value.HISTORY_SERVICE_TOKEN, { path: ['HISTORY_SERVICE_TOKEN'], message: 'Historical service requires authentication.' }).refine((value) => value.RECOVERY_ENABLED === 'false' || !!value.RECOVERY_CREATED_AFTER, {
  path: ['RECOVERY_CREATED_AFTER'], message: 'Recovery requires an explicit creation cutoff.'
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const invalidVariables = [...new Set(parsedEnv.error.issues.map((issue) => issue.path.join('.')))];
  throw new Error(`Invalid environment configuration: ${invalidVariables.join(', ')}`);
}

export const env = parsedEnv.data;
