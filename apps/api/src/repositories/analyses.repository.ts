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
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../errors/app-error.js';

export interface DataReleaseRecord {
  id: string;
  name: string;
  status: string;
  stream: string;
  dataset_kind: string;
  observation_cutoff: Date;
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
  requested_by: string;
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
  cache_key: string;
  idempotency_key: string;
  requested_by: string;
}

async function wrapDbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof NotFoundError || error instanceof ServiceUnavailableError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('connection') ||
      (error instanceof Prisma.PrismaClientInitializationError) ||
      (error instanceof Prisma.PrismaClientRustPanicError)
    ) {
      throw new ServiceUnavailableError('Database is currently unavailable.');
    }

    throw error;
  }
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
  async findByCacheKey(cacheKey: string): Promise<AnalysisDetail | null> {
    return wrapDbCall(async () => {
      const rows = await prisma.$queryRaw<AnalysisRecord[]>`
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

      const components = await prisma.$queryRaw<AnalysisComponentRecord[]>`
        SELECT
          analysis_id::text,
          component,
          release_id::text,
          status,
          reasons
        FROM firebridge.analysis_components
        WHERE analysis_id = ${analysis.id}::uuid;
      `;

      const jobs = await prisma.$queryRaw<ApiJobRecord[]>`
        SELECT
          id::text,
          kind,
          analysis_id::text,
          explanation_id::text,
          requested_by,
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
  async findById(analysisId: string): Promise<AnalysisDetail | null> {
    return wrapDbCall(async () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(analysisId)) {
        return null;
      }

      const rows = await prisma.$queryRaw<AnalysisRecord[]>`
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

      const components = await prisma.$queryRaw<AnalysisComponentRecord[]>`
        SELECT
          analysis_id::text,
          component,
          release_id::text,
          status,
          reasons
        FROM firebridge.analysis_components
        WHERE analysis_id = ${analysisId}::uuid;
      `;

      const jobs = await prisma.$queryRaw<ApiJobRecord[]>`
        SELECT
          id::text,
          kind,
          analysis_id::text,
          explanation_id::text,
          requested_by,
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
      // 1. First check if equivalent analysis already exists (idempotency check)
      const existing = await analysesRepository.findByCacheKey(input.cache_key);
      if (existing) {
        return { detail: existing, created: false };
      }

      // Ensure metric definition exists
      await analysesRepository.ensureMetricDefinition(input.metric_key);

      // Execute atomic transaction with REPEATABLE READ
      return await prisma.$transaction(
        async (tx) => {
          // 2. Validate area exists
          const areaRows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text FROM firebridge.areas WHERE id = ${input.area_id}::uuid LIMIT 1;
          `;
          if (areaRows.length === 0) {
            throw new BadRequestError(`Area with id '${input.area_id}' does not exist.`, 'VALIDATION_ERROR');
          }

          // 3. Resolve published satellite release covering the observation window
          const satelliteReleases = await tx.$queryRaw<DataReleaseRecord[]>`
            SELECT
              id::text,
              name,
              status,
              stream,
              dataset_kind,
              observation_cutoff
            FROM firebridge.data_releases
            WHERE dataset_kind = 'satellite'
              AND status = 'published'
              AND observation_cutoff >= ${input.end_date_exclusive}::timestamptz
            ORDER BY observation_cutoff DESC, created_at DESC
            LIMIT 1;
          `;

          const satelliteRelease = satelliteReleases[0];
          if (!satelliteRelease) {
            throw new BadRequestError(
              'No published satellite release covers the requested time window.',
              'NO_COMPATIBLE_RELEASE'
            );
          }

          // Resolve optional weather and reports releases
          const weatherReleases = await tx.$queryRaw<DataReleaseRecord[]>`
            SELECT id::text, name, status, stream, dataset_kind, observation_cutoff
            FROM firebridge.data_releases
            WHERE dataset_kind = 'weather'
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
              AND status = 'published'
              AND observation_cutoff >= ${input.end_date_exclusive}::timestamptz
            ORDER BY observation_cutoff DESC, created_at DESC
            LIMIT 1;
          `;
          const reportRelease = reportReleases[0] ?? null;

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
              ${JSON.stringify(input.request_spec)}::jsonb,
              ${input.cache_key},
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
              'ready',
              '[]'::jsonb
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
              requested_by,
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
              ${input.requested_by},
              ${input.cache_key},
              ${input.idempotency_key},
              ${JSON.stringify(input.request_spec)}::jsonb,
              'queued',
              0,
              '{"percent": 0, "stage": "queued"}'::jsonb
            );
          `;

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
              requested_by,
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

