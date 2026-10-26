import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();

const port = env.PORT;

app.listen(port, () => {
  logger.info(`FIREBRIDGE API listening on http://localhost:${port}`);
});
