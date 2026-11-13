import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  name: 'firebridge-worker',
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime
});
