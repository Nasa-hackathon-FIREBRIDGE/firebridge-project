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
  PORT: z.coerce.number().default(3000),
  APP_NAME: z.string().default('firebridge-api'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const invalidVariables = [...new Set(parsedEnv.error.issues.map((issue) => issue.path.join('.')))];
  throw new Error(`Invalid environment configuration: ${invalidVariables.join(', ')}`);
}

export const env = parsedEnv.data;
