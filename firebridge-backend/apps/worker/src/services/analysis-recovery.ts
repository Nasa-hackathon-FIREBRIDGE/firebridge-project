import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { bullJobId, FIREBRIDGE_QUEUE, retryDelayMs } from '../queues/firebridge-queue.js';
import { analysisJobSchema } from '../validators/queue-payload.js';

interface Candidate { id: string; analysis_id: string }
interface RecoveryJob {
  attempt: number;
  status: string;
  recovery_attempts: number;
}

export class AnalysisRecovery {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<number>;
  private running = false;
  readonly metrics = { recovered: 0, failures: 0, quarantined: 0 };

  constructor(private readonly queue: Queue, private readonly createdAfter: Date, private readonly aggregateIds?: readonly string[]) {
    if (!Number.isFinite(createdAfter.getTime())) throw new Error('Recovery requires a valid creation cutoff.');
    if (queue.name && queue.name !== FIREBRIDGE_QUEUE && !aggregateIds) throw new Error('Nonstandard recovery queues require an explicit aggregate scope.');
    if (aggregateIds && (!aggregateIds.length || aggregateIds.length > 100)) throw new Error('Invalid recovery aggregate scope.');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.pending;
  }

  reconcile(): Promise<number> {
    if (this.pending) return this.pending;
    this.pending = this.runBatch().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private eligibility() {
    const scope = this.aggregateIds ? Prisma.sql`AND a.id::text IN (${Prisma.join(this.aggregateIds)})` : Prisma.empty;
    return Prisma.sql`j.kind = 'analysis' AND j.created_at >= ${this.createdAfter} ${scope}
      AND j.completed_at IS NULL AND a.completed_at IS NULL AND a.status IN ('queued', 'running')
      AND ((j.status = 'queued' AND j.created_at <= now() - (${env.RECOVERY_STALE_SECONDS} * interval '1 second'))
        OR (j.status = 'running' AND (j.lease_expires_at <= now() OR j.lease_expires_at IS NULL)))
      AND coalesce((j.progress #>> '{recovery,attempts}')::int, 0) < ${env.RECOVERY_MAX_ATTEMPTS}
      AND coalesce((j.progress #>> '{recovery,next_at}')::timestamptz, j.created_at) <= now()
      AND NOT EXISTS (SELECT 1 FROM firebridge.outbox_events o WHERE o.event_type = 'analysis.requested'
        AND o.aggregate_id = a.id::text AND o.payload->>'job_id' = j.id::text AND o.status <> 'delivered')`;
  }

  private async runBatch(): Promise<number> {
    const candidates = await prisma.$queryRaw<Candidate[]>`
      SELECT j.id::text, j.analysis_id::text FROM firebridge.api_jobs j
      JOIN firebridge.analyses a ON a.id = j.analysis_id WHERE ${this.eligibility()}
      ORDER BY j.created_at, j.id LIMIT ${env.RECOVERY_BATCH_SIZE}
    `;
    let recovered = 0;
    for (const candidate of candidates) {
      // Redis commands are bounded at 2.5 seconds. Hold row locks across the check
      // and acknowledgement; a competing reconciler or processor must wait/skip.
      const result = await prisma.$transaction(async (tx) => {
        const analysis = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM firebridge.analyses WHERE id = ${candidate.analysis_id}::uuid FOR UPDATE SKIP LOCKED
        `;
        if (!analysis.length) return false;
        const [job] = await tx.$queryRaw<RecoveryJob[]>`
          SELECT j.attempt, j.status, coalesce((j.progress #>> '{recovery,attempts}')::int, 0) AS recovery_attempts
          FROM firebridge.api_jobs j JOIN firebridge.analyses a ON a.id = j.analysis_id
          WHERE j.id = ${candidate.id}::uuid AND ${this.eligibility()} FOR UPDATE OF j SKIP LOCKED
        `;
        if (!job) return false;
        const [event] = await tx.$queryRaw<{ dedupe_key: string; payload: unknown; status: string }[]>`
          SELECT dedupe_key, payload, status FROM firebridge.outbox_events
          WHERE event_type = 'analysis.requested' AND aggregate_id = ${candidate.analysis_id}
            AND payload->>'job_id' = ${candidate.id} ORDER BY created_at, id LIMIT 1
        `;
        // Pending/dispatching events remain the dispatcher's responsibility.
        if (event && event.status !== 'delivered') return false;
        let reason = 'missing_outbox_event';
        let action = 'quarantined';
        let enqueue = false;
        try {
          const parsed = analysisJobSchema.safeParse(event?.payload);
          if (event && parsed.success && parsed.data.job_id === candidate.id && parsed.data.analysis_id === candidate.analysis_id) {
            const id = bullJobId(event.dedupe_key);
            const queued = await this.queue.getJob(id);
            const state = queued ? await queued.getState() : 'missing';
            if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) {
              // Inspect again after a full stale window; don't consume recovery budget.
              await tx.$executeRaw`UPDATE firebridge.api_jobs SET progress = jsonb_set(progress, '{recovery}',
                ${JSON.stringify({ attempts: job.recovery_attempts, reason: 'queue_present', state,
                  next_at: new Date(Date.now() + env.RECOVERY_STALE_SECONDS * 1000).toISOString() })}::jsonb)
                WHERE id = ${candidate.id}::uuid`;
              return false;
            }
            if (state === 'completed') {
              // Legacy code could acknowledge BullMQ without consistent SQL results.
              // A completed Redis record with incomplete SQL needs manual review.
              reason = 'redis_completed_database_nonterminal';
            } else if (job.attempt >= env.ANALYSIS_MAX_ATTEMPTS) {
              reason = 'processing_attempts_exhausted';
            } else if (state === 'missing' || state === 'failed' || state === 'unknown') {
              reason = job.status === 'running' ? 'expired_processing_lease' : 'missing_or_failed_queue_job';
              if (queued && state === 'failed') await queued.retry('failed');
              else if (!queued) await this.queue.add('analysis.requested', parsed.data, {
                jobId: id, attempts: env.ANALYSIS_MAX_ATTEMPTS,
                backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
                removeOnComplete: true, removeOnFail: { age: 604800, count: 10000 }
              });
              else throw new Error('QUEUE_STATE_AMBIGUOUS');
              enqueue = true;
              action = 'reenqueued';
            } else reason = 'unsupported_queue_state';
          } else if (event) reason = 'invalid_outbox_payload';
        } catch {
          reason = 'redis_outcome_unacknowledged';
          action = 'retry_scheduled';
        }
        const attempts = action === 'quarantined' ? env.RECOVERY_MAX_ATTEMPTS : job.recovery_attempts + 1;
        await tx.$executeRaw`
          UPDATE firebridge.api_jobs SET
            status = CASE WHEN ${enqueue} THEN 'queued' ELSE status END,
            lease_expires_at = CASE WHEN ${enqueue} THEN NULL ELSE lease_expires_at END,
            progress = jsonb_set(progress, '{recovery}', ${JSON.stringify({ attempts, action, reason,
              at: new Date().toISOString(), next_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString() })}::jsonb)
          WHERE id = ${candidate.id}::uuid
        `;
        if (enqueue) {
          await tx.$executeRaw`UPDATE firebridge.analyses SET status = 'queued' WHERE id = ${candidate.analysis_id}::uuid`;
        }
        return { enqueue, action, reason, attempts };
      }, { timeout: 15000, maxWait: 3000 });
      if (result) {
        if (result.enqueue) { recovered++; this.metrics.recovered++; }
        else if (result.action === 'quarantined') this.metrics.quarantined++;
        else this.metrics.failures++;
        logger.warn({ apiJobId: candidate.id, analysisId: candidate.analysis_id, ...result }, 'Analysis reconciliation');
      }
    }
    return recovered;
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.reconcile().catch(() => logger.error('Analysis reconciliation cycle failed')).finally(() => {
        this.schedule(env.RECOVERY_INTERVAL_MS);
      });
    }, delay);
  }
}
