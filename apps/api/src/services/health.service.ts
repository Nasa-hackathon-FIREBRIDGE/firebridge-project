import type { HealthStatus } from '../types/api.js';

export const healthService = {
  getLiveStatus: (): HealthStatus => ({
    status: 'ok',
    service: 'firebridge-api',
    uptimeMs: process.uptime() * 1000,
    timestamp: new Date().toISOString()
  })
};
