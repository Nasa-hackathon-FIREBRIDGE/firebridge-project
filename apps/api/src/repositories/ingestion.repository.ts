import type { SnapshotDatabase, SqlReader } from './database.js';
import { ApiError } from '../utils/response.js';
import type { GapsQuery, SubscriptionsQuery } from '../validators/ingestion.validator.js';

export type Feed = {
  id: string;
  adapter: string;
  adapter_version: string;
  state: string;
  verified_at: string | null;
  credential_ref: string | null;
  capability_spec: Record<string, unknown>;
};
export type Subscription = {
  id: string;
  feed_id: string;
  area_id: string;
  scope_key: string;
  mode: string;
  interval_seconds: number;
  overlap_seconds: number;
  history_start: string;
  fixed_end_exclusive: string | null;
  request_config: Record<string, unknown>;
  config_sha256: string;
  enabled: boolean;
  next_due_at: string | null;
};
export type IngestionJob = {
  id: string;
  kind: string;
  request_hash: string;
  request_spec: Record<string, unknown>;
  status: string;
};
export const gapStatus = `CASE WHEN f.state='retired' AND g.status IN ('open','retrying')
  THEN 'accepted_unavailable' ELSE g.status END`;

export class IngestionRepository {
  constructor(private database: SnapshotDatabase) {}
  read<T>(fn: (db: SqlReader) => Promise<T>) {
    return this.database.snapshot(fn);
  }
  write<T>(fn: (db: SqlReader) => Promise<T>) {
    if (!this.database.transaction)
      throw new ApiError(503, 'WRITES_UNAVAILABLE', 'Transactional writes are unavailable.');
    return this.database.transaction(fn);
  }
  async feed(db: SqlReader, id: string) {
    return (
      await db.query<Feed>(
        `SELECT id,adapter,adapter_version,state,
      verified_at::text,credential_ref,capability_spec FROM firebridge.ingestion_feeds WHERE id=$1`,
        [id]
      )
    )[0];
  }
  async subscription(db: SqlReader, id: string) {
    return (
      await db.query<Subscription>(
        `SELECT id::text,feed_id,area_id::text,scope_key,mode,
      interval_seconds,overlap_seconds,history_start::text,fixed_end_exclusive::text,
      request_config,config_sha256,enabled,next_due_at::text
      FROM firebridge.ingestion_subscriptions WHERE id=$1::uuid`,
        [id]
      )
    )[0];
  }
  async job(db: SqlReader, actor: string, key: string) {
    // The lock and subsequent read share the write transaction. READ COMMITTED
    // makes a concurrent winner visible after waiting for its commit.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'ingestion:' + actor + ':' + key
    ]);
    return (
      await db.query<IngestionJob>(
        `SELECT id::text,kind,request_hash,request_spec,status
      FROM firebridge.api_jobs WHERE requested_by=$1 AND idempotency_key=$2`,
        [actor, key]
      )
    )[0];
  }
  async sources(db: SqlReader, feed: string) {
    return db.query<{ id: string; product: string; collection: string }>(
      `SELECT s.id,s.product,s.collection
      FROM firebridge.feed_sources fs JOIN firebridge.sources s ON s.id=fs.source_id
      WHERE fs.feed_id=$1 ORDER BY s.id`,
      [feed]
    );
  }
  async subscriptions(db: SqlReader, q: SubscriptionsQuery, after: string) {
    return db.query<
      Subscription & {
        adapter: string;
        adapter_version: string;
        state: string;
        credential_ref: string | null;
        checkpoints: unknown[];
        last_run: unknown;
        open_gaps: string;
      }
    >(
      `SELECT s.id::text,s.feed_id,s.area_id::text,s.scope_key,s.mode,s.interval_seconds,
      s.overlap_seconds,s.history_start::text,s.fixed_end_exclusive::text,s.enabled,
      s.next_due_at::text,s.config_sha256,s.request_config,
      f.adapter,f.adapter_version,f.state,f.credential_ref,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('stage',c.stage,'cursor_basis',c.cursor_basis,
        'committed_until',c.committed_until,'generation',c.generation::text,'updated_at',c.updated_at)
        ORDER BY c.stage) FROM firebridge.ingestion_checkpoints c WHERE c.subscription_id=s.id),'[]') AS checkpoints,
      (SELECT jsonb_build_object('id',r.id,'status',r.status,'started_at',r.started_at,
        'completed_at',r.completed_at,'record_count',r.record_count::text)
        FROM firebridge.fetch_runs r WHERE r.subscription_id=s.id
        ORDER BY COALESCE(r.started_at,r.completed_at) DESC NULLS LAST,r.id DESC LIMIT 1) AS last_run,
      (SELECT count(*)::text FROM firebridge.ingestion_gaps g
        WHERE g.subscription_id=s.id AND g.status IN ('open','retrying') AND f.state<>'retired') AS open_gaps
      FROM firebridge.ingestion_subscriptions s JOIN firebridge.ingestion_feeds f ON f.id=s.feed_id
      WHERE ($1::text IS NULL OR s.scope_key=$1) AND ($2::text IS NULL OR s.feed_id=$2)
        AND ($3::text IS NULL OR s.mode=$3) AND ($4::text IS NULL OR f.state=$4)
        AND ($5::boolean IS NULL OR s.enabled=$5) AND s.id>$6::uuid
      ORDER BY s.id LIMIT $7`,
      [
        q.scope_key ?? null,
        q.feed_id ?? null,
        q.mode ?? null,
        q.state ?? null,
        q.enabled === undefined ? null : q.enabled === 'true',
        after,
        q.limit + 1
      ]
    );
  }
  async gaps(db: SqlReader, q: GapsQuery, after: string, source?: string) {
    return db.query<Record<string, unknown>>(
      `SELECT g.id::text,g.subscription_id::text,
      s.scope_key,s.feed_id,g.gap_start::text AS start,g.gap_end_exclusive::text AS end_exclusive,
      CASE WHEN f.state='retired' THEN 'retired_source' ELSE g.kind END AS kind,
      ${gapStatus} AS status,g.discovered_at::text,g.last_attempt_at::text,
      CASE WHEN f.state='retired' THEN NULL ELSE g.retry_after::text END AS next_retry_at,
      g.resolved_by_run_id::text,
      COALESCE((SELECT jsonb_agg(fs.source_id ORDER BY fs.source_id) FROM firebridge.feed_sources fs
        WHERE fs.feed_id=s.feed_id AND (
          NOT (g.evidence ? 'source_ids') OR g.evidence->'source_ids' ? fs.source_id)), '[]') AS source_ids,
      count(*) OVER()::text AS total
      FROM firebridge.ingestion_gaps g JOIN firebridge.ingestion_subscriptions s ON s.id=g.subscription_id
      JOIN firebridge.ingestion_feeds f ON f.id=s.feed_id
      WHERE ($1::text IS NULL OR s.scope_key=$1) AND ($2::text IS NULL OR s.feed_id=$2)
        AND ($3::text IS NULL OR (${gapStatus})=$3)
        AND ($4::timestamptz IS NULL OR g.gap_end_exclusive>$4::timestamptz)
        AND ($5::timestamptz IS NULL OR g.gap_start<$5::timestamptz)
        AND g.id>$6::uuid
        AND ($8::text IS NULL OR (
          EXISTS(SELECT 1 FROM firebridge.feed_sources fs WHERE fs.feed_id=s.feed_id AND fs.source_id=$8)
          AND (NOT (g.evidence ? 'source_ids') OR g.evidence->'source_ids' ? $8)))
      ORDER BY g.id LIMIT $7`,
      [
        q.scope_key ?? null,
        q.feed_id ?? null,
        q.status ?? null,
        q.start ?? null,
        q.end_exclusive ?? null,
        after,
        q.limit + 1,
        source ?? null
      ]
    );
  }
}
