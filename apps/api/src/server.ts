import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase } from '@firebridge/database';
import { disconnectRedis } from './config/redis.js';

const app = createApp();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => app.server.closeAllConnections(), 10000);
  deadline.unref();
  try {
    await app.close();
    const results = await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    if (results.some((result) => result.status === 'rejected')) {
      app.log.error('One or more infrastructure clients failed to close');
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(deadline);
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void shutdown();
  });
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
