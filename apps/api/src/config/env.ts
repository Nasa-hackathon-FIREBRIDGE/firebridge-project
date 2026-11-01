import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
dotenv.config({ path: rootEnvPath });

const DEFAULT_DEV_PAGINATION_SECRET = 'firebridge-dev-secret-key-32-chars-long';

const postgresUrlSchema = z
  .string()
  .url()
  .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol));
const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol));
const corsOriginsSchema = z
  .string()
  .default('')
  .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
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

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_NAME: z.string().min(1).default('firebridge-api'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    DATABASE_URL: postgresUrlSchema,
    REDIS_URL: redisUrlSchema,
    ANALYSIS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    CORS_ORIGINS: corsOriginsSchema,
    PAGINATION_SECRET: z.string().min(16).default(DEFAULT_DEV_PAGINATION_SECRET)
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production' && data.PAGINATION_SECRET === DEFAULT_DEV_PAGINATION_SECRET) {
        return false;
      }
      return true;
    },
    {
      message: 'PAGINATION_SECRET must be explicitly set to a custom secret in production.',
      path: ['PAGINATION_SECRET']
    }
  );

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const invalidVariables = [...new Set(parsedEnv.error.issues.map((issue) => issue.path.join('.')))];
  throw new Error(`Invalid environment configuration: ${invalidVariables.join(', ')}`);
}

export const env = parsedEnv.data;
