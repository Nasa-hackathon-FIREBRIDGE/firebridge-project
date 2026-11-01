import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDatabase } from '@firebridge/database';
import { processIngestionPlan } from '../../src/processors/ingestion-plan.processor.js';
import { OutboxDispatcher } from '../../src/services/outbox-dispatcher.js';
import { parseRedisConnection } from '../../src/queues/firebridge-queue.js';
import { IngestionRepository } from '../../../api/src/repositories/ingestion.repository.js';
import { createDatabase } from '../../../api/src/repositories/database.js';
import { IngestionService } from '../../../api/src/services/ingestion.service.js';
import { parseInput, backfillSchema } from '../../../api/src/validators/ingestion.validator.js';
import { seedNativeResults } from '../../../api/tests/helpers/native-fixture.js';
import { backfillBody, seedIngestion } from '../../../api/tests/helpers/ingestion-fixture.js';

describe('Durable ingestion planner and outbox', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const database = createDatabase(process.env.DATABASE_URL!);
  const service = new IngestionService(new IngestionRepository(database), {
    CURSOR_SECRET: 'test-only-ingestion-worker-secret-at-least-32',
    MAX_AOI_AREA_KM2: 250000
  });
  const create = (key = 'planner-test-request-0001') =>
    service.backfill(parseInput(backfillSchema, backfillBody), 'test-ingestion-admin', key);
  beforeEach(async () => {
    await seedNativeResults(pool);
    await seedIngestion({ exec: (sql) => pool.query(sql) });
  });
  afterAll(async () => {
    await pool.end();
    await database.close();
    await disconnectDatabase();
  });
  it('plans bounded chunks without claiming a fetch, checkpoint advance or release publication', async () => {
    const created = await create();
    const id = created.data.job_id;
    const before = await pool.query('SELECT count(*) FROM firebridge.data_releases');
    await processIngestionPlan({ job_id: id });
    const rows = (
      await pool.query(
        'SELECT * FROM firebridge.fetch_runs WHERE subscription_id=$1 ORDER BY query_start',
        [created.data.subscription_id]
      )
    ).rows;
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) => r.status === 'queued' && r.enumeration_complete === false && r.record_count === null
      )
    ).toBe(true);
    expect(rows[0].query_start.toISOString()).toBe('2024-01-17T00:00:00.000Z');
    expect(rows[2].query_end_exclusive.toISOString()).toBe('2024-01-20T00:00:00.000Z');
    const job = (await pool.query('SELECT * FROM firebridge.api_jobs WHERE id=$1', [id])).rows[0];
    expect(job).toMatchObject({
      status: 'queued',
      attempt: 1,
      completed_at: null,
      lease_expires_at: null,
      progress: {
        stage: 'awaiting_fetch_executor',
        planned_chunks: 3,
        execution_support: 'planning_only'
      }
    });
    expect((await pool.query('SELECT count(*) FROM firebridge.data_releases')).rows[0].count).toBe(
      before.rows[0].count
    );
    expect(
      (
        await pool.query(
          'SELECT count(*) FROM firebridge.ingestion_checkpoints WHERE subscription_id=$1',
          [created.data.subscription_id]
        )
      ).rows[0].count
    ).toBe('0');
  });
  it('deduplicates redelivery and concurrent plans for the same configured window', async () => {
    const one = await create();
    const two = await create('planner-test-request-0002');
    await Promise.all([
      processIngestionPlan({ job_id: one.data.job_id }),
      processIngestionPlan({ job_id: one.data.job_id }),
      processIngestionPlan({ job_id: two.data.job_id })
    ]);
    expect(
      (
        await pool.query('SELECT count(*) FROM firebridge.fetch_runs WHERE subscription_id=$1', [
          one.data.subscription_id
        ])
      ).rows[0].count
    ).toBe('3');
  });
  it('rolls back a malformed stored plan and records only a sanitized failure', async () => {
    const created = await create();
    await pool.query(
      `UPDATE firebridge.api_jobs SET request_spec=jsonb_set(request_spec,
      '{public_plan,planned_chunks}','999') WHERE id=$1`,
      [created.data.job_id]
    );
    await expect(processIngestionPlan({ job_id: created.data.job_id })).rejects.toThrow(
      'Ingestion planning failed.'
    );
    const job = (
      await pool.query('SELECT status,attempt,error_code FROM firebridge.api_jobs WHERE id=$1', [
        created.data.job_id
      ])
    ).rows[0];
    expect(job).toEqual({ status: 'failed', attempt: 1, error_code: 'INGESTION_PLANNING_FAILED' });
    expect(
      (
        await pool.query('SELECT count(*) FROM firebridge.fetch_runs WHERE subscription_id=$1', [
          created.data.subscription_id
        ])
      ).rows[0].count
    ).toBe('0');
  });
  it('rejects a retired feed before creating attempts', async () => {
    const created = await create();
    await pool.query("UPDATE firebridge.ingestion_feeds SET state='retired' WHERE id='modis'");
    await expect(processIngestionPlan({ job_id: created.data.job_id })).rejects.toThrow(
      'Ingestion planning failed.'
    );
    expect(
      (
        await pool.query('SELECT count(*) FROM firebridge.fetch_runs WHERE subscription_id=$1', [
          created.data.subscription_id
        ])
      ).rows[0].count
    ).toBe('0');
  });
  it('delivers the committed planning request through real Redis before processing it', async () => {
    const created = await create();
    const queue = new Queue('phase5-test-' + randomUUID(), {
      connection: parseRedisConnection(process.env.REDIS_URL)
    });
    const dispatcher = new OutboxDispatcher({ queue });
    try {
      expect(await dispatcher.dispatchBatch()).toBe(1);
      const events = await prisma.$queryRaw<{ status: string; dedupe_key: string }[]>`
        SELECT status,dedupe_key FROM firebridge.outbox_events WHERE aggregate_id=${created.data.job_id}`;
      expect(events[0].status).toBe('delivered');
      const queued = await queue.getJob(events[0].dedupe_key);
      expect(queued?.name).toBe('ingestion.plan.requested');
      expect(queued?.opts.attempts).toBe(3);
      await processIngestionPlan(queued!.data);
      const job = (
        await pool.query('SELECT progress FROM firebridge.api_jobs WHERE id=$1', [
          created.data.job_id
        ])
      ).rows[0];
      expect(job.progress.stage).toBe('awaiting_fetch_executor');
    } finally {
      await dispatcher.stop();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});
