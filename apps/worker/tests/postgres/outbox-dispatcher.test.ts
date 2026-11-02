import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '@firebridge/database';
import { afterAll, describe, expect, it } from 'vitest';
import { createFirebridgeQueue } from '../../src/queues/firebridge-queue.js';
import { OutboxDispatcher } from '../../src/services/outbox-dispatcher.js';

describe('OutboxDispatcher', () => {
  const testQueueName = `test-queue-${randomUUID()}`;
  const testQueue = createFirebridgeQueue(testQueueName);
  let dispatcher = new OutboxDispatcher({
    queue: testQueue,
    aggregateIds: [randomUUID()],
    batchSize: 5,
    leaseSeconds: 15
  });

  afterAll(async () => {
    await dispatcher.stop();
    await testQueue.close();
    await disconnectDatabase();
  });

  it('claims pending outbox events using FOR UPDATE SKIP LOCKED and delivers them to queue', async () => {
    const eventId = randomUUID();
    dispatcher = new OutboxDispatcher({ queue: testQueue, batchSize: 5, leaseSeconds: 15, aggregateIds: [eventId] });
    const dedupeKey = `test:outbox:${eventId}`;
    const payload = { job_id: eventId };

    // Insert pending outbox event
    await prisma.$executeRaw`
      INSERT INTO firebridge.outbox_events (
        id, event_type, aggregate_id, dedupe_key, payload, status, attempts, available_at
      ) VALUES (
        ${eventId}::uuid,
        'export.requested',
        ${eventId},
        ${dedupeKey},
        ${JSON.stringify(payload)}::jsonb,
        'pending',
        0,
        now()
      );
    `;

    // Run a single dispatch batch
    const count = await dispatcher.dispatchBatch();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify database record transitioned to delivered
    const rows = await prisma.$queryRaw<
      { status: string; delivered_at: Date | null; lease_expires_at: Date | null }[]
    >`
      SELECT status, delivered_at, lease_expires_at
      FROM firebridge.outbox_events
      WHERE id = ${eventId}::uuid;
    `;

    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('delivered');
    expect(rows[0]?.delivered_at).not.toBeNull();
    expect(rows[0]?.lease_expires_at).toBeNull();

    // Verify job exists in BullMQ queue
    const sanitizedJobId = dedupeKey.replace(/:/g, '__');
    const job = await testQueue.getJob(sanitizedJobId);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(sanitizedJobId);
    expect(job?.name).toBe('export.requested');
  });

  it('reschedules with exponential backoff if queue delivery throws an error', async () => {
    const eventId = randomUUID();
    const dedupeKey = `test:outbox:fail:${eventId}`;

    // Insert pending event
    await prisma.$executeRaw`
      INSERT INTO firebridge.outbox_events (
        id, event_type, aggregate_id, dedupe_key, payload, status, attempts, available_at
      ) VALUES (
        ${eventId}::uuid,
        'export.requested',
        ${eventId},
        ${dedupeKey},
        ${JSON.stringify({ job_id: eventId })}::jsonb,
        'pending',
        0,
        now()
      );
    `;

    // Create a mock dispatcher with a failing queue
    const failingQueue = {
      add: async () => {
        throw new Error('Simulated Redis failure');
      }
    } as unknown as typeof testQueue;

    const failingDispatcher = new OutboxDispatcher({
      aggregateIds: [eventId],
      queue: failingQueue,
      batchSize: 10,
      leaseSeconds: 15
    });

    await failingDispatcher.dispatchBatch();

    // Verify event transitioned back to pending with attempts incremented and future available_at
    const rows = await prisma.$queryRaw<
      { status: string; attempts: number; available_at: Date; lease_expires_at: Date | null }[]
    >`
      SELECT status, attempts, available_at, lease_expires_at
      FROM firebridge.outbox_events
      WHERE id = ${eventId}::uuid;
    `;

    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.lease_expires_at).toBeNull();
    expect(new Date(rows[0]!.available_at).getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
