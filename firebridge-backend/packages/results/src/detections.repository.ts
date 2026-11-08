import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import {
  resultAvailability,
  type DetectionRow,
  type ExportInput,
  type ResultContext
} from './contracts.js';
import {
  nativeAreaSql,
  nativePartitionSources,
  nativeProcessingLevels,
  relevantNativePartitions,
  unsupportedNativePolicies
} from '@firebridge/contracts';

// Every serving path uses the frozen release/AOI/UTC/source/mode selection.
// EXISTS avoids duplicate detections present in several release partitions.
export function detectionSelection(
  analysisId: string,
  filters: ExportInput['filters'] = {},
  context?: ResultContext
): Prisma.Sql {
  return Prisma.sql`
    FROM firebridge.detections d
    JOIN firebridge.analyses a ON a.id = ${analysisId}::uuid
    JOIN firebridge.areas ar ON ar.id = a.area_id
    JOIN firebridge.analysis_components c ON c.analysis_id = a.id AND c.component = 'satellite'
    WHERE c.release_id=a.release_id
      AND d.processing_level=CASE a.request_spec->>'data_mode' WHEN 'standard_only' THEN 'standard'
        WHEN 'nrt_only' THEN 'nrt' ELSE NULL END
      ${
        context?.source_ids
          ? Prisma.empty
          : Prisma.sql`AND (CASE WHEN jsonb_typeof(a.request_spec->'source_ids')='array'
            THEN d.source_id IN(SELECT jsonb_array_elements_text(a.request_spec->'source_ids'))
            ELSE EXISTS(SELECT 1 FROM firebridge.release_partitions frozen_rp
              JOIN firebridge.data_partitions frozen_p ON frozen_p.id=frozen_rp.partition_id
              WHERE frozen_rp.release_id=a.release_id AND frozen_p.kind='detections'
              AND d.source_id IN(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(frozen_p.support_spec->'source_ids')='array'
                THEN frozen_p.support_spec->'source_ids' ELSE '[]'::jsonb END))) END)`
      }
      AND a.time_basis = 'utc' AND a.metric_key = 'native_detections_v1'
      AND a.selection_policy = 'standard' AND a.grid_id IS NULL
      AND a.status IN ('ready', 'partial') AND c.status = 'ready'
      AND d.acquired_at >= a.start_date::timestamp AT TIME ZONE 'UTC'
      AND d.acquired_at < a.end_date_exclusive::timestamp AT TIME ZONE 'UTC'
      AND ST_Covers(${Prisma.raw(nativeAreaSql('ar'))},d.geom)
      AND EXISTS (
        SELECT 1 FROM firebridge.partition_detections pd
        JOIN firebridge.release_partitions rp ON rp.partition_id = pd.partition_id
        JOIN firebridge.data_partitions dp ON dp.id = pd.partition_id
        WHERE pd.detection_id = d.id AND rp.release_id = c.release_id
          AND dp.kind = 'detections' AND dp.serving_complete AND dp.validation_status = 'validated'
          ${context?.partition_ids ? Prisma.sql`AND pd.partition_id=ANY(${context.partition_ids}::uuid[])` : Prisma.empty}
      )
      ${context?.source_ids ? Prisma.sql`AND d.source_id=ANY(${context.source_ids}::text[])` : Prisma.empty}
      ${filters.source_id ? Prisma.sql`AND d.source_id = ${filters.source_id}` : Prisma.empty}
      ${filters.day_night ? Prisma.sql`AND d.day_night = ${filters.day_night}` : Prisma.empty}
  `;
}

export async function findResultContext(
  analysisId: string,
  db: Prisma.TransactionClient = prisma
): Promise<ResultContext | null> {
  const rows = await db.$queryRaw<
    (ResultContext & {
      component_release_id: string | null;
      published_at: Date | null;
      start_date: string;
      end_date_exclusive: string;
      request_spec: Record<string, unknown>;
    })[]
  >`
    SELECT a.id::text, a.status, a.time_basis, a.metric_key, a.selection_policy, a.grid_id,
      a.release_id::text AS release_id,c.release_id::text AS component_release_id,
      c.status AS component_status, r.status AS release_status,r.published_at,a.completed_at,a.cache_key,
      a.start_date::text,a.end_date_exclusive::text,a.request_spec
    FROM firebridge.analyses a
    LEFT JOIN firebridge.analysis_components c ON c.analysis_id = a.id AND c.component = 'satellite'
    JOIN firebridge.data_releases r ON r.id = a.release_id
    WHERE a.id = ${analysisId}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  const result: ResultContext = {
    id: row.id,
    status: row.status,
    time_basis: row.time_basis,
    metric_key: row.metric_key,
    selection_policy: row.selection_policy,
    grid_id: row.grid_id,
    release_id: row.release_id,
    component_status: row.component_status,
    release_status: row.release_status,
    completed_at: row.completed_at,
    cache_key: row.cache_key,
    snapshot_status: 'unavailable'
  };
  if (row.component_release_id !== row.release_id)
    return { ...result, snapshot_status: 'inconsistent' };
  if (!row.published_at || row.release_status !== 'published') return result;
  const parts = await db.$queryRaw<
    {
      id: string;
      support_spec: Record<string, unknown>;
      row_count: bigint;
      stored_rows: bigint;
      validation_status: string;
      serving_complete: boolean;
    }[]
  >`
    SELECT p.id::text,p.support_spec,p.row_count,p.validation_status,p.serving_complete,
      (SELECT count(*) FROM firebridge.partition_detections pd WHERE pd.partition_id=p.id) AS stored_rows
    FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
    WHERE rp.release_id=${row.release_id}::uuid AND p.kind='detections' ORDER BY rp.series_key,rp.partition_key LIMIT 10001`;
  if (parts.length > 10000) return result;
  const spec = row.request_spec;
  const frozen = Array.isArray(spec.source_ids)
    ? spec.source_ids
    : parts.flatMap(nativePartitionSources);
  if (
    !frozen.length ||
    frozen.length > 100 ||
    !frozen.every((v) => typeof v === 'string' && v.length > 0)
  )
    return result;
  const sources = [...new Set(frozen as string[])].sort(),
    levels = nativeProcessingLevels(spec);
  if (!levels.length || unsupportedNativePolicies(spec))
    return { ...result, snapshot_status: 'unsupported' };
  const selected = relevantNativePartitions(
    parts,
    sources,
    Date.parse(row.start_date),
    Date.parse(row.end_date_exclusive)
  );
  if (
    !selected.length ||
    selected.some(
      (p) =>
        p.validation_status !== 'validated' ||
        !p.serving_complete ||
        String(p.row_count) !== String(p.stored_rows)
    )
  )
    return result;
  const known = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM firebridge.sources WHERE id=ANY(${sources}::text[])`;
  if (known.length !== sources.length) return result;
  return {
    ...result,
    snapshot_status: 'ready',
    partition_ids: selected.map((p) => p.id),
    source_ids: sources,
    processing_levels: levels
  };
}

export async function readDetectionBatch(
  db: Prisma.TransactionClient,
  analysisId: string,
  filters: ExportInput['filters'],
  after: string,
  limit: number,
  context?: ResultContext
): Promise<DetectionRow[]> {
  context ??= (await findResultContext(analysisId, db)) ?? undefined;
  if (!context || resultAvailability(context) !== 'ready')
    throw new Error('EXPORT_ANALYSIS_UNAVAILABLE');
  if (filters.source_id && !context.source_ids?.includes(filters.source_id))
    throw new Error('EXPORT_SOURCE_OUTSIDE_SELECTION');
  return db.$queryRaw<DetectionRow[]>(Prisma.sql`
    SELECT d.id::text, left(d.source_id, 1025) AS source_id,
      to_char(d.acquired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acquired_at,
      ST_X(d.geom) AS longitude, ST_Y(d.geom) AS latitude,
      left(d.confidence_raw, 1025) AS confidence_raw, d.day_night, d.frp_mw
    ${detectionSelection(analysisId, filters, context)}
    AND d.id > ${after}::bigint ORDER BY d.id LIMIT ${limit}
  `);
}
