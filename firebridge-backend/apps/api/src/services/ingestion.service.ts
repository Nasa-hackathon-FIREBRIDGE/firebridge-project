import { createHash, randomUUID } from 'node:crypto';
import {
  IngestionRepository,
  gapStatus,
  type Feed,
  type IngestionJob
} from '../repositories/ingestion.repository.js';
import type { SqlReader } from '../repositories/database.js';
import { ApiError } from '../utils/response.js';
import { CursorCodec } from '../utils/cursor.js';
import {
  validateWindow,
  type BackfillInput,
  type RefreshInput,
  type SubscriptionsQuery,
  type GapsQuery,
  type AvailabilityQuery
} from '../validators/ingestion.validator.js';

const ZERO = '00000000-0000-0000-0000-000000000000';
const MAX_WINDOW_SECONDS = 366 * 86400;
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function credentialsConfigured(feed: Pick<Feed, 'credential_ref'>) {
  if (!feed.credential_ref) return true;
  const name = /^env:([A-Z][A-Z0-9_]{0,127})$/.exec(feed.credential_ref)?.[1];
  return !!name && !!process.env[name];
}
type Plan = {
  subscription_id: string;
  feed_id: string;
  scope_key: string;
  area_id: string;
  start: string;
  end_exclusive: string;
  source_ids: string[];
  products: string[];
  collection: string;
  adapter: string;
  adapter_version: string;
  query_basis: 'observation_time';
  chunk_seconds: number;
  planned_chunks: number;
  resource_budget: BackfillInput['resource_budget'];
  estimated_bytes: null;
  missing_access_requirements: string[];
  execution_support: 'planning_only';
};

export class IngestionService {
  private cursor: CursorCodec;
  constructor(
    private repository: IngestionRepository,
    settings: { CURSOR_SECRET: string; MAX_AOI_AREA_KM2: number }
  ) {
    this.cursor = new CursorCodec(settings.CURSOR_SECRET);
    this.maxArea = settings.MAX_AOI_AREA_KM2;
  }
  private maxArea: number;
  private pageBinding(endpoint: string, query: object, actor: string) {
    const filters = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'cursor'));
    return {
      release_id: digest({ endpoint, filters, actor }),
      membership: endpoint,
      limit: Number(filters.limit)
    };
  }
  async subscriptions(q: SubscriptionsQuery, actor: string) {
    const binding = this.pageBinding('ingestion-subscriptions', q, actor);
    const after = q.cursor ? this.cursor.decode(q.cursor, binding)[0] : ZERO;
    this.checkPosition(after);
    return this.repository.read(async (db) => {
      const rows = await this.repository.subscriptions(db, q, after);
      const selected = rows.slice(0, q.limit);
      return {
        subscriptions: selected.map((row) => ({
          id: row.id,
          feed_id: row.feed_id,
          area_id: row.area_id,
          scope_key: row.scope_key,
          mode: row.mode,
          interval_seconds: row.interval_seconds,
          overlap_seconds: row.overlap_seconds,
          history_start: row.history_start,
          fixed_end_exclusive: row.fixed_end_exclusive,
          enabled: row.enabled,
          next_due_at: row.state === 'retired' ? null : row.next_due_at,
          feed_state: row.state,
          adapter: row.adapter,
          adapter_version: row.adapter_version,
          credentials: credentialsConfigured(row) ? 'configured' : 'not_configured',
          checkpoints: row.checkpoints,
          last_run: row.last_run,
          open_gaps: row.open_gaps,
          scheduling_support: 'manual_requests_only'
        })),
        returned: selected.length,
        next_cursor:
          rows.length > q.limit
            ? this.cursor.encode({ ...binding, after: [selected.at(-1)!.id, ''] })
            : null
      };
    });
  }
  private checkPosition(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      fail(422, 'INVALID_CURSOR', 'Invalid cursor position.');
  }
  async gaps(q: GapsQuery, actor: string) {
    validateWindow(q.start, q.end_exclusive);
    const binding = this.pageBinding('ingestion-gaps', q, actor);
    const after = q.cursor ? this.cursor.decode(q.cursor, binding)[0] : ZERO;
    this.checkPosition(after);
    return this.repository.read(async (db) => {
      const rows = await this.repository.gaps(db, q, after);
      const selected = rows.slice(0, q.limit).map(({ total: _total, ...row }) => row);
      return {
        gaps: selected,
        returned: selected.length,
        next_cursor:
          rows.length > q.limit
            ? this.cursor.encode({ ...binding, after: [String(selected.at(-1)!.id), ''] })
            : null
      };
    });
  }
  private async readyFeed(db: SqlReader, id: string) {
    const feed = await this.repository.feed(db, id);
    if (!feed) return fail(404, 'FEED_NOT_FOUND', 'Registered feed not found.');
    if (feed.state !== 'active' || !feed.verified_at)
      return fail(
        409,
        'FEED_NOT_READY',
        'The feed must be active and verified before requesting work.'
      );
    return feed;
  }
  private async plan(
    db: SqlReader,
    feed: Feed,
    input: BackfillInput
  ): Promise<Omit<Plan, 'subscription_id'>> {
    validateWindow(input.start, input.end_exclusive);
    const start = Date.parse(input.start),
      end = Date.parse(input.end_exclusive);
    if (end > Date.now()) fail(422, 'INVALID_WINDOW', 'A fetch window cannot end in the future.');
    const spec = feed.capability_spec.ingestion_v1 as Record<string, unknown> | undefined;
    const chunkSeconds = Number(spec?.max_chunk_seconds);
    const maxWindowSeconds = Number(spec?.max_window_seconds);
    if (
      !spec ||
      spec.query_basis !== 'observation_time' ||
      !Number.isSafeInteger(chunkSeconds) ||
      chunkSeconds < 1 ||
      chunkSeconds > MAX_WINDOW_SECONDS ||
      !Number.isSafeInteger(maxWindowSeconds) ||
      maxWindowSeconds < 1
    )
      fail(
        409,
        'FEED_CAPABILITIES_REQUIRED',
        'Verified bounded ingestion capabilities are required.'
      );
    const duration = (end - start) / 1000;
    if (duration > Math.min(maxWindowSeconds, MAX_WINDOW_SECONDS))
      fail(422, 'WINDOW_TOO_LARGE', 'The request exceeds the bounded feed window.');
    const chunks = Math.ceil(duration / chunkSeconds);
    if (chunks > input.resource_budget.max_chunks)
      fail(
        422,
        'RESOURCE_BUDGET_EXCEEDED',
        'The planned chunk count exceeds the requested budget.'
      );
    const areas = await db.query<{ area_km2: number }>(
      `SELECT ST_Area(geom::geography)/1000000 AS area_km2
      FROM firebridge.areas WHERE id=$1::uuid`,
      [input.area_id]
    );
    if (!areas.length) fail(404, 'AREA_NOT_FOUND', 'Registered area not found.');
    const feedArea =
      typeof spec?.max_area_km2 === 'number' &&
      Number.isFinite(spec.max_area_km2) &&
      spec.max_area_km2 > 0
        ? spec.max_area_km2
        : this.maxArea;
    if (areas[0].area_km2 > Math.min(this.maxArea, feedArea))
      fail(422, 'AREA_TOO_LARGE', 'The area exceeds the supported resource budget.');
    const scope = await db.query(
      `SELECT 1 FROM firebridge.ingestion_subscriptions
      WHERE scope_key=$1 AND area_id=$2::uuid UNION ALL
      SELECT 1 FROM firebridge.data_releases WHERE scope_key=$1 LIMIT 1`,
      [input.scope_key, input.area_id]
    );
    if (!scope.length) fail(404, 'UNKNOWN_SCOPE', 'The scope is not registered.');
    const mismatched = await db.query(
      `SELECT 1 FROM firebridge.ingestion_subscriptions
      WHERE scope_key=$1 AND area_id<>$2::uuid LIMIT 1`,
      [input.scope_key, input.area_id]
    );
    if (mismatched.length)
      fail(
        422,
        'INCOMPATIBLE_SCOPE_AREA',
        'This scope is registered to a different area revision.'
      );
    const sources = await this.repository.sources(db, feed.id);
    const selected = sources.filter((s) => input.source_ids.includes(s.id));
    if (
      selected.length !== input.source_ids.length ||
      selected.some((s) => s.collection !== input.collection) ||
      canonical([...new Set(selected.map((s) => s.product))].sort()) !== canonical(input.products)
    )
      fail(
        422,
        'INCOMPATIBLE_PRODUCTS',
        'Sources, products and collection must match the registered feed.'
      );
    return {
      feed_id: feed.id,
      scope_key: input.scope_key,
      area_id: input.area_id,
      start: input.start,
      end_exclusive: input.end_exclusive,
      source_ids: input.source_ids,
      products: input.products,
      collection: input.collection,
      adapter: feed.adapter,
      adapter_version: feed.adapter_version,
      query_basis: 'observation_time',
      chunk_seconds: chunkSeconds,
      planned_chunks: chunks,
      resource_budget: input.resource_budget,
      estimated_bytes: null,
      missing_access_requirements: credentialsConfigured(feed) ? [] : ['provider_credentials'],
      execution_support: 'planning_only'
    };
  }
  private replay(job: IngestionJob, hash: string) {
    if (job.request_hash !== hash)
      fail(409, 'IDEMPOTENCY_CONFLICT', 'This key already identifies a different request.');
    return {
      statusCode: 200 as const,
      data: {
        job_id: job.id,
        status: job.status,
        ...(job.request_spec.public_plan as object),
        reused: true
      }
    };
  }
  private async enqueue(
    db: SqlReader,
    kind: 'backfill' | 'refresh',
    plan: Plan,
    actor: string,
    key: string,
    hash: string
  ) {
    const id = randomUUID();
    const spec = { public_plan: plan };
    await db.query(
      `INSERT INTO firebridge.api_jobs
      (id,kind,requested_by,request_hash,idempotency_key,request_spec,status,progress)
      VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,'queued','{"stage":"awaiting_planner"}')`,
      [id, kind, actor, hash, key, JSON.stringify(spec)]
    );
    await db.query(
      `INSERT INTO firebridge.outbox_events
      (id,event_type,aggregate_id,dedupe_key,payload,status,available_at)
      VALUES ($1::uuid,'ingestion.plan.requested',$2,$3,$4::jsonb,'pending',now())`,
      [randomUUID(), id, 'ingestion-plan-' + id, JSON.stringify({ job_id: id })]
    );
    return {
      statusCode: 202 as const,
      data: { job_id: id, status: 'queued', ...plan, reused: false }
    };
  }
  async backfill(input: BackfillInput, actor: string, key: string) {
    const hash = digest({ action: 'backfill', input });
    return this.repository.write(async (db) => {
      const old = await this.repository.job(db, actor, key);
      if (old) return this.replay(old, hash);
      const feed = await this.readyFeed(db, input.feed_id);
      const draft = await this.plan(db, feed, input);
      const config = {
        source_ids: input.source_ids,
        products: input.products,
        collection: input.collection,
        adapter: feed.adapter,
        adapter_version: feed.adapter_version,
        adapter_options: input.adapter_options,
        resource_budget: input.resource_budget,
        start: input.start,
        end_exclusive: input.end_exclusive,
        query_basis: draft.query_basis,
        chunk_seconds: draft.chunk_seconds
      };
      const sha = digest({ ...config, area_id: input.area_id });
      const rows = await db.query<{ id: string }>(
        `INSERT INTO firebridge.ingestion_subscriptions
        (id,feed_id,area_id,scope_key,mode,interval_seconds,overlap_seconds,history_start,
         fixed_end_exclusive,request_config,config_sha256,enabled)
        VALUES($1::uuid,$2,$3::uuid,$4,'backfill',86400,0,$5::timestamptz,$6::timestamptz,$7::jsonb,$8,false)
        ON CONFLICT(feed_id,scope_key,mode,config_sha256) DO UPDATE SET config_sha256=EXCLUDED.config_sha256
        RETURNING id::text`,
        [
          randomUUID(),
          input.feed_id,
          input.area_id,
          input.scope_key,
          input.start,
          input.end_exclusive,
          JSON.stringify(config),
          sha
        ]
      );
      return this.enqueue(
        db,
        'backfill',
        { ...draft, subscription_id: rows[0].id },
        actor,
        key,
        hash
      );
    });
  }
  async refresh(id: string, input: RefreshInput, actor: string, key: string) {
    const hash = digest({ action: 'refresh', id, input });
    return this.repository.write(async (db) => {
      const old = await this.repository.job(db, actor, key);
      if (old) return this.replay(old, hash);
      const sub = await this.repository.subscription(db, id);
      if (!sub) return fail(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found.');
      const feed = await this.readyFeed(db, sub.feed_id);
      const config = sub.request_config;
      if (
        !Array.isArray(config.source_ids) ||
        !Array.isArray(config.products) ||
        typeof config.collection !== 'string'
      )
        return fail(
          409,
          'SUBSCRIPTION_CONFIG_REQUIRED',
          'The subscription needs an explicit source/product configuration.'
        );
      if (config.adapter !== feed.adapter || config.adapter_version !== feed.adapter_version)
        return fail(
          409,
          'ADAPTER_VERSION_CHANGED',
          'The registered adapter no longer matches the subscription.'
        );
      let start = input.start,
        end = input.end_exclusive;
      if (!start && input.mode === 'repair') {
        const gaps = await db.query<{ start: string; end: string }>(
          `SELECT gap_start::text AS start,
          gap_end_exclusive::text AS end FROM firebridge.ingestion_gaps WHERE subscription_id=$1::uuid
          AND status IN ('open','retrying') AND (retry_after IS NULL OR retry_after<=now())
          ORDER BY gap_start,id LIMIT 1`,
          [id]
        );
        if (!gaps.length) return fail(409, 'NO_REPAIR_GAP', 'No due repair gap exists.');
        start = new Date(gaps[0].start).toISOString();
        end = new Date(gaps[0].end).toISOString();
      }
      if (!start) {
        const checkpoints = await db.query<{ committed_until: string | null }>(
          `SELECT committed_until::text
          FROM firebridge.ingestion_checkpoints WHERE subscription_id=$1::uuid AND stage='fetch'
          AND cursor_basis='observation_time'`,
          [id]
        );
        const origin =
          input.mode === 'poll' && checkpoints[0]?.committed_until
            ? Math.max(
                Date.parse(sub.history_start),
                Date.parse(checkpoints[0].committed_until) - sub.overlap_seconds * 1000
              )
            : Date.parse(sub.history_start);
        start = new Date(origin).toISOString();
        end = sub.fixed_end_exclusive
          ? new Date(sub.fixed_end_exclusive).toISOString()
          : new Date().toISOString();
      }
      if (
        Date.parse(start) < Date.parse(sub.history_start) ||
        (sub.fixed_end_exclusive && Date.parse(end!) > Date.parse(sub.fixed_end_exclusive))
      )
        return fail(
          422,
          'INVALID_WINDOW',
          'Refresh must remain inside the configured subscription window.'
        );
      const draft = await this.plan(db, feed, {
        feed_id: sub.feed_id,
        area_id: sub.area_id,
        scope_key: sub.scope_key,
        start,
        end_exclusive: end!,
        source_ids: config.source_ids as string[],
        products: config.products as string[],
        collection: config.collection,
        adapter_options: {},
        resource_budget: input.resource_budget
      });
      return this.enqueue(db, 'refresh', { ...draft, subscription_id: id }, actor, key, hash);
    });
  }
  async run(id: string) {
    return this.repository.read(async (db) => {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT r.id::text,r.subscription_id::text,
        s.scope_key,s.feed_id,r.pipeline_run_id::text,r.query_start::text AS start,
        r.query_end_exclusive::text AS end_exclusive,r.query_basis,r.status,r.attempt,
        r.enumeration_complete,r.page_count,r.record_count::text,r.started_at::text,r.completed_at::text,
        r.max_observation_at::text,r.http_status,r.retry_after::text,
        CASE WHEN r.error_code IS NULL THEN NULL ELSE 'FETCH_ERROR_RECORDED' END AS error_code
        FROM firebridge.fetch_runs r JOIN firebridge.ingestion_subscriptions s ON s.id=r.subscription_id
        WHERE r.id=$1::uuid`,
        [id]
      );
      if (!rows.length) return fail(404, 'FETCH_RUN_NOT_FOUND', 'Fetch attempt not found.');
      const assets = await db.query<Record<string, unknown>>(
        `SELECT a.id::text,a.source_id,a.sha256,
        a.byte_size::text,a.validation_status,fa.role,count(*) OVER()::text AS total
        FROM firebridge.fetch_assets fa JOIN firebridge.assets a ON a.id=fa.asset_id
        WHERE fa.fetch_run_id=$1::uuid ORDER BY fa.asset_id,fa.role,fa.page_key LIMIT 101`,
        [id]
      );
      const issues = await db.query<Record<string, unknown>>(
        `SELECT qi.id::text,qi.severity,qi.status,
        qi.affected_count::text,count(*) OVER()::text AS total
        FROM firebridge.quality_issues qi JOIN firebridge.fetch_runs r ON r.pipeline_run_id=qi.pipeline_run_id
        WHERE r.id=$1::uuid ORDER BY qi.id LIMIT 101`,
        [id]
      );
      const pipeline = await db.query<{ id: string; status: string }>(
        `SELECT p.id::text,p.status
        FROM firebridge.pipeline_runs p JOIN firebridge.fetch_runs r ON r.pipeline_run_id=p.id
        WHERE r.id=$1::uuid`,
        [id]
      );
      const clean = (items: Record<string, unknown>[]) =>
        items.slice(0, 100).map(({ total: _total, ...item }) => item);
      return {
        ...rows[0],
        sanitized_request: {
          start: rows[0].start,
          end_exclusive: rows[0].end_exclusive,
          query_basis: rows[0].query_basis
        },
        successful_empty:
          rows[0].status === 'complete' &&
          rows[0].enumeration_complete === true &&
          rows[0].record_count === '0',
        assets: clean(assets),
        assets_total: assets[0]?.total ?? '0',
        assets_truncated: assets.length > 100,
        quality_issues: clean(issues),
        quality_issues_total: issues[0]?.total ?? '0',
        quality_issues_truncated: issues.length > 100,
        pipeline: pipeline[0] ?? null
      };
    });
  }
  async availability(source: string, q: AvailabilityQuery) {
    validateWindow(q.start, q.end_exclusive);
    return this.repository.read(async (db) => {
      const feeds = await db.query<{
        feed_id: string;
        state: string;
        verified_at: string | null;
        subscription_id: string;
        interval_seconds: number;
        next_due_at: string | null;
        enabled: boolean;
        provider_status: string | null;
        checked_at: string | null;
        available_start: string | null;
        available_end_exclusive: string | null;
        last_attempt_at: string | null;
        last_success_at: string | null;
        queried_through: string | null;
        latest_observation_at: string | null;
      }>(
        `SELECT f.id AS feed_id,f.state,f.verified_at::text,s.id::text AS subscription_id,
        s.interval_seconds,s.next_due_at::text,s.enabled,
        a.status AS provider_status,a.checked_at::text,a.available_start::text,a.available_end_exclusive::text,
        (SELECT max(r.started_at)::text FROM firebridge.fetch_runs r WHERE r.subscription_id=s.id
          AND ($3::timestamptz IS NULL OR r.query_end_exclusive>$3::timestamptz)
          AND ($4::timestamptz IS NULL OR r.query_start<$4::timestamptz)) AS last_attempt_at,
        (SELECT max(r.completed_at)::text FROM firebridge.fetch_runs r WHERE r.subscription_id=s.id
          AND r.status IN ('complete','not_modified') AND r.enumeration_complete
          AND ($3::timestamptz IS NULL OR r.query_end_exclusive>$3::timestamptz)
          AND ($4::timestamptz IS NULL OR r.query_start<$4::timestamptz)) AS last_success_at,
        (SELECT c.committed_until::text FROM firebridge.ingestion_checkpoints c WHERE c.subscription_id=s.id
          AND c.stage='fetch' AND c.cursor_basis='observation_time') AS queried_through,
        (SELECT max(d.acquired_at)::text FROM firebridge.detections d
          JOIN firebridge.areas area ON area.id=s.area_id
          WHERE d.source_id=$1 AND ST_Covers(area.geom,d.geom)
          AND d.processing_level=(SELECT processing_stream FROM firebridge.sources WHERE id=$1)
          AND ($3::timestamptz IS NULL OR d.acquired_at>=$3::timestamptz)
          AND ($4::timestamptz IS NULL OR d.acquired_at<$4::timestamptz)
          AND EXISTS(SELECT 1 FROM firebridge.fetch_assets fa JOIN firebridge.fetch_runs r ON r.id=fa.fetch_run_id
            WHERE r.subscription_id=s.id AND r.status='complete' AND r.enumeration_complete AND fa.asset_id=d.asset_id
            AND d.acquired_at>=r.query_start AND d.acquired_at<r.query_end_exclusive))
          AS latest_observation_at
        FROM firebridge.ingestion_subscriptions s JOIN firebridge.ingestion_feeds f ON f.id=s.feed_id
        JOIN firebridge.feed_sources fs ON fs.feed_id=f.id AND fs.source_id=$1
        LEFT JOIN LATERAL (SELECT sa.* FROM firebridge.source_availability sa
          WHERE sa.feed_id=f.id AND sa.source_id=$1 AND f.verified_at IS NOT NULL AND f.state<>'unverified'
          ORDER BY sa.checked_at DESC LIMIT 1) a ON true
        WHERE s.scope_key=$2 ORDER BY f.id,s.id`,
        [source, q.scope_key, q.start ?? null, q.end_exclusive ?? null]
      );
      if (!feeds.length)
        return fail(404, 'SOURCE_OUTSIDE_SCOPE', 'Source is not registered in this scope.');
      const gapRows = await this.repository.gaps(
        db,
        { scope_key: q.scope_key, start: q.start, end_exclusive: q.end_exclusive, limit: 100 },
        ZERO,
        source
      );
      const gaps = gapRows.slice(0, 100).map(({ total: _total, ...row }) => row);
      const published = await db.query<{ published_at: string | null }>(
        `SELECT max(r.published_at)::text AS published_at
        FROM firebridge.release_aliases ra JOIN firebridge.data_releases r ON r.id=ra.release_id
        JOIN firebridge.release_partitions rp ON rp.release_id=r.id
        JOIN firebridge.data_partitions p ON p.id=rp.partition_id
        WHERE ra.scope_key=$1 AND r.scope_key=$1 AND r.status='published'
        AND p.support_spec->'source_ids' ? $2`,
        [q.scope_key, source]
      );
      const max = (key: 'last_attempt_at' | 'last_success_at' | 'latest_observation_at') =>
        feeds
          .map((f) => f[key])
          .filter((v): v is string => !!v)
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
      const statuses = [
        ...new Set(
          feeds.map((f) => (f.state === 'retired' ? 'retired' : (f.provider_status ?? 'unknown')))
        )
      ];
      const retired = feeds.every((f) => f.state === 'retired');
      const pending = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count
        FROM firebridge.ingestion_gaps g JOIN firebridge.ingestion_subscriptions s ON s.id=g.subscription_id
        JOIN firebridge.ingestion_feeds f ON f.id=s.feed_id
        WHERE s.scope_key=$1 AND (${gapStatus}) IN ('open','retrying')
        AND EXISTS(SELECT 1 FROM firebridge.feed_sources fs WHERE fs.feed_id=s.feed_id AND fs.source_id=$2)
        AND (NOT(g.evidence ? 'source_ids') OR g.evidence->'source_ids' ? $2)
        AND ($3::timestamptz IS NULL OR g.gap_end_exclusive>$3::timestamptz)
        AND ($4::timestamptz IS NULL OR g.gap_start<$4::timestamptz)`,
        [q.scope_key, source, q.start ?? null, q.end_exclusive ?? null]
      );
      const hasGaps = pending[0].count !== '0';
      const missing = feeds.some((f) => !f.last_success_at);
      const old = feeds.some(
        (f) =>
          !f.last_success_at ||
          Date.now() - Date.parse(f.last_success_at) > f.interval_seconds * 1000
      );
      const reason = retired
        ? 'SOURCE_RETIRED'
        : hasGaps
          ? 'INGESTION_GAPS'
          : missing
            ? 'NEVER_FETCHED'
            : old
              ? 'FETCH_OVERDUE'
              : statuses.some((s) => ['unknown', 'unavailable', 'partial', 'retired'].includes(s))
                ? 'PROVIDER_NOT_FULLY_AVAILABLE'
                : null;
      const boundaries = feeds.map((f) => f.queried_through);
      const queried = boundaries.every((v): v is string => !!v)
        ? [...boundaries].sort((a, b) => Date.parse(a!) - Date.parse(b!))[0]
        : null;
      const next =
        feeds
          .filter((f) => f.enabled && f.state !== 'retired')
          .map((f) => f.next_due_at)
          .filter((v): v is string => !!v)
          .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
      return {
        source_id: source,
        scope_key: q.scope_key,
        provider_status: statuses.length === 1 ? statuses[0] : 'multiple_feeds',
        last_attempt_at: max('last_attempt_at'),
        last_success_at: max('last_success_at'),
        queried_through: queried,
        latest_observation_at: max('latest_observation_at'),
        published_at: published[0]?.published_at ?? null,
        next_check_at: next,
        stale: !!reason,
        stale_reason: reason,
        observation_coverage: null,
        ingestion_completeness: hasGaps ? 'gaps_present' : 'not_proven',
        gaps,
        gaps_total: gapRows[0]?.total ?? '0',
        gaps_truncated: gapRows.length > 100,
        feeds: feeds.map((f) => ({
          ...f,
          provider_status: f.state === 'retired' ? 'retired' : (f.provider_status ?? 'unknown')
        })),
        limitations: [
          'POINT_FEED_FRESHNESS_IS_NOT_OBSERVATION_COVERAGE',
          'MANUAL_INGESTION_PLANNING_ONLY'
        ]
      };
    });
  }
}
