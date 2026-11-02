import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.PHASE1_TEST_DATABASE_URL;
const redisUrl = process.env.PHASE1_TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error(
    'Set PHASE1_TEST_DATABASE_URL and PHASE1_TEST_REDIS_URL for the PostgreSQL suite.'
  );
}
if (decodeURIComponent(new URL(databaseUrl).pathname) !== '/firebridge_phase1_test') {
  throw new Error('The PostgreSQL fixture is restricted to database firebridge_phase1_test.');
}

export default defineConfig({
  test: {
    include: ['tests/postgres/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 10000,
    env: {
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:5173',
      EXPORT_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'firebridge-merged-results-test-')),
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      DEFAULT_SCOPE_KEY: 'phase1_test',
      CURSOR_SECRET: 'postgres-test-only-cursor-secret-at-least-32-characters',
      PAGINATION_SECRET: 'postgres-test-only-pagination-secret'
    }
  }
});
