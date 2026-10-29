import { prisma } from '@firebridge/database';
import { pingRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import type { HealthStatus, ReadinessStatus } from '../types/api.js';

const readinessTimeoutMs = 3000;

/**
 * Phase 1 Readiness Integration Contract:
 * When Phase 1 implements catalogue/release publication, it registers a provider
 * implementing this interface to verify published releases are servable.
 */
export interface Phase1ReadinessProvider {
  isCatalogueServable(): Promise<boolean>;
}

export interface ReadinessProbes {
  database(): Promise<unknown>;
  redis(): Promise<unknown>;
}

let phase1ReadinessProvider: Phase1ReadinessProvider | null = null;

export function registerPhase1ReadinessProvider(provider: Phase1ReadinessProvider | null): void {
  phase1ReadinessProvider = provider;
}

export function getPhase1ReadinessProvider(): Phase1ReadinessProvider | null {
  return phase1ReadinessProvider;
}

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

  async getReadiness(
    provider = phase1ReadinessProvider,
    probes: Partial<ReadinessProbes> = {}
  ): Promise<ReadinessStatus> {
    const checksToRun: [Promise<unknown>, Promise<unknown>, Promise<boolean>?] = [
      withTimeout(probes.database ?? (() => prisma.$queryRaw`SELECT 1`)),
      withTimeout(probes.redis ?? (() => pingRedis()))
    ];

    if (provider) {
      checksToRun.push(withTimeout(() => provider.isCatalogueServable()));
    }

    const [databaseResult, redisResult, catalogueResult] = await Promise.allSettled(checksToRun);

    const databaseReady = databaseResult.status === 'fulfilled';
    // Redis PING returns the string "PONG" on success.
    const redisReady = redisResult.status === 'fulfilled' && redisResult.value === 'PONG';
    const catalogueReady = catalogueResult
      ? catalogueResult.status === 'fulfilled' && catalogueResult.value === true
      : true;

    if (!databaseReady) {
      logger.warn({ dependency: 'database' }, 'Readiness check failed');
    }
    if (!redisReady) {
      logger.warn({ dependency: 'redis' }, 'Readiness check failed');
    }
    if (catalogueResult && !catalogueReady) {
      logger.warn({ dependency: 'catalogue' }, 'Readiness check failed: catalogue not servable');
    }

    const ready = databaseReady && redisReady && catalogueReady;

    return {
      status: ready ? ('ok' as const) : ('error' as const),
      service: 'firebridge-api',
      checks: {
        database: databaseReady ? ('ready' as const) : ('unavailable' as const),
        redis: redisReady ? ('ready' as const) : ('unavailable' as const),
        // Worker health is surfaced through queue metrics; not checked here.
        workers: 'not_checked' as const,
        ...(provider
          ? { catalogue: catalogueReady ? ('ready' as const) : ('unavailable' as const) }
          : {})
      },
      timestamp: new Date().toISOString()
    };
  }
};
