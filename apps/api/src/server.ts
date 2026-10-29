import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exitCode = 0;
  });
}
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
