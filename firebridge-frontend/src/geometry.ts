export type PolygonValidation = { ok: true; geometry: GeoJSON.Polygon } | { ok: false; reason: string }

type Position = number[]

const EPSILON = 1e-12

function ringArea(ring: Position[]): number {
  let sum = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    sum += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return sum / 2
}

function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(a: Position, b: Position, p: Position): boolean {
  return Math.min(a[0], b[0]) - EPSILON <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPSILON && Math.min(a[1], b[1]) - EPSILON <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPSILON
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  if (((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) && ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))) return true
  if (Math.abs(d1) <= EPSILON && onSegment(a, b, c)) return true
  if (Math.abs(d2) <= EPSILON && onSegment(a, b, d)) return true
  if (Math.abs(d3) <= EPSILON && onSegment(c, d, a)) return true
  return Math.abs(d4) <= EPSILON && onSegment(c, d, b)
}

function hasSelfIntersection(ring: Position[]): boolean {
  const segmentCount = ring.length - 1
  for (let i = 0; i < segmentCount; i += 1) {
    for (let j = i + 1; j < segmentCount; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === segmentCount - 1)
      if (adjacent) {
        // Neighbouring segments may only share their common vertex; collinear overlap is a fold-back.
        const shared = j === i + 1 ? ring[j] : ring[0]
        const a = j === i + 1 ? ring[i] : ring[j]
        const b = j === i + 1 ? ring[j + 1] : ring[i + 1]
        if (Math.abs(cross(shared, a, b)) <= EPSILON && (a[0] - shared[0]) * (b[0] - shared[0]) + (a[1] - shared[1]) * (b[1] - shared[1]) > 0) return true
        continue
      }
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true
    }
  }
  return false
}

/** Validates a drawn area-of-interest as a simple WGS 84 polygon. */
export function validatePolygon(geometry: unknown): PolygonValidation {
  if (!geometry || typeof geometry !== 'object' || (geometry as GeoJSON.Geometry).type !== 'Polygon') return { ok: false, reason: 'The area must be a polygon.' }
  const coordinates = (geometry as GeoJSON.Polygon).coordinates
  if (!Array.isArray(coordinates) || coordinates.length === 0 || !Array.isArray(coordinates[0]) || coordinates[0].length === 0) return { ok: false, reason: 'The polygon is empty.' }
  const ring = coordinates[0]
  for (const position of ring) {
    if (!Array.isArray(position) || position.length < 2 || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) return { ok: false, reason: 'The polygon contains a non-numeric coordinate.' }
    if (position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90) return { ok: false, reason: 'The polygon has coordinates outside valid longitude (-180 to 180) or latitude (-90 to 90) ranges.' }
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length < 4 || first[0] !== last[0] || first[1] !== last[1]) return { ok: false, reason: 'The polygon ring must be closed and have at least three vertices.' }
  const distinct = new Set(ring.slice(0, -1).map((position) => `${position[0]},${position[1]}`))
  if (distinct.size < 3) return { ok: false, reason: 'The polygon needs at least three distinct vertices.' }
  if (Math.abs(ringArea(ring)) < EPSILON) return { ok: false, reason: 'The polygon has zero area.' }
  if (hasSelfIntersection(ring)) return { ok: false, reason: 'The polygon edges cross each other. Draw a simple outline.' }
  return { ok: true, geometry: { type: 'Polygon', coordinates: [ring.map((position) => [position[0], position[1]])] } }
}
