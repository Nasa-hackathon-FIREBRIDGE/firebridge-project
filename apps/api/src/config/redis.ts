import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  connectTimeout: 2500,
  commandTimeout: 2500,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: () => null
});

let connectionPromise: Promise<void> | undefined;

redis.on('error', (error) => {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  logger.error({ code }, 'Redis connection error');
});

export async function ensureRedisConnected(): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }

  if (redis.status !== 'wait' && redis.status !== 'end' && !connectionPromise) {
    throw new Error('Redis client is not available');
  }

  if (!connectionPromise) {
    connectionPromise = redis.connect().finally(() => {
      connectionPromise = undefined;
    });
  }

  await connectionPromise;
}

export async function pingRedis(): Promise<string> {
  await ensureRedisConnected();
  return redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit();
  } else if (redis.status !== 'end') {
    redis.disconnect();
  }
}
