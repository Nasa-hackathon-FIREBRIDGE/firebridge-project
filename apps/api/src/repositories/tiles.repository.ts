import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import { detectionSelection, resultsConfig } from '@firebridge/results';
import type { TileParams } from '../validators/results.validator.js';

export function detectionTileSql({ id, z, x, y }: TileParams): Prisma.Sql {
  // Points need no line/polygon simplification. Quantize/aggregate on a fixed
  // world grid (64x64 cells per tile), so even dense high-zoom tiles stay bounded.
  const cellSize = 40075016.68557849 / 2 ** z / 64;
  return Prisma.sql`
    WITH bounds AS (SELECT ST_TileEnvelope(${z}::int, ${x}::int, ${y}::int) AS geom),
    selected AS (
      SELECT ST_Transform(d.geom, 3857) AS geom, d.frp_mw
      ${detectionSelection(id)}
      AND d.geom && (SELECT ST_Transform(geom, 4326) FROM bounds)
      AND ST_Intersects(d.geom, (SELECT ST_Transform(geom, 4326) FROM bounds))
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
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL search_path = firebridge, public`;
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(resultsConfig.TILE_QUERY_TIMEOUT_MS)}, true)`;
      await tx.$executeRaw`SET LOCAL work_mem = '8MB'`;
      const rows = await tx.$queryRaw<{ tile: Uint8Array }[]>(detectionTileSql(params));
      return Buffer.from(rows[0]?.tile ?? []);
    }, { timeout: resultsConfig.TILE_QUERY_TIMEOUT_MS + 2000 });
  }
};
