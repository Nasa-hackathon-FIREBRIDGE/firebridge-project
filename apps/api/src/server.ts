import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase } from '@firebridge/database';
import { disconnectRedis } from './config/redis.js';

const app = createApp();
const SHUTDOWN_TIMEOUT_MS = 10000;
let shuttingDown = false;
async function shutdown(signal?: 'SIGINT' | 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down FIREBRIDGE API');
  const deadline = setTimeout(() => {
    app.log.error('HTTP server shutdown timed out; closing active connections');
    app.server.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS);
  deadline.unref();
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'HTTP server failed to close cleanly');
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    const results = await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    if (results.some((result) => result.status === 'rejected')) {
      app.log.error('One or more infrastructure clients failed to close');
      process.exitCode = 1;
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void shutdown(signal);
  });
try {
  await app.listen({
    port: env.PORT,
    host: '0.0.0.0',
    listenTextResolver: (address) => `FIREBRIDGE API listening on ${address}`
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
