import { defineConfig } from 'vitest/config';
const databaseUrl = process.env.PHASE1_TEST_DATABASE_URL;
const redisUrl = process.env.PHASE1_TEST_REDIS_URL;
if (
  !databaseUrl ||
  !redisUrl ||
  decodeURIComponent(new URL(databaseUrl).pathname) !== '/firebridge_phase1_test'
)
  throw new Error(
    'Worker integration tests require PHASE1_TEST_DATABASE_URL targeting firebridge_phase1_test and PHASE1_TEST_REDIS_URL.'
  );
export default defineConfig({
  test: {
    include: ['tests/postgres/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl, REDIS_URL: redisUrl }
  }
});
