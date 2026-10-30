/**
 * Areas service — Phase 2
 *
 * Responsibilities:
 *  1. Convert incoming GeoJSON Polygon coordinates to WKT.
 *  2. Compute canonical SHA-256 geometry hash for idempotent reuse.
 *  3. Validate geometry via PostGIS (ST_IsValid, non-empty, true geodesic ST_Area via WGS84 geography).
 *  4. Atomically insert or retrieve equivalent area: UNIQUE(geometry_sha256, version).
 *  5. Retrieve area detail with cell coverage, spatial grid info, and weights preparation status.
 */

import { createHash, randomUUID } from 'node:crypto';
import { BadRequestError, NotFoundError } from '../errors/app-error.js';
import {
  areasRepository,
  type AreaDetailRecord,
  type AreaRecord
} from '../repositories/areas.repository.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import {
  AREA_MAX_SURFACE_KM2,
  type AreaCreateInput,
  type AreaListQuery
} from '../validators/areas.validator.js';

export interface AreaResult {
  area: AreaRecord;
  created: boolean;
}

/**
 * Converts a GeoJSON Polygon's coordinates to a WKT POLYGON string.
 * GeoJSON coordinate order: [longitude, latitude]
 * WKT format: POLYGON((lon lat, lon lat, ...), (hole lon lat, ...))
 */
export function polygonCoordsToWkt(coordinates: number[][][]): string {
  const rings = coordinates.map((ring) => {
    const points = ring.map((pos) => `${pos[0]} ${pos[1]}`).join(', ');
    return `(${points})`;
  });
  return `POLYGON(${rings.join(', ')})`;
}

/**
 * Computes a stable, canonical SHA-256 of the GeoJSON Polygon geometry.
 * Coordinates are rounded to 8 decimal places (approx. 1.1 mm precision)
 * to absorb serialization jitter while preserving genuine geographic distinctions.
 */
export function computeGeometrySha256(geometry: AreaCreateInput['geometry']): string {
  const normalised = {
    type: geometry.type,
    coordinates: geometry.coordinates.map((ring) =>
      ring.map((pos) => pos.map((v) => Math.round(v * 1e8) / 1e8))
    )
  };
  return createHash('sha256').update(JSON.stringify(normalised)).digest('hex');
}

export const areasService = {
  /**
   * Validates and persists a new area or idempotently reuses an existing equivalent one.
   */
  async createArea(input: AreaCreateInput): Promise<AreaResult> {
    const { geometry, name, version, display_timezone, provenance } = input;

    // 1. Convert GeoJSON Polygon -> WKT
    const geomWkt = polygonCoordsToWkt(geometry.coordinates);

    // 2. Validate geometry via PostGIS using geodesic WGS84 geography measurement
    const validation = await areasRepository.validateGeometry(geomWkt, AREA_MAX_SURFACE_KM2);
    if (!validation.valid) {
      throw new BadRequestError(
        validation.reason ?? 'Geometry is invalid.',
        'VALIDATION_ERROR'
      );
    }

    // 3. Compute canonical geometry SHA-256
    const geometry_sha256 = computeGeometrySha256(geometry);

    // 4. Atomically insert or reuse
    return areasRepository.createAtomic({
      id: randomUUID(),
      name,
      version,
      geomWkt,
      geometry_sha256,
      display_timezone,
      provenance
    });
  },

  /**
   * Retrieves an area by its unique identifier along with spatial coverage details.
   */
  async getAreaById(areaId: string): Promise<AreaDetailRecord> {
    const area = await areasRepository.findById(areaId);
    if (!area) {
      throw new NotFoundError(`Area with id '${areaId}' was not found.`);
    }
    return area;
  },

  /**
   * Lists areas with cursor-based pagination.
   */
  async list(query: AreaListQuery): Promise<{ areas: AreaRecord[]; nextCursor: string | null }> {
    let cursorId: string | undefined;

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      cursorId = decoded.id;
    }

    const records = await areasRepository.list(cursorId, query.limit);

    const hasMore = records.length > query.limit;
    const areas = hasMore ? records.slice(0, query.limit) : records;
    const lastArea = hasMore ? areas[areas.length - 1] : null;

    const nextCursor =
      hasMore && lastArea
        ? encodeCursor({
            id: lastArea.id
          })
        : null;

    return {
      areas,
      nextCursor
    };
  }
};
