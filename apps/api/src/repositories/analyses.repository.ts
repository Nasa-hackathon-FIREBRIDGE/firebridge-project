/**
 * Analyses repository — PostgreSQL parameterized queries with REPEATABLE READ transactions
 *
 * Implements atomic creation of:
 *   1. analyses
 *   2. analysis_components
 *   3. api_jobs
 *   4. outbox_events
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import {
  AppError,
  BadRequestError,
  IdempotencyConflictError,
  ServiceUnavailableError
} from '../errors/app-error.js';
import { computeAnalysisCacheKey, computeAnalysisRequestHash } from '../utils/analysis-cache.js';
import { env } from '../config/env.js';

export interface DataReleaseRecord {
  id: string;
  name: string;
  status: string;
  stream: string;
  dataset_kind: string;
  observation_cutoff: Date;
  config?: { engine?: string };
}

export interface AnalysisRecord {
  id: string;
  area_id: string;
  release_id: string;
  start_date: string;
  end_date_exclusive: string;
  time_basis: string;
  metric_key: string;
  grid_id: string | null;
  selection_policy: string;
  weighting_version: string;
  baseline_spec: unknown;
  weather_policy: unknown;
  news_policy: unknown;
  request_spec: unknown;
  cache_key: string;
  status: string;
  error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface AnalysisComponentRecord {
  analysis_id: string;
  component: string;
  release_id: string | null;
  status: string;
  reasons: unknown;
}

export interface ApiJobRecord {
  id: string;
  kind: string;
  analysis_id: string | null;
  explanation_id: string | null;
  request_hash: string;
  idempotency_key: string;
  request_spec: unknown;
  status: string;
  attempt: number;
  progress: unknown;
  error_code: string | null;
  expires_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface AnalysisDetail {
  analysis: AnalysisRecord;
  components: AnalysisComponentRecord[];
  job: ApiJobRecord | null;
}

export interface CreateAnalysisTransactionInput {
  area_id: string;
  start_date: string;
  end_date_exclusive: string;
  time_basis: string;
  metric_key: string;
  grid_id: string | null;
  selection_policy: string;
  weighting_version: string;
  baseline_spec: unknown;
  weather_policy: unknown;
  news_policy: unknown;
  request_spec: Record<string, unknown>;
  idempotency_key?: string;
}

async function wrapDbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('connection') ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      throw new ServiceUnavailableError('Database is currently unavailable.');
    }

    throw error;
  }
}

async function bindRequestKey(
  tx: Prisma.TransactionClient,
  key: string,
  hash: string,
  jobId: string
) {
  await tx.$executeRaw`INSERT INTO firebridge.analysis_request_keys
    (idempotency_key,request_hash,job_id)
    VALUES (${key},${hash},${jobId}::uuid)`;
}

async function replayRequest(
  tx: Prisma.TransactionClient,
  input: CreateAnalysisTransactionInput,
  hash: string
): Promise<AnalysisDetail | null> {
  if (!input.idempotency_key) return null;
  type Replay = {
    job_id: string;
    analysis_id: string | null;
    kind: string;
    request_hash: string;
    request_spec: Record<string, unknown>;
  };
  const bindings = await tx.$queryRaw<Replay[]>`SELECT j.id::text AS job_id,j.analysis_id::text,
    j.kind,k.request_hash,j.request_spec FROM firebridge.analysis_request_keys k
    JOIN firebridge.api_jobs j ON j.id=k.job_id
    WHERE k.idempotency_key=${input.idempotency_key}`;
  // Preserve retry behavior for requests created before the additive migration.
  const legacy = bindings.length
    ? []
    : await tx.$queryRaw<Replay[]>`
    SELECT id::text AS job_id,analysis_id::text,kind,request_hash,request_spec
    FROM firebridge.api_jobs WHERE idempotency_key=${input.idempotency_key}`;
  const row = bindings[0] ?? legacy[0];
  if (!row) return null;
  const legacyIntent = {
    ...row.request_spec,
    area_id:
      typeof row.request_spec.area_id === 'string'
        ? row.request_spec.area_id.toLowerCase()
        : row.request_spec.area_id
  };
  if (
    row.kind !== 'analysis' ||
    !row.analysis_id ||
    (row.request_hash !== hash &&
      (bindings.length > 0 || computeAnalysisRequestHash(legacyIntent) !== hash))
  )
    throw new IdempotencyConflictError('This key already identifies a different request.');
  const detail = await analysesRepository.findById(row.analysis_id, tx, row.job_id);
  if (!detail) throw new ServiceUnavailableError('The original analysis request is unavailable.');
  if (!bindings.length) await bindRequestKey(tx, input.idempotency_key, hash, row.job_id);
  return detail;
}

function isConcurrentCreation(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return (
    ['P2034', 'P2002', 'P2028', 'P2024'].includes(error.code) ||
    (error.code === 'P2010' && ['40001', '40P01', '23505'].includes(String(error.meta?.code)))
  );
}

export const analysesRepository = {
  /**
   * Ensures the fixed metric definition exists in metric_definitions.
   */
  async ensureMetricDefinition(metricKey: string): Promise<void> {
    await wrapDbCall(async () => {
      await prisma.$executeRaw`
        INSERT INTO firebridge.metric_definitions
          (id, version, unit, family, description, definition, requires_masks, requires_model)
        VALUES
          (${metricKey}, '1.0.0', 'count', 'native_detections', 'Native satellite detections count v1', '{}'::jsonb, false, false)
        ON CONFLICT (id) DO NOTHING;
      `;
    });
  },

  /**
   * Finds an existing analysis by its canonical cache key.
   */
  async findByCacheKey(
    cacheKey: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<AnalysisDetail | null> {
    return wrapDbCall(async () => {
      const rows = await tx.$queryRaw<AnalysisRecord[]>`
        SELECT
          id::text,
          area_id::text,
          release_id::text,
          start_date::text,
          end_date_exclusive::text,
          time_basis,
          metric_key,
          grid_id,
          selection_policy,
          weighting_version,
          baseline_spec,
          weather_policy,
          news_policy,
          request_spec,
          cache_key,
          status,
          error_code,
          created_at,
          completed_at
        FROM firebridge.analyses
        WHERE cache_key = ${cacheKey}
        LIMIT 1;
      `;

      const analysis = rows[0];
      if (!analysis) return null;

      const components = await tx.$queryRaw<AnalysisComponentRecord[]>`
        SELECT
          analysis_id::text,
          component,
          release_id::text,
          status,
          reasons
        FROM firebridge.analysis_components
        WHERE analysis_id = ${analysis.id}::uuid;
      `;

      const jobs = await tx.$queryRaw<ApiJobRecord[]>`
        SELECT
          id::text,
          kind,
          analysis_id::text,
          explanation_id::text,
          request_hash,
          idempotency_key,
          request_spec,
          status,
          attempt,
          progress,
          error_code,
          expires_at,
          created_at,
          completed_at
        FROM firebridge.api_jobs
        WHERE analysis_id = ${analysis.id}::uuid
          AND kind = 'analysis'
        ORDER BY created_at DESC
        LIMIT 1;
      `;

      return {
        analysis,
        components,
        job: jobs[0] ?? null
      };
    });
  },

  /**
   * Finds an analysis by primary key (id).
   */
  async findById(
    analysisId: string,
    tx: Prisma.TransactionClient = prisma,
    jobId: string | null = null
  ): Promise<AnalysisDetail | null> {
    return wrapDbCall(async () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(analysisId)) {
        return null;
      }

      const rows = await tx.$queryRaw<AnalysisRecord[]>`
        SELECT
          id::text,
          area_id::text,
          release_id::text,
          start_date::text,
          end_date_exclusive::text,
          time_basis,
          metric_key,
          grid_id,
          selection_policy,
          weighting_version,
          baseline_spec,
          weather_policy,
          news_policy,
          request_spec,
          cache_key,
          status,
          error_code,
          created_at,
          completed_at
        FROM firebridge.analyses
        WHERE id = ${analysisId}::uuid
        LIMIT 1;
      `;

      const analysis = rows[0];
      if (!analysis) return null;

      const components = await tx.$queryRaw<AnalysisComponentRecord[]>`
        SELECT
          analysis_id::text,
          component,
          release_id::text,
          status,
          reasons
        FROM firebridge.analysis_components
        WHERE analysis_id = ${analysisId}::uuid;
      `;

      const jobs = await tx.$queryRaw<ApiJobRecord[]>`
        SELECT
          id::text,
          kind,
          analysis_id::text,
          explanation_id::text,
          request_hash,
          idempotency_key,
          request_spec,
          status,
          attempt,
          progress,
          error_code,
          expires_at,
          created_at,
          completed_at
        FROM firebridge.api_jobs
        WHERE analysis_id = ${analysisId}::uuid
          AND kind = 'analysis' AND (${jobId}::uuid IS NULL OR id=${jobId}::uuid)
        ORDER BY created_at DESC
        LIMIT 1;
      `;

      return {
        analysis,
        components,
        job: jobs[0] ?? null
      };
    });
  },

  /**
   * Resolves releases and creates analysis, components, job, and outbox event
   * in a single atomic transaction with REPEATABLE READ isolation.
   */
  async createAnalysisTransaction(
    input: CreateAnalysisTransactionInput
  ): Promise<{ detail: AnalysisDetail; created: boolean }> {
    return wrapDbCall(async () => {
      const requestHash = computeAnalysisRequestHash(input.request_spec);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              // An explicit retry refers to its original result, even after publication changes.
              const replay = await replayRequest(tx, input, requestHash);
              if (replay) return { detail: replay, created: false };
              // 2. Validate area exists
              const areaRows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text FROM firebridge.areas WHERE id = ${input.area_id}::uuid LIMIT 1;
          `;
              if (areaRows.length === 0) {
                throw new BadRequestError(
                  `Area with id '${input.area_id}' does not exist.`,
                  'VALIDATION_ERROR'
                );
              }

              await tx.$executeRaw`INSERT INTO firebridge.metric_definitions
            (id,version,unit,family,description,definition,requires_masks,requires_model)
            VALUES (${input.metric_key},'1.0.0','count','native_detections',
              'Native satellite detections count v1','{}'::jsonb,false,false)
            ON CONFLICT (id) DO NOTHING`;

              // 3. Resolve published satellite release covering the observation window
              let satelliteReleases = await tx.$queryRaw<DataReleaseRecord[]>`
            SELECT
              id::text,
              name,
              status,
              stream,
              dataset_kind,
              observation_cutoff, config
            FROM firebridge.data_releases
            WHERE dataset_kind = 'satellite'
              AND scope_key = ${env.DEFAULT_SCOPE_KEY} AND stream = 'retrospective' AND published_at IS NOT NULL
              AND status = 'published'
              AND observation_cutoff >= ${input.end_date_exclusive}::timestamptz
              AND (${!env.HISTORY_SERVICE_URL} OR (
                config->>'engine' IS DISTINCT FROM 'archive-selection-v1' AND
                (SELECT coalesce(range_agg(tstzrange((p.support_spec->>'start')::timestamptz,
                  (p.support_spec->>'end_exclusive')::timestamptz,'[)')) @>
                  tstzrange(${input.start_date}::timestamptz,${input.end_date_exclusive}::timestamptz,'[)'),false)
                 FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
                 WHERE rp.release_id=firebridge.data_releases.id AND p.kind='detections'
                   AND p.validation_status='validated' AND p.serving_complete
                   AND (p.support_spec->>'area_id'=${input.area_id}
                     OR p.support_spec->'bbox'='[-180,-90,180,90]'::jsonb))))
            ORDER BY observation_cutoff DESC, created_at DESC
            LIMIT 1;
          `;

              if (!satelliteReleases.length && env.HISTORY_SERVICE_URL) {
                satelliteReleases = await tx.$queryRaw<DataReleaseRecord[]>`
                  SELECT id::text,name,status,stream,dataset_kind,observation_cutoff,config
                  FROM firebridge.data_releases WHERE dataset_kind='satellite'
                    AND scope_key=${env.DEFAULT_SCOPE_KEY} AND status='published'
                    AND published_at IS NOT NULL AND config->>'engine'='archive-selection-v1'
                    AND observation_cutoff>=${input.end_date_exclusive}::timestamptz
                    AND (config->>'start')::date<${input.end_date_exclusive}::date
                    AND (config->>'end_exclusive')::date>${input.start_date}::date
                  ORDER BY created_at DESC LIMIT 1`;
              }
              const satelliteRelease = satelliteReleases[0];
              if (!satelliteRelease) {
                throw new BadRequestError(
                  'No published satellite release covers the requested time window.',
                  'NO_COMPATIBLE_RELEASE'
                );
              }

              const historyCatalogId = satelliteRelease.config?.engine === 'archive-selection-v1' ? satelliteRelease.id : undefined;
              if (historyCatalogId && (input.time_basis !== 'utc' || input.selection_policy !== 'standard'))
                throw new BadRequestError('Historical preparation supports UTC native standard selections.', 'UNSUPPORTED_HISTORICAL_SELECTION');
              if (historyCatalogId && (Date.parse(input.end_date_exclusive)-Date.parse(input.start_date))/86400000>3660)
                throw new BadRequestError('Select at most 3660 days per historical analysis.', 'HISTORICAL_WINDOW_TOO_LARGE');
              const frozenSpec = historyCatalogId ? { ...input.request_spec, history_catalog_id: historyCatalogId } : input.request_spec;

              // Resolve optional weather and reports releases
              const weatherReleases = await tx.$queryRaw<DataReleaseRecord[]>`
            SELECT id::text, name, status, stream, dataset_kind, observation_cutoff
            FROM firebridge.data_releases
            WHERE dataset_kind = 'weather'
              AND scope_key = ${env.DEFAULT_SCOPE_KEY} AND stream = 'retrospective' AND published_at IS NOT NULL
              AND status = 'published'
              AND observation_cutoff >= ${input.end_date_exclusive}::timestamptz
            ORDER BY observation_cutoff DESC, created_at DESC
            LIMIT 1;
          `;
              const weatherRelease = weatherReleases[0] ?? null;

              const reportReleases = await tx.$queryRaw<DataReleaseRecord[]>`
            SELECT id::text, name, status, stream, dataset_kind, observation_cutoff
            FROM firebridge.data_releases
            WHERE dataset_kind = 'reports'
              AND scope_key = ${env.DEFAULT_SCOPE_KEY} AND stream = 'retrospective' AND published_at IS NOT NULL
              AND status = 'published'
              AND observation_cutoff >= ${input.end_date_exclusive}::timestamptz
            ORDER BY observation_cutoff DESC, created_at DESC
            LIMIT 1;
          `;
              const reportRelease = reportReleases[0] ?? null;

              // Freeze the complete version selection before looking for reusable results.
              const cacheKey = computeAnalysisCacheKey({
                request_spec: input.request_spec,
                satellite_release_id: satelliteRelease.id,
                weather_release_id: weatherRelease?.id ?? null,
                reports_release_id: reportRelease?.id ?? null
              });
              const idempotencyKey = input.idempotency_key ?? `auto:${cacheKey}`;
              const existing = await analysesRepository.findByCacheKey(cacheKey, tx);
              if (existing) {
                if (input.idempotency_key) {
                  if (!existing.job)
                    throw new ServiceUnavailableError('The cached analysis job is unavailable.');
                  await bindRequestKey(tx, idempotencyKey, requestHash, existing.job.id);
                }
                return { detail: existing, created: false };
              }

              const analysisId = randomUUID();
              const jobId = randomUUID();
              const outboxId = randomUUID();

              // 4. Insert into analyses
              await tx.$executeRaw`
            INSERT INTO firebridge.analyses (
              id,
              area_id,
              release_id,
              start_date,
              end_date_exclusive,
              time_basis,
              metric_key,
              grid_id,
              selection_policy,
              weighting_version,
              baseline_spec,
              weather_policy,
              news_policy,
              request_spec,
              cache_key,
              status
            ) VALUES (
              ${analysisId}::uuid,
              ${input.area_id}::uuid,
              ${satelliteRelease.id}::uuid,
              ${input.start_date}::date,
              ${input.end_date_exclusive}::date,
              ${input.time_basis},
              ${input.metric_key},
              ${input.grid_id},
              ${input.selection_policy},
              ${input.weighting_version},
              ${JSON.stringify(input.baseline_spec)}::jsonb,
              ${JSON.stringify(input.weather_policy)}::jsonb,
              ${JSON.stringify(input.news_policy)}::jsonb,
              ${JSON.stringify(frozenSpec)}::jsonb,
              ${cacheKey},
              'queued'
            );
          `;

              // 5. Insert analysis_components
              // Satellite component (always ready since resolved)
              await tx.$executeRaw`
            INSERT INTO firebridge.analysis_components (
              analysis_id, component, release_id, status, reasons
            ) VALUES (
              ${analysisId}::uuid,
              'satellite',
              ${satelliteRelease.id}::uuid,
              ${historyCatalogId ? 'missing' : 'ready'},
              ${JSON.stringify(historyCatalogId ? ['HISTORICAL_PREPARATION_PENDING'] : [])}::jsonb
            );
          `;

              // Weather historical component
              if (weatherRelease) {
                await tx.$executeRaw`
              INSERT INTO firebridge.analysis_components (
                analysis_id, component, release_id, status, reasons
              ) VALUES (
                ${analysisId}::uuid,
                'weather_historical',
                ${weatherRelease.id}::uuid,
                'ready',
                '[]'::jsonb
              );
            `;
              } else {
                await tx.$executeRaw`
              INSERT INTO firebridge.analysis_components (
                analysis_id, component, release_id, status, reasons
              ) VALUES (
                ${analysisId}::uuid,
                'weather_historical',
                NULL,
                'missing',
                '["No published weather release covers this window"]'::jsonb
              );
            `;
              }

              // Reports component
              if (reportRelease) {
                await tx.$executeRaw`
              INSERT INTO firebridge.analysis_components (
                analysis_id, component, release_id, status, reasons
              ) VALUES (
                ${analysisId}::uuid,
                'reports',
                ${reportRelease.id}::uuid,
                'ready',
                '[]'::jsonb
              );
            `;
              } else {
                await tx.$executeRaw`
              INSERT INTO firebridge.analysis_components (
                analysis_id, component, release_id, status, reasons
              ) VALUES (
                ${analysisId}::uuid,
                'reports',
                NULL,
                'missing',
                '["No published reports release covers this window"]'::jsonb
              );
            `;
              }

              // 6. Insert api_jobs
              await tx.$executeRaw`
            INSERT INTO firebridge.api_jobs (
              id,
              kind,
              analysis_id,
              explanation_id,
              request_hash,
              idempotency_key,
              request_spec,
              status,
              attempt,
              progress
            ) VALUES (
              ${jobId}::uuid,
              'analysis',
              ${analysisId}::uuid,
              NULL,
              ${requestHash},
              ${idempotencyKey},
              ${JSON.stringify(input.request_spec)}::jsonb,
              'queued',
              0,
              '{"percent": 0, "stage": "queued"}'::jsonb
            );
          `;

              await bindRequestKey(tx, idempotencyKey, requestHash, jobId);

              // 7. Insert transactional outbox event
              await tx.$executeRaw`
            INSERT INTO firebridge.outbox_events (
              id,
              event_type,
              aggregate_id,
              dedupe_key,
              payload,
              status,
              attempts,
              available_at
            ) VALUES (
              ${outboxId}::uuid,
              'analysis.requested',
              ${analysisId},
              ${'analysis:' + analysisId + ':created'},
              ${JSON.stringify({
                analysis_id: analysisId,
                job_id: jobId,
                area_id: input.area_id,
                metric_key: input.metric_key,
                start_date: input.start_date,
                end_date_exclusive: input.end_date_exclusive
              })}::jsonb,
              'pending',
              0,
              now()
            );
          `;

              // Retrieve created records to return
              const analysisRows = await tx.$queryRaw<AnalysisRecord[]>`
            SELECT
              id::text,
              area_id::text,
              release_id::text,
              start_date::text,
              end_date_exclusive::text,
              time_basis,
              metric_key,
              grid_id,
              selection_policy,
              weighting_version,
              baseline_spec,
              weather_policy,
              news_policy,
              request_spec,
              cache_key,
              status,
              error_code,
              created_at,
              completed_at
            FROM firebridge.analyses
            WHERE id = ${analysisId}::uuid;
          `;

              const componentRows = await tx.$queryRaw<AnalysisComponentRecord[]>`
            SELECT
              analysis_id::text,
              component,
              release_id::text,
              status,
              reasons
            FROM firebridge.analysis_components
            WHERE analysis_id = ${analysisId}::uuid;
          `;

              const jobRows = await tx.$queryRaw<ApiJobRecord[]>`
            SELECT
              id::text,
              kind,
              analysis_id::text,
              explanation_id::text,
              request_hash,
              idempotency_key,
              request_spec,
              status,
              attempt,
              progress,
              error_code,
              expires_at,
              created_at,
              completed_at
            FROM firebridge.api_jobs
            WHERE id = ${jobId}::uuid;
          `;

              return {
                detail: {
                  analysis: analysisRows[0]!,
                  components: componentRows,
                  job: jobRows[0]!
                },
                created: true
              };
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
              timeout: 10000
            }
          );
        } catch (error) {
          if (!isConcurrentCreation(error)) throw error;
          if (attempt === 2)
            throw new ServiceUnavailableError('Concurrent analysis creation; retry the request.');
        }
      }
      throw new ServiceUnavailableError('Analysis creation is unavailable.');
    });
  },

  /**
   * Lists analyses ordered by ID ascending with optional filters and cursor pagination.
   */
  async list(filters: {
    area_id?: string;
    status?: string;
    cursorId?: string;
    limit?: number;
  }): Promise<AnalysisRecord[]> {
    return wrapDbCall(async () => {
      const limit = filters.limit ?? 50;
      const conditions: Prisma.Sql[] = [];

      if (filters.cursorId) {
        conditions.push(Prisma.sql`id > ${filters.cursorId}::uuid`);
      }
      if (filters.area_id) {
        conditions.push(Prisma.sql`area_id = ${filters.area_id}::uuid`);
      }
      if (filters.status) {
        conditions.push(Prisma.sql`status = ${filters.status}`);
      }

      const whereClause =
        conditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
          : Prisma.empty;

      return await prisma.$queryRaw<AnalysisRecord[]>`
        SELECT
          id::text,
          area_id::text,
          release_id::text,
          start_date::text,
          end_date_exclusive::text,
          time_basis,
          metric_key,
          grid_id,
          selection_policy,
          weighting_version,
          baseline_spec,
          weather_policy,
          news_policy,
          request_spec,
          cache_key,
          status,
          error_code,
          created_at,
          completed_at
        FROM firebridge.analyses
        ${whereClause}
        ORDER BY id ASC
        LIMIT ${limit + 1};
      `;
    });
  }
};
