import './config/env.js';
import { logger } from './config/logger.js';

logger.info('FIREBRIDGE worker started');

export const workerStatus = {
  status: 'running',
  service: 'firebridge-worker',
  startedAt: new Date().toISOString()
};
