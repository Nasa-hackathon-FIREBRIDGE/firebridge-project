import { Queue, type QueueOptions } from 'bullmq';
import { env } from '../config/env.js';

export const FIREBRIDGE_QUEUE = 'firebridge-default';

export function getQueueName(): string {
  return FIREBRIDGE_QUEUE;
}

export function parseRedisConnection(redisUrl: string = env.REDIS_URL) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: Number(url.port) || 6379,
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
    connection: parseRedisConnection(redisUrl),
    ...options
  });
}
