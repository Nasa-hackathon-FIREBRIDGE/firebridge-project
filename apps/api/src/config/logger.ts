import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  name: env.APP_NAME,
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(level) {
      return { level };
    }
  }
});