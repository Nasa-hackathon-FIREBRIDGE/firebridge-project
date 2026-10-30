import { createHash } from 'node:crypto';
import { NotFoundError } from '../errors/app-error.js';
import {
  analysesRepository,
  type AnalysisDetail,
  type AnalysisRecord
} from '../repositories/analyses.repository.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import type {
  AnalysisCreateInput,
  AnalysisListQuery
} from '../validators/analyses.validator.js';

export interface CreateAnalysisResult {
  detail: AnalysisDetail;
  created: boolean;
}

export function computeAnalysisCacheKey(input: {
  area_id: string;
  start_date: string;
  end_date_exclusive: string;
  time_basis: string;
  metric_key: string;
  grid_id: null;
  data_mode: string;
  selection_policy: string;
  weighting_version: string;
}): string {
  const canonical = {
    area_id: input.area_id.toLowerCase(),
    data_mode: input.data_mode,
    end_date_exclusive: input.end_date_exclusive,
    grid_id: input.grid_id,
    metric_key: input.metric_key,
    selection_policy: input.selection_policy,
    start_date: input.start_date,
    time_basis: input.time_basis,
    weighting_version: input.weighting_version
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export const analysesService = {
  /**
   * Resolves releases and creates analysis atomically with REPEATABLE READ transaction.
   * Fixed Phase 2 context is strictly enforced:
   *   metric_key = 'native_detections_v1'
   *   grid_id    = null
   *   data_mode  = 'standard_only'
   */
  async createAnalysis(
    input: AnalysisCreateInput,
    requestedBy = 'anonymous',
    idempotencyKeyHeader?: string
  ): Promise<CreateAnalysisResult> {
    const FIXED_METRIC_KEY = 'native_detections_v1';
    const FIXED_GRID_ID = null;
    const FIXED_DATA_MODE = 'standard_only';

    const cacheKey = computeAnalysisCacheKey({
      area_id: input.area_id,
      start_date: input.start_date,
      end_date_exclusive: input.end_date_exclusive,
      time_basis: input.time_basis,
      metric_key: FIXED_METRIC_KEY,
      grid_id: FIXED_GRID_ID,
      data_mode: FIXED_DATA_MODE,
      selection_policy: input.selection_policy,
      weighting_version: input.weighting_version
    });

    const idempotencyKey = idempotencyKeyHeader?.trim() || `auto:${cacheKey}`;

    const requestSpec: Record<string, unknown> = {
      area_id: input.area_id,
      start_date: input.start_date,
      end_date_exclusive: input.end_date_exclusive,
      time_basis: input.time_basis,
      metric_key: FIXED_METRIC_KEY,
      grid_id: FIXED_GRID_ID,
      data_mode: FIXED_DATA_MODE,
      selection_policy: input.selection_policy,
      weighting_version: input.weighting_version,
      baseline_spec: input.baseline_spec ?? null,
      weather_policy: input.weather_policy,
      news_policy: input.news_policy
    };

    return await analysesRepository.createAnalysisTransaction({
      area_id: input.area_id,
      start_date: input.start_date,
      end_date_exclusive: input.end_date_exclusive,
      time_basis: input.time_basis,
      metric_key: FIXED_METRIC_KEY,
      grid_id: FIXED_GRID_ID,
      selection_policy: input.selection_policy,
      weighting_version: input.weighting_version,
      baseline_spec: input.baseline_spec ?? null,
      weather_policy: input.weather_policy,
      news_policy: input.news_policy,
      request_spec: requestSpec,
      cache_key: cacheKey,
      idempotency_key: idempotencyKey,
      requested_by: requestedBy
    });
  },

  /**
   * Retrieves an analysis by ID, evaluating component readiness.
   * Partial status rule:
   * If only the satellite component is ready and other components (weather/reports) are missing,
   * returns status: 'partial'.
   */
  async getAnalysisById(analysisId: string): Promise<AnalysisDetail> {
    const detail = await analysesRepository.findById(analysisId);
    if (!detail) {
      throw new NotFoundError(`Analysis with id '${analysisId}' was not found.`);
    }

    // Evaluate partial status rule
    const satelliteComponent = detail.components.find((c) => c.component === 'satellite');
    const nonSatelliteComponents = detail.components.filter((c) => c.component !== 'satellite');

    const satelliteReady = satelliteComponent?.status === 'ready';
    const hasIncompleteOtherComponents = nonSatelliteComponents.some(
      (c) => c.status !== 'ready'
    );

    let effectiveStatus = detail.analysis.status;
    if (satelliteReady && hasIncompleteOtherComponents) {
      // Per specification: if only satellite is ready, status is partial
      effectiveStatus = 'partial';
    }

    return {
      ...detail,
      analysis: {
        ...detail.analysis,
        status: effectiveStatus
      }
    };
  },

  /**
   * Lists analyses with optional filters and cursor pagination.
   */
  async list(
    query: AnalysisListQuery
  ): Promise<{ analyses: AnalysisRecord[]; nextCursor: string | null }> {
    let cursorId: string | undefined;

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor, {
        area_id: query.area_id,
        status: query.status
      });
      cursorId = decoded.id;
    }

    const records = await analysesRepository.list({
      area_id: query.area_id,
      status: query.status,
      cursorId,
      limit: query.limit
    });

    const hasMore = records.length > query.limit;
    const analyses = hasMore ? records.slice(0, query.limit) : records;
    const lastAnalysis = hasMore ? analyses[analyses.length - 1] : null;

    const nextCursor =
      hasMore && lastAnalysis
        ? encodeCursor({
            id: lastAnalysis.id,
            filters: {
              ...(query.area_id ? { area_id: query.area_id } : {}),
              ...(query.status ? { status: query.status } : {})
            }
          })
        : null;

    return {
      analyses,
      nextCursor
    };
  }
};

