import { Queue, type QueueOptions } from 'bullmq';
import { env } from '../config/env.js';

export const FIREBRIDGE_QUEUE = 'firebridge-default';
export const EXPORT_QUEUE = 'firebridge-exports';

export function parseRedisConnection(redisUrl: string = env.REDIS_URL) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: Number(url.port) || 6379,
    db: Number(url.pathname.slice(1)) || 0,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  };
}

export function createFirebridgeQueue(
  queueName: string = FIREBRIDGE_QUEUE,
  redisUrl: string = env.REDIS_URL,
  options?: Partial<QueueOptions>
): Queue {
  return new Queue(queueName, {
    connection: { ...parseRedisConnection(redisUrl), maxRetriesPerRequest: 1,
      enableOfflineQueue: false, connectTimeout: 2500, commandTimeout: 2500 },
    ...options
  });
}

// Preserve IDs already persisted by the existing dispatcher.
export function bullJobId(dedupeKey: string): string {
  return dedupeKey.replace(/:/g, '__');
}

export function retryDelayMs(attempt: number): number {
  const cap = Math.min(1000 * 2 ** Math.min(Math.max(attempt, 1), 12), 3600000);
  return Math.round(cap / 2 + Math.random() * cap / 2);
}
