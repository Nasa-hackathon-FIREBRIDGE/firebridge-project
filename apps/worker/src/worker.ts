import './config/env.js';
import { logger } from './config/logger.js';

logger.warn('FIREBRIDGE worker has no registered processors; no jobs are being consumed');

export const workerStatus = {
  status: 'not_configured',
  service: 'firebridge-worker',
  startedAt: new Date().toISOString()
};
