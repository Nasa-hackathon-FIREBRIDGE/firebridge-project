import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { Queue, UnrecoverableError } from 'bullmq';
import { afterAll, beforeEach, describe, it, expect } from 'vitest';
import { disconnectDatabase } from '@firebridge/database';
import { processExplanation } from '../../src/processors/explanation.processor.js';
import { OutboxDispatcher } from '../../src/services/outbox-dispatcher.js';
import { parseRedisConnection } from '../../src/queues/firebridge-queue.js';
import { createDatabase } from '../../../api/src/repositories/database.js';
import { NativeResultsRepository } from '../../../api/src/repositories/native-results.repository.js';
import { ContextRepository } from '../../../api/src/repositories/context.repository.js';
import { NativeResultsService } from '../../../api/src/services/native-results.service.js';
import { ContextService } from '../../../api/src/services/context.service.js';
import { ExplanationService } from '../../../api/src/services/explanation.service.js';
import { seedNativeResults, nativeIds } from '../../../api/tests/helpers/native-fixture.js';

describe('Validated explanation worker on PostgreSQL and Redis', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const database = createDatabase(process.env.DATABASE_URL!);
  const settings = {
    CURSOR_SECRET: 'explanation-worker-test-secret-at-least-32-characters',
    MAX_EVIDENCE_CELL_DAYS: 2000,
    MAX_POINTS_PER_PAGE: 5000
  };
  const context = new ContextService(
    new ContextRepository(database),
    new NativeResultsService(new NativeResultsRepository(database), settings),
    settings
  );
  const service = new ExplanationService(context);
  const create = (question = '') =>
    service.create(
      nativeIds.analysis,
      { language: 'en', question },
      'test-actor',
      'worker-explanation-test'
    );
  beforeEach(async () => {
    await seedNativeResults(pool);
    // Outbox has no FK to releases; clean only after the fixture has verified the test database.
    await pool.query('TRUNCATE firebridge.outbox_events');
  });
  afterAll(async () => {
    await pool.end();
    await database.close();
    await disconnectDatabase();
  });
  it('generates a cited fallback and deduplicates concurrent/redelivered work', async () => {
    const created = await create('Explain the cause');
    const id = created.data.job_id;
    await Promise.all([processExplanation({ job_id: id }), processExplanation({ job_id: id })]);
    const detail = await service.get(created.data.explanation_id, 'test-actor');
    expect(detail.status).toBe('template_fallback');
    expect(detail.output).toMatchObject({
      generation_mode: 'deterministic_template',
      limitations: expect.arrayContaining([
        'EXTERNAL_LANGUAGE_MODEL_NOT_USED',
        'FREEFORM_QUESTION_NOT_ANSWERED_BY_TEMPLATE'
      ])
    });
    const job = (
      await pool.query('SELECT status,attempt FROM firebridge.api_jobs WHERE id=$1', [id])
    ).rows[0];
    expect(job).toEqual({ status: 'succeeded', attempt: 1 });
    expect(JSON.stringify(detail.output)).not.toMatch(/MAP_KEY|s3:\/\/|private|secret/);
  });
  it('rejects tampered snapshots without storing output or retrying validation failures', async () => {
    const created = await create();
    await pool.query(
      `UPDATE firebridge.evidence_snapshots SET evidence_json=jsonb_set(evidence_json,'{facts,0,value}','"999"')`
    );
    await expect(processExplanation({ job_id: created.data.job_id })).rejects.toBeInstanceOf(
      UnrecoverableError
    );
    expect(await service.get(created.data.explanation_id, 'test-actor')).toMatchObject({
      status: 'rejected',
      output: null
    });
    expect(
      (
        await pool.query('SELECT error_code FROM firebridge.api_jobs WHERE id=$1', [
          created.data.job_id
        ])
      ).rows[0].error_code
    ).toBe('EVIDENCE_VALIDATION_FAILED');
  });
  it('refuses stored output that no longer matches its validated evidence', async () => {
    const created = await create();
    await processExplanation({ job_id: created.data.job_id });
    await pool.query(
      `UPDATE firebridge.ai_explanations SET output_json='{"summary":"invented"}' WHERE id=$1`,
      [created.data.explanation_id]
    );
    await expect(service.get(created.data.explanation_id, 'test-actor')).rejects.toMatchObject({
      statusCode: 409,
      code: 'EXPLANATION_VALIDATION_FAILED'
    });
  });
  it('keeps a storage failure retryable and completes after storage recovers', async () => {
    const created = await create();
    await pool.query(`CREATE FUNCTION firebridge.phase6_fail_output() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='template_fallback' THEN RAISE EXCEPTION 'private storage failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER phase6_fail_output BEFORE UPDATE ON firebridge.ai_explanations
      FOR EACH ROW EXECUTE FUNCTION firebridge.phase6_fail_output()`);
    try {
      await expect(processExplanation({ job_id: created.data.job_id })).rejects.toThrow(
        'Explanation processing failed.'
      );
      expect((await service.get(created.data.explanation_id, 'test-actor')).status).toBe('failed');
      expect(
        (
          await pool.query('SELECT error_code FROM firebridge.api_jobs WHERE id=$1', [
            created.data.job_id
          ])
        ).rows[0].error_code
      ).toBe('EXPLANATION_PROCESSING_FAILED');
    } finally {
      await pool.query('DROP TRIGGER phase6_fail_output ON firebridge.ai_explanations');
      await pool.query('DROP FUNCTION firebridge.phase6_fail_output()');
    }
    await processExplanation({ job_id: created.data.job_id });
    expect((await service.get(created.data.explanation_id, 'test-actor')).status).toBe(
      'template_fallback'
    );
  });
  it('dispatches the committed request through real Redis with bounded retries', async () => {
    const created = await create();
    const queue = new Queue('phase6-test-' + randomUUID(), {
      connection: parseRedisConnection(process.env.REDIS_URL)
    });
    const dispatcher = new OutboxDispatcher({ queue, aggregateIds: [created.data.explanation_id] });
    try {
      expect(await dispatcher.dispatchBatch()).toBe(1);
      const event = (
        await pool.query(
          `SELECT status,dedupe_key FROM firebridge.outbox_events WHERE event_type='explanation.requested'`
        )
      ).rows[0];
      expect(event.status).toBe('delivered');
      const queued = await queue.getJob(event.dedupe_key);
      expect(queued?.name).toBe('explanation.requested');
      expect(queued?.opts.attempts).toBe(3);
      await processExplanation(queued!.data);
      expect((await service.get(created.data.explanation_id, 'test-actor')).status).toBe(
        'template_fallback'
      );
    } finally {
      await dispatcher.stop();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});
