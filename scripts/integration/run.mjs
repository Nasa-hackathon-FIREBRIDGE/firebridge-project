import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import { root, run, dockerExecutable } from '../audit/process.mjs';
dotenv.config({ path: resolve(root, '.env'), quiet: true });
const stamp = Date.now().toString();
const name = `firebridge_http_${stamp}_test`;
const base = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(base.hostname) || base.pathname !== '/firebridge') throw new Error('A local source configuration is required.');
const database = new URL(base); database.pathname = '/' + name; database.searchParams.delete('schema');
const redisUrl = new URL(process.env.REDIS_URL);
if (!['localhost', '127.0.0.1'].includes(redisUrl.hostname)) throw new Error('Local Redis required.');
let redisDatabase;
for (let i = 15; i >= 1; i--) {
  redisUrl.pathname = '/' + i;
  const probe = new Redis(redisUrl.href, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  try { if (await probe.dbsize() === 0) { await probe.set('firebridge:integration-reserved', stamp, 'NX'); redisDatabase = i; break; } }
  finally { await probe.quit(); }
}
if (!redisDatabase) throw new Error('No empty isolated Redis database is available. No keys were deleted.');
redisUrl.pathname = '/' + redisDatabase;
const directory = resolve(root, '.data/integration', 'http-' + stamp);
await mkdir(directory, { recursive: true });
await run(dockerExecutable(), ['exec', 'firebridge-postgres', 'createdb', '-U', 'firebridge', '-T', 'template0', name]);
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: database.href, REDIS_URL: redisUrl.href, PRISMA_MIGRATION_HISTORY: 'shared',
  PORT: '3301', API_HOST: '127.0.0.1', LOG_LEVEL: 'warn', CORS_ORIGINS: 'http://localhost:5173', DEFAULT_SCOPE_KEY: 'phase1_test',
  CURSOR_SECRET: 'isolated-http-tests-only-cursor-secret-at-least-32-chars', EXPORT_STORAGE_DIR: resolve(directory, 'exports'),
  OUTBOX_POLL_INTERVAL_MS: '200', EXPORT_MAX_ACTIVE: '2', EXPORT_MAX_PER_HOUR: '100', EXPORT_REQUESTS_PER_MINUTE: '100', WORKER_AUTOSTART: 'true', RECOVERY_ENABLED: 'false' };
await run(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', resolve(root, 'packages/database/prisma.config.ts')], { env, log: 'http-migrations-' + stamp + '.log' });
await run(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/integration/seed.mts'], { env, log: 'http-fixtures-' + stamp + '.log' });
const children = [];
function start(script, label) {
  const output = createWriteStream(resolve(directory, label + '.log'));
  const child = spawn(process.execPath, [script], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(output); child.stderr.pipe(output, { end: false });
  child.once('exit', () => output.end()); children.push(child); return child;
}
const api = start('apps/api/dist/server.js', 'api');
let succeeded = false;
try {
  const deadline = Date.now() + 15000;
  while (true) {
    try { const response = await fetch('http://127.0.0.1:3301/api/v1/health/live', { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch { /* bounded startup wait */ }
    if (Date.now() > deadline || api.exitCode !== null) throw new Error('Test API failed to start. See ' + directory);
    await new Promise((r) => setTimeout(r, 200));
  }
  start('apps/worker/dist/worker.js', 'worker');
  const frontend = resolve(root, '../front_firebridge-project');
  await run(process.execPath, [resolve(frontend, 'node_modules/vitest/vitest.mjs'), 'run', '--root', frontend, 'src/services/firebridge.integration.test.ts'], {
    env: { ...env, FIREBRIDGE_INTEGRATION_URL: 'http://127.0.0.1:3301/api/v1' }, log: 'http-frontend-' + stamp + '.log',
  });
  await run(process.execPath, ['scripts/integration/checks.mjs'], { env, log: 'http-checks-' + stamp + '.log' });
  succeeded = true;
  const report = { passed: true, database: name, redis_database: redisDatabase, api: 'http://127.0.0.1:3301/api/v1', logs: directory,
    fixture_data: 'Explicitly synthetic TEST ONLY observations in an isolated database', active_database_modified: false, real_http_axios_postgis_redis_worker: true };
  await writeFile(resolve(root, '.data/integration/http-result.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
} finally {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map((child) => child.exitCode !== null ? undefined : new Promise((done) => { child.once('exit', done); setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); done(); }, 10000).unref(); })));
  if (!succeeded) console.error('HTTP integration failed; isolated data and logs retained in ' + directory);
}
