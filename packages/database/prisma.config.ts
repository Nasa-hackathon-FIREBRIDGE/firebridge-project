import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
dotenv.config({ path: rootEnvPath });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL')
  }
});
