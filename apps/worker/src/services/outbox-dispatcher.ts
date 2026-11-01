/**
 * Transactional Outbox Dispatcher
 *
 * Implements reliable, concurrency-safe dispatch of events from `firebridge.outbox_events`
 * to BullMQ queue (`firebridge-default`) using PostgreSQL `FOR UPDATE SKIP LOCKED`.
 */

import { prisma } from '@firebridge/database';
import type { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface OutboxRecord {
  id: string;
  event_type: string;
  aggregate_id: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'dispatching' | 'delivered';
  attempts: number;
  available_at: Date;
  lease_expires_at: Date | null;
}

export interface OutboxDispatcherOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  queue: Queue;
}

export class OutboxDispatcher {
  private queue: Queue;
  private batchSize: number;
  private pollIntervalMs: number;
  private leaseSeconds: number;
  private isRunning: boolean = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentBatchPromise: Promise<number> | null = null;

  constructor(options: OutboxDispatcherOptions) {
    this.queue = options.queue;
    this.batchSize = options.batchSize ?? env.OUTBOX_BATCH_SIZE;
    this.pollIntervalMs = options.pollIntervalMs ?? env.OUTBOX_POLL_INTERVAL_MS;
    this.leaseSeconds = options.leaseSeconds ?? env.OUTBOX_LEASE_SECONDS;
  }

  /**
   * Starts the polling background dispatcher loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(
      { batchSize: this.batchSize, pollIntervalMs: this.pollIntervalMs },
      'Outbox dispatcher started'
    );
    this.scheduleNextPoll(0);
  }

  /**
   * Stops the dispatcher and waits for the current batch to conclude.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    if (this.currentBatchPromise) {
      await this.currentBatchPromise;
    }
    logger.info('Outbox dispatcher stopped');
  }

  /**
   * Claims and dispatches a single batch of due outbox events.
   * Concurrency-safe via PostgreSQL FOR UPDATE SKIP LOCKED.
   * Returns the count of events dispatched in this batch.
   */
  async dispatchBatch(): Promise<number> {
    // 1. Claim up to batchSize due events atomically
    const claimedEvents = await prisma.$queryRaw<OutboxRecord[]>`
      WITH due_events AS (
        SELECT id
        FROM firebridge.outbox_events
        WHERE (
          (status = 'pending' AND available_at <= now())
          OR
          (status = 'dispatching' AND lease_expires_at IS NOT NULL AND lease_expires_at <= now())
        )
        ORDER BY available_at ASC
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE firebridge.outbox_events o
      SET
        status = 'dispatching',
        attempts = o.attempts + 1,
        lease_expires_at = now() + (${this.leaseSeconds} * interval '1 second')
      FROM due_events
      WHERE o.id = due_events.id
      RETURNING
        o.id::text AS id,
        o.event_type,
        o.aggregate_id,
        o.dedupe_key,
        o.payload,
        o.status,
        o.attempts,
        o.available_at,
        o.lease_expires_at;
    `;

    if (!claimedEvents || claimedEvents.length === 0) {
      return 0;
    }

    logger.debug({ count: claimedEvents.length }, 'Claimed outbox events for dispatch');

    let dispatchedCount = 0;

    for (const event of claimedEvents) {
      try {
        // BullMQ does not allow colons in custom jobId (it uses ':' as an internal Redis key separator).
        // Transform colons safely to double-underscores for BullMQ deduplication.
        const bullJobId = event.dedupe_key.replace(/:/g, '__');

        // Enqueue to BullMQ with sanitized dedupe_key as BullMQ jobId for idempotency
        await this.queue.add(event.event_type, event.payload, {
          jobId: bullJobId,
          ...(event.event_type === 'ingestion.plan.requested'
            ? { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
            : {}),
          removeOnComplete: true,
          removeOnFail: false
        });

        // Mark as delivered
        await prisma.$executeRaw`
          UPDATE firebridge.outbox_events
          SET
            status = 'delivered',
            delivered_at = now(),
            lease_expires_at = NULL
          WHERE id = ${event.id}::uuid;
        `;

        dispatchedCount++;
        logger.info(
          { eventId: event.id, eventType: event.event_type, dedupeKey: event.dedupe_key },
          'Outbox event delivered to queue'
        );
      } catch (error) {
        logger.error(
          { err: error, eventId: event.id, dedupeKey: event.dedupe_key, attempts: event.attempts },
          'Failed to deliver outbox event to queue; scheduling retry'
        );

        // Exponential backoff: 2^attempts seconds, capped at 1 hour
        const backoffSeconds = Math.min(Math.pow(2, Math.max(1, event.attempts)), 3600);

        await prisma.$executeRaw`
          UPDATE firebridge.outbox_events
          SET
            status = 'pending',
            available_at = now() + (${backoffSeconds} * interval '1 second'),
            lease_expires_at = NULL
          WHERE id = ${event.id}::uuid;
        `;
      }
    }

    return dispatchedCount;
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isRunning) return;

    this.pollTimeout = setTimeout(() => {
      this.pollTimeout = null;
      this.currentBatchPromise = this.dispatchBatch()
        .then((dispatchedCount) => {
          // If events were dispatched, poll immediately for more; otherwise wait standard interval
          const nextDelay = dispatchedCount >= this.batchSize ? 50 : this.pollIntervalMs;
          this.scheduleNextPoll(nextDelay);
          return dispatchedCount;
        })
        .catch((error) => {
          logger.error({ err: error }, 'Error during outbox dispatch cycle');
          this.scheduleNextPoll(this.pollIntervalMs);
          return 0;
        })
        .finally(() => {
          this.currentBatchPromise = null;
        });
    }, delayMs);
  }
}
