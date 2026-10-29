import { prisma } from '@firebridge/database';
import { pingRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import type { HealthStatus, ReadinessStatus } from '../types/api.js';

const readinessTimeoutMs = 3000;

/**
 * Wraps an async operation with a bounded timeout.
 * The timer is unref'd so it does not prevent the Node.js process from exiting
 * during tests when all other work is complete.
 */
function withTimeout<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Readiness check timed out')),
      readinessTimeoutMs
    );
    // Prevent the timer from keeping the event loop alive (important in test environments).
    timer.unref();

    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
  });
}

export const healthService = {
  getLiveStatus: (): HealthStatus => ({
    status: 'ok',
    service: 'firebridge-api',
    uptimeMs: process.uptime() * 1000,
    timestamp: new Date().toISOString()
  }),

  async getReadiness(): Promise<ReadinessStatus> {
    const [databaseResult, redisResult] = await Promise.allSettled([
      withTimeout(() => prisma.$queryRaw`SELECT 1`),
      withTimeout(() => pingRedis())
    ]);

    const databaseReady = databaseResult.status === 'fulfilled';
    // Redis PING returns the string "PONG" on success.
    const redisReady = redisResult.status === 'fulfilled' && redisResult.value === 'PONG';

    if (!databaseReady) {
      logger.warn({ dependency: 'database' }, 'Readiness check failed');
    }
    if (!redisReady) {
      logger.warn({ dependency: 'redis' }, 'Readiness check failed');
    }

    const ready = databaseReady && redisReady;

    return {
      status: ready ? ('ok' as const) : ('error' as const),
      service: 'firebridge-api',
      checks: {
        database: databaseReady ? ('ready' as const) : ('unavailable' as const),
        redis: redisReady ? ('ready' as const) : ('unavailable' as const),
        // Worker health is surfaced through queue metrics; not checked here.
        workers: 'not_checked' as const
      },
      timestamp: new Date().toISOString()
    };
  }
};
