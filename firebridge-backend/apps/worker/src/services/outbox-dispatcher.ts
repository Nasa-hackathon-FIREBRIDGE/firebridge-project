import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  bullJobId,
  EXPORT_QUEUE,
  FIREBRIDGE_QUEUE,
  retryDelayMs
} from '../queues/firebridge-queue.js';
import { parseQueuePayload } from '../validators/queue-payload.js';

export interface OutboxRecord {
  id: string;
  event_type: string;
  aggregate_id: string;
  dedupe_key: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxDispatcherOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  queue: Queue;
  exportQueue?: Queue;
  /** Limit integration tests to their own records. */
  aggregateIds?: readonly string[];
}

export class OutboxDispatcher {
  private readonly exportQueue: Queue;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly leaseSeconds: number;
  private isRunning = false;
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private currentBatchPromise?: Promise<number>;
  readonly metrics = {
    delivered: 0,
    retries: 0,
    exhausted: 0,
    leaseLost: 0,
    databaseAvailable: false
  };

  constructor(private readonly options: OutboxDispatcherOptions) {
    if (
      !options.aggregateIds &&
      ((options.queue.name && options.queue.name !== FIREBRIDGE_QUEUE) ||
        (options.exportQueue?.name && options.exportQueue.name !== EXPORT_QUEUE))
    ) {
      throw new Error('Nonstandard dispatch queues require an explicit aggregate scope.');
    }
    if (
      options.aggregateIds &&
      (!options.aggregateIds.length || options.aggregateIds.length > 100)
    ) {
      throw new Error('Invalid dispatcher aggregate scope.');
    }
    this.exportQueue = options.exportQueue ?? options.queue;
    this.batchSize = options.batchSize ?? env.OUTBOX_BATCH_SIZE;
    this.pollIntervalMs = options.pollIntervalMs ?? env.OUTBOX_POLL_INTERVAL_MS;
    this.leaseSeconds = options.leaseSeconds ?? env.OUTBOX_LEASE_SECONDS;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextPoll(0);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    clearTimeout(this.pollTimeout);
    await this.currentBatchPromise;
  }

  dispatchBatch(): Promise<number> {
    if (this.currentBatchPromise) return this.currentBatchPromise;
    this.currentBatchPromise = this.runBatch().finally(() => {
      this.currentBatchPromise = undefined;
    });
    return this.currentBatchPromise;
  }

  private async runBatch(): Promise<number> {
    let delivered = 0;
    for (let i = 0; i < this.batchSize; i++) {
      // Claim immediately before enqueue so a serial batch cannot consume later leases.
      const scope = this.options.aggregateIds
        ? Prisma.sql`AND aggregate_id IN (${Prisma.join(this.options.aggregateIds)})`
        : Prisma.empty;
      const [event] = await prisma.$queryRaw<OutboxRecord[]>`
        WITH due AS (
          SELECT id FROM firebridge.outbox_events
          WHERE attempts < ${env.OUTBOX_MAX_ATTEMPTS} AND (
            (status = 'pending' AND available_at <= now()) OR
            (status = 'dispatching' AND lease_expires_at <= now())
          ) ${scope}
          ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE firebridge.outbox_events o SET status = 'dispatching', attempts = o.attempts + 1,
          lease_expires_at = now() + (${this.leaseSeconds} * interval '1 second')
        FROM due WHERE o.id = due.id
        RETURNING o.id::text, o.event_type, o.aggregate_id, o.dedupe_key, o.payload, o.attempts
      `;
      this.metrics.databaseAvailable = true;
      if (!event) break;

      let valid = false;
      try {
        const payload = parseQueuePayload(event.event_type, event.payload);
        const aggregate = 'analysis_id' in payload ? payload.analysis_id : payload.job_id;
        // Explanation outboxes use the explanation identity, while their payload contains the job identity.
        if (event.event_type === 'explanation.requested') {
          const rows = await prisma.$queryRaw<
            { explanation_id: string }[]
          >`SELECT explanation_id::text FROM firebridge.api_jobs
            WHERE id=${payload.job_id}::uuid AND kind='explanation'`;
          if (rows[0]?.explanation_id !== event.aggregate_id.toLowerCase())
            throw new Error('QUEUE_AGGREGATE_MISMATCH');
        } else if (event.aggregate_id.toLowerCase() !== aggregate)
          throw new Error('QUEUE_AGGREGATE_MISMATCH');
        valid = true;
        const queue =
          event.event_type === 'export.requested' ? this.exportQueue : this.options.queue;
        await queue.add(event.event_type, payload, {
          jobId: bullJobId(event.dedupe_key),
          removeOnComplete: true,
          removeOnFail: { age: 604800, count: 10000 },
          attempts: event.event_type === 'export.requested' ? 3 : env.ANALYSIS_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 1000, jitter: 0.5 }
        });
        // Redis may commit even if add rejects; SQL acknowledgement may also fail.
        const updated = await prisma.$executeRaw`
          UPDATE firebridge.outbox_events SET status = 'delivered', delivered_at = now(), lease_expires_at = NULL
          WHERE id = ${event.id}::uuid AND status = 'dispatching' AND attempts = ${event.attempts}
            AND lease_expires_at > now()
        `;
        if (updated === 1) {
          delivered++;
          this.metrics.delivered++;
          logger.info({ eventId: event.id, eventType: event.event_type }, 'Outbox delivered');
        } else {
          this.metrics.leaseLost++;
          logger.warn({ eventId: event.id }, 'Outbox acknowledgement lost its lease');
        }
      } catch {
        const exhausted = !valid || event.attempts >= env.OUTBOX_MAX_ATTEMPTS;
        await prisma.$executeRaw`
          UPDATE firebridge.outbox_events SET status = 'pending', lease_expires_at = NULL,
            attempts = ${exhausted ? env.OUTBOX_MAX_ATTEMPTS : event.attempts},
            available_at = now() + (${retryDelayMs(event.attempts)} * interval '1 millisecond')
          WHERE id = ${event.id}::uuid AND status = 'dispatching' AND attempts = ${event.attempts}
            AND lease_expires_at > now()
        `;
        if (exhausted) this.metrics.exhausted++;
        else this.metrics.retries++;
        logger.warn(
          {
            eventId: event.id,
            eventType: event.event_type,
            attempt: event.attempts,
            reason: !valid ? 'invalid_payload' : 'delivery_unacknowledged',
            exhausted
          },
          'Outbox delivery failed'
        );
      }
    }
    return delivered;
  }

  private scheduleNextPoll(delay: number): void {
    if (!this.isRunning) return;
    this.pollTimeout = setTimeout(() => {
      void this.dispatchBatch()
        .then((count) => {
          this.scheduleNextPoll(count >= this.batchSize ? 50 : this.pollIntervalMs);
        })
        .catch(() => {
          this.metrics.databaseAvailable = false;
          logger.error('Outbox dispatch cycle failed');
          this.scheduleNextPoll(this.pollIntervalMs);
        });
    }, delay);
  }
}
