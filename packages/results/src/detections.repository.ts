import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import type { DetectionRow, ExportInput, ResultContext } from './contracts.js';

// Every serving path uses the same frozen release/AOI/UTC/standard selection.
// EXISTS avoids duplicate detections present in several release partitions.
export function detectionSelection(analysisId: string, filters: ExportInput['filters'] = {}): Prisma.Sql {
  return Prisma.sql`
    FROM firebridge.detections d
    JOIN firebridge.analyses a ON a.id = ${analysisId}::uuid
    JOIN firebridge.areas ar ON ar.id = a.area_id
    JOIN firebridge.analysis_components c ON c.analysis_id = a.id AND c.component = 'satellite'
    WHERE d.processing_level = 'standard'
      AND a.time_basis = 'utc' AND a.metric_key = 'native_detections_v1'
      AND a.selection_policy = 'standard' AND a.grid_id IS NULL
      AND a.status IN ('ready', 'partial') AND c.status = 'ready'
      AND d.acquired_at >= a.start_date::timestamp AT TIME ZONE 'UTC'
      AND d.acquired_at < a.end_date_exclusive::timestamp AT TIME ZONE 'UTC'
      AND d.geom && ar.geom AND ST_Intersects(d.geom, ar.geom)
      AND EXISTS (
        SELECT 1 FROM firebridge.partition_detections pd
        JOIN firebridge.release_partitions rp ON rp.partition_id = pd.partition_id
        JOIN firebridge.data_partitions dp ON dp.id = pd.partition_id
        WHERE pd.detection_id = d.id AND rp.release_id = c.release_id
          AND dp.kind = 'detections' AND dp.serving_complete AND dp.validation_status = 'validated'
      )
      ${filters.source_id ? Prisma.sql`AND d.source_id = ${filters.source_id}` : Prisma.empty}
      ${filters.day_night ? Prisma.sql`AND d.day_night = ${filters.day_night}` : Prisma.empty}
  `;
}

export async function findResultContext(analysisId: string, db: Prisma.TransactionClient = prisma): Promise<ResultContext | null> {
  const rows = await db.$queryRaw<ResultContext[]>`
    SELECT a.id::text, a.status, a.time_basis, a.metric_key, a.selection_policy, a.grid_id,
      COALESCE(c.release_id, a.release_id)::text AS release_id,
      c.status AS component_status, r.status AS release_status, a.completed_at, a.cache_key
    FROM firebridge.analyses a
    LEFT JOIN firebridge.analysis_components c ON c.analysis_id = a.id AND c.component = 'satellite'
    JOIN firebridge.data_releases r ON r.id = COALESCE(c.release_id, a.release_id)
    WHERE a.id = ${analysisId}::uuid
  `;
  return rows[0] ?? null;
}

export async function readDetectionBatch(db: Prisma.TransactionClient, analysisId: string,
  filters: ExportInput['filters'], after: string, limit: number): Promise<DetectionRow[]> {
  return db.$queryRaw<DetectionRow[]>(Prisma.sql`
    SELECT d.id::text, left(d.source_id, 1025) AS source_id,
      to_char(d.acquired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acquired_at,
      ST_X(d.geom) AS longitude, ST_Y(d.geom) AS latitude,
      left(d.confidence_raw, 1025) AS confidence_raw, d.day_night, d.frp_mw
    ${detectionSelection(analysisId, filters)}
    AND d.id > ${after}::bigint ORDER BY d.id LIMIT ${limit}
  `);
}
