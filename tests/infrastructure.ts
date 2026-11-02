import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import dotenv from 'dotenv';

/** Integration tests must never inherit the developer's database/Redis. */
export function configureTestInfrastructure(): boolean {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  const integration = process.env.RUN_INTEGRATION_TESTS === '1';
  process.env.EXPORT_STORAGE_DIR = mkdtempSync(resolve(tmpdir(), 'firebridge-exports-test-'));
  if (!integration) {
    process.env.DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/firebridge_unit_test';
    process.env.REDIS_URL = 'redis://127.0.0.1:1/15';
    return false;
  }
  const current = dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true }).parsed;
  const database = process.env.TEST_DATABASE_URL;
  const redis = process.env.TEST_REDIS_URL;
  if (!database || !redis) throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required.');
  const dbUrl = new URL(database);
  const redisUrl = new URL(redis);
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol) || !/\/[a-zA-Z0-9_]*_test$/.test(dbUrl.pathname)
    || !['redis:', 'rediss:'].includes(redisUrl.protocol) || !/^\/(?:[1-9]|1[0-5])$/.test(redisUrl.pathname)
    || database === current?.DATABASE_URL || redis === current?.REDIS_URL) {
    throw new Error('Integration tests require a separate *_test database and Redis DB 1-15.');
  }
  process.env.DATABASE_URL = database;
  process.env.REDIS_URL = redis;
  return true;
}
