import { prisma } from '@firebridge/database';
import type { Queue } from 'bullmq';
import { env } from '../config/env.js';

export async function collectWorkerMetrics(analysis: Queue, exports: Queue) {
  const [database, queues] = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      const [row] = await tx.$queryRaw<{
        oldestQueuedSeconds: number; oldestPendingOutboxSeconds: number; expiredJobLeases: number;
        expiredDispatchLeases: number; exhaustedOutbox: number;
      }[]>`
        SELECT coalesce((SELECT extract(epoch FROM now() - min(created_at))::float8
          FROM firebridge.api_jobs WHERE status = 'queued'), 0) AS "oldestQueuedSeconds",
          coalesce((SELECT extract(epoch FROM now() - min(created_at))::float8
          FROM firebridge.outbox_events WHERE status = 'pending'), 0) AS "oldestPendingOutboxSeconds",
          (SELECT count(*)::int FROM firebridge.api_jobs WHERE status = 'running'
            AND (lease_expires_at <= now() OR lease_expires_at IS NULL)) AS "expiredJobLeases",
          (SELECT count(*)::int FROM firebridge.outbox_events WHERE status = 'dispatching'
            AND lease_expires_at <= now()) AS "expiredDispatchLeases",
          (SELECT count(*)::int FROM firebridge.outbox_events WHERE status <> 'delivered'
            AND attempts >= ${env.OUTBOX_MAX_ATTEMPTS}) AS "exhaustedOutbox"
      `;
      return row;
    }, { timeout: 3000, maxWait: 1000 }),
    Promise.all([analysis.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      exports.getJobCounts('waiting', 'active', 'delayed', 'failed')])
  ]);
  return { sampledAt: new Date().toISOString(), databaseAvailable: database.status === 'fulfilled',
    redisAvailable: queues.status === 'fulfilled',
    ...(database.status === 'fulfilled' ? database.value : {}),
    ...(queues.status === 'fulfilled' ? { analysisQueue: queues.value[0], exportQueue: queues.value[1] } : {}) };
}
