/** GeoJSON Polygon input in WGS84. The total vertex/surface limits come from env.
 * Short edges are unwrapped, validated, and split at the dateline before storage.
 * Self-intersections and empty geometry are rejected by PostGIS; surface uses geography.
 */

import { z } from 'zod';
import { env } from '../config/env.js';

// ─── Limits ──────────────────────────────────────────────────────────────────

export const AREA_MIN_RING_POSITIONS = 4; // 3 distinct + 1 closing (GeoJSON Polygon)
export const AREA_MAX_RING_POSITIONS = env.MAX_AOI_VERTICES;
export const AREA_MAX_SURFACE_KM2 = env.MAX_AOI_AREA_KM2;

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
 * The vertex limit applies to all rings combined.
 * PostGIS ST_IsValid enforces structural validity (self-intersection, etc.).
 */
const polygonGeometrySchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(linearRingSchema)
      .min(1, 'Polygon must have at least one ring (exterior).')
  })
  .strict()
  .refine((geometry) => geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0) <= env.MAX_AOI_VERTICES, 'Polygon exceeds the total vertex limit.');

// ─── Area create schema ───────────────────────────────────────────────────────

export const areaCreateSchema = z
  .object({
    geometry: polygonGeometrySchema,
    name: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(100),
    display_timezone: z.string().trim().min(1).max(100).refine((value) => {
      try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
    }, 'Use an IANA timezone.'),
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
