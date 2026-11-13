import { configureFixtureEnvironment, inspectTestDatabase } from './environment.mjs';

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    console.info('Usage: node scripts/phase4/runtime.mjs api|worker. Isolated *_test infrastructure only; never seeds data.');
    return;
  }
  if (!['api', 'worker'].includes(mode) || process.argv.length !== 3) throw new Error('Expected api or worker.');
  const port = Number(process.env.PHASE4_TEST_PORT ?? '3104');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PHASE4_TEST_PORT.');
  const target = await configureFixtureEnvironment();
  await inspectTestDatabase(target);
  process.env.PORT = String(port);
  if (mode === 'worker') {
    // NODE_ENV=test prevents auto-start of the dispatcher. This explicit test
    // launcher starts the existing implementation after all target guards.
    const worker = await import('../../apps/worker/dist/worker.js');
    worker.startWorker();
    console.info('Isolated Phase 4 worker started. No seed is executed.');
    return;
  }
  const { createApp } = await import('../../apps/api/dist/app.js');
  const app = await createApp();
  await app.listen({ host: '127.0.0.1', port });
  console.info(`Local Phase 4 test API: http://127.0.0.1:${port}/api/v1 (no authentication).`);
  const stop = async () => {
    await app.close();
    const { disconnectDatabase } = await import('@firebridge/database');
    const { disconnectRedis } = await import('../../apps/api/dist/config/redis.js');
    await disconnectRedis();
    await disconnectDatabase();
  };
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
}

main().catch((error) => {
  console.error(error?.constructor === Error && !error.code ? error.message : `Controlled test runtime failure (${error?.name ?? 'unknown'}).`);
  process.exitCode = 1;
});
