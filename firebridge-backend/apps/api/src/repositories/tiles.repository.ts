import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import {
  detectionSelection,
  findResultContext,
  resultAvailability,
  resultsConfig,
  type ResultContext
} from '@firebridge/results';
import { ConflictError } from '../errors/app-error.js';
import type { TileParams } from '../validators/results.validator.js';

export function detectionTileSql({ id, z, x, y }: TileParams, context?: ResultContext): Prisma.Sql {
  // Points need no line/polygon simplification. Quantize/aggregate on a fixed
  // world grid (64x64 cells per tile), so even dense high-zoom tiles stay bounded.
  const cellSize = 40075016.68557849 / 2 ** z / 64;
  // Keep the tile envelope visible to the planner. A scalar CTE subquery hides
  // its selectivity and can make a world tile scan every detection before AOI clipping.
  const envelope = Prisma.sql`ST_TileEnvelope(${z}::int, ${x}::int, ${y}::int)`;
  const envelopeWgs84 = Prisma.sql`ST_Transform(${envelope}, 4326)`;
  return Prisma.sql`
    WITH bounds AS (SELECT ${envelope} AS geom),
    selected AS (
      SELECT ST_Transform(d.geom, 3857) AS geom, d.frp_mw
      ${detectionSelection(id, {}, context)}
      AND d.geom && ${envelopeWgs84}
      AND ST_Intersects(d.geom, ${envelopeWgs84})
      AND ST_Y(d.geom) BETWEEN -85.0511287798066 AND 85.0511287798066
    ), aggregated AS (
      SELECT ST_SnapToGrid(geom, ${cellSize}) AS point, count(*)::double precision AS count,
        max(frp_mw) AS frp_mw FROM selected GROUP BY 1
    ), features AS (
      SELECT count, frp_mw, ST_AsMVTGeom(point, bounds.geom, 4096, 64, true) AS geom
      FROM aggregated CROSS JOIN bounds
    )
    SELECT ST_AsMVT(features, 'detections', 4096, 'geom') AS tile FROM features
    WHERE geom IS NOT NULL
  `;
}

export const tilesRepository = {
  async detections(params: TileParams): Promise<Buffer> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(resultsConfig.TILE_QUERY_TIMEOUT_MS)}, true)`;
        await tx.$executeRaw`SET LOCAL work_mem = '8MB'`;
        // Tile selectivity varies greatly with XYZ; a cached generic plan can
        // choose a world scan for a small AOI. Preserve parameter-aware planning.
        await tx.$executeRaw`SET LOCAL plan_cache_mode = force_custom_plan`;
        const context = await findResultContext(params.id, tx);
        if (!context || resultAvailability(context) !== 'ready')
          throw new ConflictError('Analysis snapshot is not fully servable.');
        const rows = await tx.$queryRaw<{ tile: Uint8Array }[]>(detectionTileSql(params, context));
        return Buffer.from(rows[0]?.tile ?? []);
      },
      { timeout: resultsConfig.TILE_QUERY_TIMEOUT_MS + 2000, isolationLevel: 'RepeatableRead' }
    );
  }
};
