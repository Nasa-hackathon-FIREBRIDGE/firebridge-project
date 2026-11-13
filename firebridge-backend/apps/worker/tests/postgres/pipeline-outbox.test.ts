import { randomUUID } from 'node:crypto';
import { prisma, disconnectDatabase } from '@firebridge/database';
import type { Queue } from 'bullmq';
import { afterAll, expect, it, vi } from 'vitest';
import { OutboxDispatcher } from '../../src/services/outbox-dispatcher.js';

it('leaves data-publication events untouched while dispatching application work', async () => {
  const id = randomUUID();
  const aggregate = randomUUID();
  const add = vi.fn();
  await prisma.$executeRaw`INSERT INTO firebridge.outbox_events
    (id,event_type,aggregate_id,dedupe_key,payload,status,available_at)
    VALUES(${id}::uuid,'release.published',${aggregate},${'pipeline-test-'+id},'{}'::jsonb,'pending',now())`;
  try {
    const dispatcher = new OutboxDispatcher({
      queue: { add } as unknown as Queue, aggregateIds: [aggregate], batchSize: 1
    });
    expect(await dispatcher.dispatchBatch()).toBe(0);
    expect(add).not.toHaveBeenCalled();
    const rows = await prisma.$queryRaw<{ status: string; attempts: number }[]>`
      SELECT status,attempts FROM firebridge.outbox_events WHERE id=${id}::uuid`;
    expect(rows[0]).toEqual({ status: 'pending', attempts: 0 });
  } finally {
    await prisma.$executeRaw`DELETE FROM firebridge.outbox_events WHERE id=${id}::uuid`;
  }
});

afterAll(() => disconnectDatabase());
