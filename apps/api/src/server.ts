import { disconnectDatabase } from '@firebridge/database';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectRedis } from './config/redis.js';

const SHUTDOWN_TIMEOUT_MS = 10000;

async function main(): Promise<void> {
  const app = await createApp();
  const port = env.PORT;

  let shuttingDown = false;

  async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down FIREBRIDGE API');

    const forceCloseTimer = setTimeout(() => {
      logger.error('HTTP server shutdown timed out; closing active connections');
      app.server.closeAllConnections();
    }, SHUTDOWN_TIMEOUT_MS);
    forceCloseTimer.unref();

    try {
      await app.close();
    } catch (error) {
      logger.error({ err: error }, 'HTTP server failed to close cleanly');
      process.exitCode = 1;
    } finally {
      clearTimeout(forceCloseTimer);
    }

    const results = await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    if (results.some((result) => result.status === 'rejected')) {
      logger.error('One or more infrastructure clients failed to close cleanly');
      process.exitCode = 1;
    }
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({
    port,
    host: '0.0.0.0',
    // Fastify logs this once per bound address, through the same logger.
    listenTextResolver: (address) => `FIREBRIDGE API listening on ${address}`
  });
}

main().catch(async (error: unknown) => {
  logger.error({ err: error }, 'Failed to start FIREBRIDGE API');
  // Release infrastructure clients so a failed start does not leave open handles behind.
  await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
  process.exit(1);
});