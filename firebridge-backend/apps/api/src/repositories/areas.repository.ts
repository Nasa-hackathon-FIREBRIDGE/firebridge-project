/**
 * Areas repository — PostgreSQL + PostGIS parameterized queries
 *
 * Database schema (firebridge.areas):
 *   id               uuid PRIMARY KEY
 *   name             text NOT NULL
 *   version          text NOT NULL
 *   geom             geometry(MultiPolygon,4326) NOT NULL
 *   geometry_sha256  text NOT NULL
 *   display_timezone text NOT NULL
 *   provenance       text NOT NULL
 *   created_at       timestamptz NOT NULL DEFAULT now()
 *   UNIQUE(geometry_sha256, version)
 *   CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
 */

import { prisma } from '@firebridge/database';
import { Prisma } from '@prisma/client';
import { nativeAreaSql } from '@firebridge/contracts';
import { ServiceUnavailableError } from '../errors/app-error.js';

// ST_WrapX splits at the dateline before translating pieces, including holes.
export function normalizedAreaGeometry(wkt: string): Prisma.Sql {
  return Prisma.sql`ST_Multi(ST_CollectionExtract(ST_WrapX(ST_WrapX(ST_GeomFromText(${wkt},4326),180,-360),-180,360),3))`;
}

// Normalize historical unsplit dateline areas in responses without rewriting stored data.
const areaReadGeometry = Prisma.sql`ST_Multi(ST_CollectionExtract(${Prisma.raw(nativeAreaSql('areas'))},3))`;

// Pipeline scope areas can cover the whole world. Their pole-to-pole edges are
// antipodal and cannot be cast to geography. The global cylindrical equal-area
// projection measures that world rectangle without a geography edge ambiguity.
// Ordinary user AOIs retain the existing ellipsoidal/geodesic measurement.
const areaReadSurface = Prisma.sql`ROUND(((CASE
  WHEN ST_XMax(Box3D(geom)) - ST_XMin(Box3D(geom)) >= 359.999
   AND ST_YMax(Box3D(geom)) - ST_YMin(Box3D(geom)) >= 179.999
  THEN ST_Area(ST_Transform(geom,6933))
  ELSE ST_Area(geom::geography)
END) / 1e6)::numeric, 4)::float8`;


export interface AreaRecord {
  id: string;
  name: string;
  version: string;
  geometry_sha256: string;
  display_timezone: string;
  provenance: string;
  created_at: Date;
  geom_geojson: string;
  surface_km2?: number;
}

export interface AreaDetailRecord extends AreaRecord {
  surface_km2: number;
  weights_status: 'prepared' | 'not_prepared';
  cells_count: number;
  total_overlap_land_area_m2: number;
  grid: {
    id: string;
    version: string;
    cell_size_m: number;
  } | null;
}

export interface CreateAreaInput {
  id: string;
  name: string;
  version: string;
  geomWkt: string;
  geometry_sha256: string;
  display_timezone: string;
  provenance: string;
}

async function wrapDbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;

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

export const areasRepository = {
  /**
   * Looks up an area by geometry_sha256 + version.
   */
  async findByGeometrySha256AndVersion(
    geometry_sha256: string,
    version: string
  ): Promise<AreaRecord | null> {
    return wrapDbCall(async () => {
      const rows = await prisma.$queryRaw<AreaRecord[]>`
        SELECT
          id::text AS id,
          name,
          version,
          geometry_sha256,
          display_timezone,
          provenance,
          created_at,
          ST_AsGeoJSON(${areaReadGeometry})::text AS geom_geojson,
          ${areaReadSurface} AS surface_km2
        FROM firebridge.areas
        WHERE geometry_sha256 = ${geometry_sha256}
          AND version         = ${version}
        LIMIT 1
      `;
      return rows[0] ?? null;
    });
  },

  /**
   * Atomically inserts an area row or detects existing conflict on (geometry_sha256, version).
   * Returns { area, created: true } if inserted, or { area, created: false } if conflicting row existed.
   */
  async createAtomic(input: CreateAreaInput): Promise<{ area: AreaRecord; created: boolean }> {
    return wrapDbCall(async () => {
      // Atomic insert with ON CONFLICT DO NOTHING
      const insertedRows = await prisma.$queryRaw<AreaRecord[]>`
        INSERT INTO firebridge.areas
          (id, name, version, geom, geometry_sha256, display_timezone, provenance)
        VALUES (
          ${input.id}::uuid,
          ${input.name},
          ${input.version},
          ${normalizedAreaGeometry(input.geomWkt)},
          ${input.geometry_sha256},
          ${input.display_timezone},
          ${input.provenance}
        )
        ON CONFLICT (geometry_sha256, version) DO NOTHING
        RETURNING
          id::text AS id,
          name,
          version,
          geometry_sha256,
          display_timezone,
          provenance,
          created_at,
          ST_AsGeoJSON(${areaReadGeometry})::text AS geom_geojson,
          ${areaReadSurface} AS surface_km2
      `;

      if (insertedRows.length > 0 && insertedRows[0]) {
        return { area: insertedRows[0], created: true };
      }

      // If conflicting row already existed, fetch it atomically
      const existing = await areasRepository.findByGeometrySha256AndVersion(
        input.geometry_sha256,
        input.version
      );

      if (!existing) {
        throw new Error('Concurrent area insert conflict, but existing record could not be loaded.');
      }

      return { area: existing, created: false };
    });
  },

  /**
   * Finds an area by primary key (id) and loads its spatial, cell, and grid coverage information.
   */
  async findById(areaId: string): Promise<AreaDetailRecord | null> {
    return wrapDbCall(async () => {
      // Check if valid UUID to prevent database casting error
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(areaId)) {
        return null;
      }

      const areaRows = await prisma.$queryRaw<AreaRecord[]>`
        SELECT
          id::text AS id,
          name,
          version,
          geometry_sha256,
          display_timezone,
          provenance,
          created_at,
          ST_AsGeoJSON(${areaReadGeometry})::text AS geom_geojson,
          ${areaReadSurface} AS surface_km2
        FROM firebridge.areas
        WHERE id = ${areaId}::uuid
        LIMIT 1
      `;

      const area = areaRows[0];
      if (!area) {
        return null;
      }

      type CellInfoRow = {
        weighting_version: string | null;
        cells_count: number;
        total_overlap_land_area_m2: number;
        grid_id: string | null;
        grid_version: string | null;
        grid_cell_size_m: number | null;
      };

      const cellRows = await prisma.$queryRaw<CellInfoRow[]>`
        SELECT
          ac.weighting_version,
          COUNT(ac.cell_id)::int AS cells_count,
          COALESCE(SUM(ac.overlap_land_area_m2), 0)::float8 AS total_overlap_land_area_m2,
          g.id AS grid_id,
          g.version AS grid_version,
          g.cell_size_m AS grid_cell_size_m
        FROM firebridge.area_cells ac
        JOIN firebridge.grid_cells gc ON gc.id = ac.cell_id
        JOIN firebridge.grids g ON g.id = gc.grid_id
        WHERE ac.area_id = ${areaId}::uuid
        GROUP BY ac.weighting_version, g.id, g.version, g.cell_size_m
        LIMIT 1
      `;

      const cellInfo = cellRows[0];
      const hasWeights = Boolean(cellInfo && cellInfo.cells_count > 0);

      return {
        ...area,
        surface_km2: Number(area.surface_km2 ?? 0),
        weights_status: hasWeights ? 'prepared' : 'not_prepared',
        cells_count: cellInfo ? Number(cellInfo.cells_count) : 0,
        total_overlap_land_area_m2: cellInfo ? Number(cellInfo.total_overlap_land_area_m2) : 0,
        grid:
          cellInfo && cellInfo.grid_id && cellInfo.grid_version && cellInfo.grid_cell_size_m
            ? {
                id: cellInfo.grid_id,
                version: cellInfo.grid_version,
                cell_size_m: Number(cellInfo.grid_cell_size_m)
              }
            : null
      };
    });
  },

  /**
   * Validates the geometry via PostGIS.
   * Uses geodesic measurement on WGS 84 ellipsoid (ST_Area(geom::geography))
   * to avoid Web Mercator projection distortion at high latitudes or across the antimeridian.
   */
  async validateGeometry(
    geomWkt: string,
    maxAreaKm2: number
  ): Promise<{ valid: boolean; reason?: string; areakm2?: number }> {
    return wrapDbCall(async () => {
      type ValidationRow = {
        is_valid: boolean;
        is_empty: boolean;
        validity_reason: string | null;
        area_km2: number;
      };

      const rows = await prisma.$queryRaw<ValidationRow[]>`
        WITH raw AS (SELECT ST_GeomFromText(${geomWkt},4326) AS geom)
        SELECT ST_IsValid(geom) AS is_valid, ST_IsEmpty(geom) AS is_empty,
          ST_IsValidReason(geom) AS validity_reason,
          CASE WHEN ST_IsValid(geom) AND NOT ST_IsEmpty(geom)
            THEN ST_Area((${normalizedAreaGeometry(geomWkt)})::geography) / 1e6
            ELSE 0 END AS area_km2 FROM raw
      `;

      const row = rows[0];
      if (!row) {
        return { valid: false, reason: 'PostGIS validation returned no result.' };
      }

      if (row.is_empty) {
        return { valid: false, reason: 'Geometry is empty or degenerate.' };
      }

      if (!row.is_valid) {
        return {
          valid: false,
          reason: row.validity_reason ?? 'Geometry is not valid (ST_IsValid returned false).',
          areakm2: Number(row.area_km2)
        };
      }

      const areakm2 = Number(row.area_km2);
      if (areakm2 <= 0) {
        return {
          valid: false,
          reason: 'Geometry has zero surface area.',
          areakm2
        };
      }

      if (areakm2 > maxAreaKm2) {
        return {
          valid: false,
          reason: `Polygon surface area (${areakm2.toFixed(0)} km²) exceeds the maximum allowed (${maxAreaKm2.toLocaleString()} km²).`,
          areakm2
        };
      }

      return { valid: true, areakm2 };
    });
  },

  /**
   * Lists areas ordered by ID ascending with cursor pagination.
   */
  async list(cursorId?: string, limit: number = 50): Promise<AreaRecord[]> {
    return wrapDbCall(async () => {
      if (cursorId) {
        return prisma.$queryRaw<AreaRecord[]>`
          SELECT
            id::text AS id,
            name,
            version,
            geometry_sha256,
            display_timezone,
            provenance,
            created_at,
            ST_AsGeoJSON(geom)::text AS geom_geojson,
            ${areaReadSurface} AS surface_km2
          FROM firebridge.areas
          WHERE id > ${cursorId}::uuid
          ORDER BY id ASC
          LIMIT ${limit + 1};
        `;
      }

      return prisma.$queryRaw<AreaRecord[]>`
        SELECT
          id::text AS id,
          name,
          version,
          geometry_sha256,
          display_timezone,
          provenance,
          created_at,
          ST_AsGeoJSON(geom)::text AS geom_geojson,
          ${areaReadSurface} AS surface_km2
        FROM firebridge.areas
        ORDER BY id ASC
        LIMIT ${limit + 1};
      `;
    });
  }
};
