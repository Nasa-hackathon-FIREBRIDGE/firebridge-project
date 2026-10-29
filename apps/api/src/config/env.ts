import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
dotenv.config({ path: rootEnvPath });

const postgresUrlSchema = z
  .string()
  .url()
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol));
const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_NAME: z.string().default('firebridge-api'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema.optional(),
  DEFAULT_SCOPE_KEY: z.string().min(1).default('morocco'),
  CURSOR_SECRET: z.string().min(32),
  MAX_AOI_VERTICES: z.coerce.number().int().positive().default(5000),
  MAX_AOI_AREA_KM2: z.coerce.number().positive().default(250000),
  MAX_EVIDENCE_CELL_DAYS: z.coerce.number().int().positive().default(2000),
  MAX_POINTS_PER_PAGE: z.coerce.number().int().positive().default(5000)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const invalidVariables = [
    ...new Set(parsedEnv.error.issues.map((issue) => issue.path.join('.')))
  ];
  throw new Error(`Invalid environment configuration: ${invalidVariables.join(', ')}`);
}

export const env = parsedEnv.data;
