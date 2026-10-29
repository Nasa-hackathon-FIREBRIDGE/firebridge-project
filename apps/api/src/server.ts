import { createApp } from './app.js';
import { disconnectRedis } from './config/redis.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectDatabase } from '@firebridge/database';

const app = createApp();
const port = env.PORT;
const server = app.listen(port, () => {
  logger.info(`FIREBRIDGE API listening on http://localhost:${port}`);
});

let shuttingDown = false;

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down FIREBRIDGE API');

  const forceCloseTimer = setTimeout(() => {
    logger.error('HTTP server shutdown timed out; closing active connections');
    server.closeAllConnections();
  }, 10000);
  forceCloseTimer.unref();

  server.close(async (error) => {
    clearTimeout(forceCloseTimer);
    if (error) {
      logger.error('HTTP server failed to close cleanly');
    }

    const results = await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    if (results.some((result) => result.status === 'rejected')) {
      logger.error('One or more infrastructure clients failed to close cleanly');
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
