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
import { env } from '../config/env.js';
import {
  areasRepository,
  type AreaDetailRecord,
  type AreaRecord
} from '../repositories/areas.repository.js';
import { decodeCursor, encodeCursor } from '../utils/sources-cursor.js';
import {
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
    coordinates: normalizePolygon(geometry).coordinates.map((ring) =>
      ring.map((pos) => pos.map((v) => Math.round(v * 1e8) / 1e8))
    )
  };
  return createHash('sha256').update(JSON.stringify(normalised)).digest('hex');
}

/** Unwrap short edges before planar validation; align holes with the exterior. */
export function normalizePolygon(geometry: AreaCreateInput['geometry']): AreaCreateInput['geometry'] {
  const unwrap = (ring: number[][]): number[][] => {
    const result: number[][] = [];
    for (const position of ring) {
      let longitude = position[0]!;
      const previous = result[result.length - 1]?.[0];
      if (previous !== undefined) {
        while (longitude - previous > 180) longitude -= 360;
        while (longitude - previous < -180) longitude += 360;
        if (Math.abs(longitude - previous) === 180) throw new BadRequestError('A 180-degree edge is ambiguous.', 'VALIDATION_ERROR');
      }
      result.push([longitude, position[1]!]);
    }
    if (result[0]![0] !== result[result.length - 1]![0]) throw new BadRequestError('Polygon winds around the globe.', 'VALIDATION_ERROR');
    return result;
  };
  const rings = geometry.coordinates.map(unwrap);
  const centre = (ring: number[][]) => (Math.min(...ring.map((p) => p[0]!)) + Math.max(...ring.map((p) => p[0]!))) / 2;
  const outerCentre = centre(rings[0]!);
  const shift = Math.floor((outerCentre + 180) / 360) * 360;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]!;
    const alignment = i === 0 ? 0 : Math.round((outerCentre - centre(ring)) / 360) * 360;
    for (const position of ring) position[0] = position[0]! + alignment - shift;
  }
  const canonical = (closed: number[][]): number[][] => {
    const ring = closed.slice(0, -1);
    const compare = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]!;
    let start = 0;
    for (let i = 1; i < ring.length; i++) if (compare(ring[i]!, ring[start]!) < 0) start = i;
    const forward = Array.from({ length: ring.length }, (_, i) => ring[(start + i) % ring.length]!);
    const reverse = Array.from({ length: ring.length }, (_, i) => ring[(start - i + ring.length) % ring.length]!);
    const chosen = JSON.stringify(forward) < JSON.stringify(reverse) ? forward : reverse;
    return [...chosen, chosen[0]!];
  };
  const exterior = canonical(rings[0]!);
  const holes = rings.slice(1).map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { type: 'Polygon', coordinates: [exterior, ...holes] };
}

export const areasService = {
  /**
   * Validates and persists a new area or idempotently reuses an existing equivalent one.
   */
  async createArea(input: AreaCreateInput): Promise<AreaResult> {
    const { geometry, name, version, display_timezone, provenance } = input;

    // 1. Convert GeoJSON Polygon -> WKT
    const geomWkt = polygonCoordsToWkt(normalizePolygon(geometry).coordinates);

    // 2. Validate geometry via PostGIS using geodesic WGS84 geography measurement
    const validation = await areasRepository.validateGeometry(geomWkt, env.MAX_AOI_AREA_KM2);
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
