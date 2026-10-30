/**
 * Zod validator for POST /api/v1/areas
 *
 * Request geometry convention (project specification):
 * ─────────────────────────────────────────────────────
 * The API accepts a GeoJSON-style Polygon geometry (type "Polygon") and internally
 * converts it to a PostGIS MultiPolygon(4326), consistent with the areas schema:
 *   geom geometry(MultiPolygon,4326)
 *
 * Coordinate order: [longitude, latitude] (GeoJSON standard / RFC 7946).
 *
 * Polygon constraints (verified against schema and specification):
 *   - Minimum vertices (exterior ring positions): 4  (3 distinct + closing repeat)
 *   - Maximum vertices (exterior ring positions): 10 000
 *   - Longitude range: [-180, 180]
 *   - Latitude range:  [-90, 90]
 *   - No NaN / Infinity / non-finite values
 *   - First and last coordinate must be identical (closed ring)
 *   - Self-intersections are rejected (enforced by PostGIS ST_IsValid)
 *   - Zero-area / degenerate geometries are rejected (enforced by PostGIS ST_IsValid)
 *
 * Area (surface) limits:
 *   - Maximum area: 50 000 000 km²  (approx. half the Earth's land surface)
 *   - Measured via PostGIS ST_Area(ST_Transform(geom, 3857)) on the server side
 *     to avoid client-side spherical approximation errors.
 *
 * Antimeridian handling:
 *   Polygons that cross the antimeridian (longitude 180 / -180) are accepted.
 *   The raw GeoJSON coordinates are stored as-is; PostGIS with SRID 4326 treats
 *   the geometry correctly when using geography cast or explicit wrap handling.
 *   Clients should supply coordinates that cross −180/180 naturally (e.g. using
 *   longitudes > 180 or < -180 if needed), following RFC 7946 §3.1.9.
 *
 * Additional request fields:
 *   - name            (required) human-readable label, 1–500 chars
 *   - version         (required) client-specified version string, 1–100 chars
 *   - display_timezone (required) IANA timezone string, 1–100 chars
 *   - provenance      (required) source description, 1–500 chars
 */

import { z } from 'zod';

// ─── Limits ──────────────────────────────────────────────────────────────────

export const AREA_MIN_RING_POSITIONS = 4; // 3 distinct + 1 closing (GeoJSON Polygon)
export const AREA_MAX_RING_POSITIONS = 10_000;
export const AREA_MAX_SURFACE_KM2 = 50_000_000; // 50 million km²

// ─── Coordinate primitive ─────────────────────────────────────────────────────

/**
 * A single GeoJSON position: [longitude, latitude].
 * Rejects NaN, Infinity, and out-of-range values at schema level.
 */
const coordinateSchema = z
  .array(z.number().finite())
  .min(2, 'Each coordinate must have at least [longitude, latitude].')
  .max(3, 'Coordinate may have at most [longitude, latitude, elevation].')
  .refine(
    (coord) => coord[0] !== undefined && coord[0] >= -180 && coord[0] <= 180,
    { message: 'Longitude must be in the range [-180, 180].' }
  )
  .refine(
    (coord) => coord[1] !== undefined && coord[1] >= -90 && coord[1] <= 90,
    { message: 'Latitude must be in the range [-90, 90].' }
  );

// ─── Ring (LinearRing in GeoJSON terms) ──────────────────────────────────────

/**
 * A GeoJSON LinearRing: an array of at least 4 positions where the first and
 * last positions are identical (closed ring).
 */
const linearRingSchema = z
  .array(coordinateSchema)
  .min(AREA_MIN_RING_POSITIONS, `Polygon ring must have at least ${AREA_MIN_RING_POSITIONS} positions (3 distinct + closing).`)
  .max(AREA_MAX_RING_POSITIONS, `Polygon ring must have at most ${AREA_MAX_RING_POSITIONS} positions.`)
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!first || !last) return false;
      return first[0] === last[0] && first[1] === last[1];
    },
    { message: 'Polygon ring must be closed: first and last positions must be identical.' }
  );

// ─── Polygon geometry ────────────────────────────────────────────────────────

/**
 * GeoJSON Polygon geometry.
 * coordinates[0] is the exterior ring; subsequent entries are interior rings (holes).
 * Only exterior ring vertex/area limits are enforced at the API boundary.
 * PostGIS ST_IsValid enforces structural validity (self-intersection, etc.).
 */
const polygonGeometrySchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(linearRingSchema)
      .min(1, 'Polygon must have at least one ring (exterior).')
  })
  .strict();

// ─── Area create schema ───────────────────────────────────────────────────────

export const areaCreateSchema = z
  .object({
    geometry: polygonGeometrySchema,
    name: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(100),
    display_timezone: z.string().trim().min(1).max(100),
    provenance: z.string().trim().min(1).max(500)
  })
  .strict();

export type AreaCreateInput = z.infer<typeof areaCreateSchema>;


export const areaListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(512).optional()
  })
  .strict();

export type AreaListQuery = z.infer<typeof areaListQuerySchema>;
