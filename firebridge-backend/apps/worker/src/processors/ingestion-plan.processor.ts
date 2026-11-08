import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@firebridge/database';

export interface IngestionPlanPayload {
  job_id: string;
}
type Plan = {
  subscription_id: string;
  feed_id: string;
  area_id: string;
  scope_key: string;
  start: string;
  end_exclusive: string;
  adapter: string;
  adapter_version: string;
  query_basis: string;
  chunk_seconds: number;
  planned_chunks: number;
  source_ids: string[];
  products: string[];
  collection: string;
  resource_budget: { max_chunks: number; max_bytes: number };
};

/**
 * Durable bounded planner. It creates queued fetch attempts, never fabricated
 * fetch successes, observations, checkpoints or releases. Provider execution
 * is deliberately a separate stage; this repository has no fetch adapter yet.
 */
export async function processIngestionPlan(payload: IngestionPlanPayload): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(payload.job_id)) throw new Error('Invalid ingestion job identity.');
  try {
    await prisma.$transaction(
      async (tx) => {
        const jobs = await tx.$queryRaw<
          {
            status: string;
            kind: string;
            progress: { stage?: string };
            request_spec: { public_plan: Plan };
            attempt: number;
          }[]
        >`SELECT status,kind,progress,request_spec,attempt FROM firebridge.api_jobs
        WHERE id=${payload.job_id}::uuid FOR UPDATE`;
        const job = jobs[0];
        if (!job || !['backfill', 'refresh'].includes(job.kind))
          throw new Error('Invalid ingestion job.');
        if (job.status !== 'queued' && job.status !== 'failed') return;
        if (job.progress.stage === 'awaiting_fetch_executor') return;
        if (job.attempt >= 3) throw new Error('Ingestion planner attempts exhausted.');
        const plan = job.request_spec.public_plan;
        const start = Date.parse(plan?.start),
          end = Date.parse(plan?.end_exclusive);
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start >= end ||
          end > Date.now() ||
          !Number.isSafeInteger(plan.chunk_seconds) ||
          plan.chunk_seconds < 1 ||
          !Number.isSafeInteger(plan.planned_chunks) ||
          plan.planned_chunks < 1 ||
          plan.planned_chunks > 366 ||
          plan.planned_chunks > plan.resource_budget.max_chunks ||
          Math.ceil((end - start) / (plan.chunk_seconds * 1000)) !== plan.planned_chunks ||
          !Array.isArray(plan.source_ids) ||
          !plan.source_ids.length ||
          plan.query_basis !== 'observation_time'
        )
          throw new Error('Invalid bounded ingestion plan.');
        const subscriptions = await tx.$queryRaw<
          {
            feed_id: string;
            area_id: string;
            scope_key: string;
            state: string;
            verified_at: Date | null;
            adapter: string;
            adapter_version: string;
          }[]
        >`SELECT s.feed_id,s.area_id::text,s.scope_key,f.state,f.verified_at,f.adapter,f.adapter_version
        FROM firebridge.ingestion_subscriptions s JOIN firebridge.ingestion_feeds f ON f.id=s.feed_id
        WHERE s.id=${plan.subscription_id}::uuid FOR UPDATE OF s`;
        const sub = subscriptions[0];
        if (
          !sub ||
          sub.feed_id !== plan.feed_id ||
          sub.area_id !== plan.area_id ||
          sub.scope_key !== plan.scope_key ||
          sub.state !== 'active' ||
          !sub.verified_at ||
          sub.adapter !== plan.adapter ||
          sub.adapter_version !== plan.adapter_version
        )
          throw new Error('Subscription or feed changed before planning.');
        const sources = await tx.$queryRaw<{ id: string; product: string; collection: string }[]>`
        SELECT s.id,s.product,s.collection FROM firebridge.feed_sources fs
        JOIN firebridge.sources s ON s.id=fs.source_id WHERE fs.feed_id=${plan.feed_id}`;
        if (
          plan.source_ids.some(
            (id) =>
              !sources.some(
                (s) =>
                  s.id === id &&
                  s.collection === plan.collection &&
                  plan.products.includes(s.product)
              )
          )
        )
          throw new Error('Registered feed products changed before planning.');
        await tx.$executeRaw`UPDATE firebridge.api_jobs SET status='running',attempt=attempt+1,
        lease_expires_at=now()+interval '60 seconds',progress='{"stage":"planning_fetches"}'::jsonb,
        error_code=NULL WHERE id=${payload.job_id}::uuid`;
        const ids: string[] = [];
        for (let left = start; left < end; left += plan.chunk_seconds * 1000) {
          const right = Math.min(left + plan.chunk_seconds * 1000, end);
          const request = {
            start: new Date(left).toISOString(),
            end_exclusive: new Date(right).toISOString(),
            query_basis: plan.query_basis,
            source_ids: plan.source_ids,
            products: plan.products,
            collection: plan.collection,
            adapter: plan.adapter,
            adapter_version: plan.adapter_version,
            resource_budget: plan.resource_budget
          };
          const key = createHash('sha256').update(JSON.stringify(request)).digest('hex');
          const runs = await tx.$queryRaw<{ id: string; attempt: number; status: string }[]>`
          SELECT id::text,attempt,status FROM firebridge.fetch_runs
          WHERE subscription_id=${plan.subscription_id}::uuid AND request_key=${key}
          ORDER BY attempt DESC LIMIT 1`;
          if (runs[0] && ['queued', 'running'].includes(runs[0].status)) {
            ids.push(runs[0].id);
            continue;
          }
          const id = randomUUID();
          await tx.$executeRaw`INSERT INTO firebridge.fetch_runs
          (id,subscription_id,request_key,attempt,query_start,query_end_exclusive,query_basis,sanitized_request,status)
          VALUES(${id}::uuid,${plan.subscription_id}::uuid,${key},${(runs[0]?.attempt ?? 0) + 1},
            ${new Date(left)},${new Date(right)},'observation_time',${JSON.stringify(request)}::jsonb,'queued')`;
          ids.push(id);
        }
        // The plan is ready, but the requested ingestion has not happened.
        // Keep its durable job queued, with explicit progress and no completion date.
        const progress = JSON.stringify({
          stage: 'awaiting_fetch_executor',
          planned_chunks: ids.length,
          fetch_run_ids: ids,
          execution_support: 'planning_only',
          estimated_bytes: null,
          limitations: ['FETCH_ADAPTER_NOT_IMPLEMENTED', 'NO_DATA_FETCHED_OR_PUBLISHED']
        });
        await tx.$executeRaw`UPDATE firebridge.api_jobs SET status='queued',lease_expires_at=NULL,
        progress=${progress}::jsonb,completed_at=NULL WHERE id=${payload.job_id}::uuid`;
      },
      { timeout: 30000, maxWait: 5000 }
    );
  } catch {
    // Store only an application error code, never a provider URL or raw error body.
    await prisma.$executeRaw`UPDATE firebridge.api_jobs SET status='failed',attempt=LEAST(attempt+1,3),error_code='INGESTION_PLANNING_FAILED',
      lease_expires_at=NULL,progress='{"stage":"planning_failed"}'::jsonb
      WHERE id=${payload.job_id}::uuid AND kind IN ('backfill','refresh')
      AND status IN ('queued','running','failed')
      AND COALESCE(progress->>'stage','')<>'awaiting_fetch_executor'`;
    throw new Error('Ingestion planning failed.');
  }
}
