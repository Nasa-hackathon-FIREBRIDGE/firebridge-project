import polygonClipping, { type Geom } from 'polygon-clipping'

export type AreaGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
export type Bounds = [west: number, south: number, east: number, north: number]

/** The server accepts 5,000 vertices per area; the margin absorbs points a repair adds. */
export const VERTEX_LIMIT = 4900

const RADIUS = 6371008.8
const rad = (degrees: number) => (degrees * Math.PI) / 180

export const polygonsOf = (geometry: AreaGeometry): GeoJSON.Position[][][] => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)

export const vertexCount = (geometry: AreaGeometry) => polygonsOf(geometry).reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0)

function ringArea(ring: GeoJSON.Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += rad(ring[i + 1][0] - ring[i][0]) * (2 + Math.sin(rad(ring[i][1])) + Math.sin(rad(ring[i + 1][1])))
  return Math.abs((sum * RADIUS * RADIUS) / 2)
}

/** Surface on a sphere of mean Earth radius: within about 0.2% of PostGIS's ellipsoidal area. */
export const areaKm2 = (geometry: AreaGeometry) =>
  polygonsOf(geometry).reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((h, ring) => h + ringArea(ring), 0), 0) / 1e6

/** Bounds that stay tight for shapes across the dateline (east then exceeds 180, which MapLibre accepts). */
export function boundsOf(geometry: AreaGeometry): Bounds {
  let south = 90
  let north = -90
  const plain = [180, -180]
  const shifted = [360, 0]
  for (const [x, y] of polygonsOf(geometry).flat(2)) {
    south = Math.min(south, y)
    north = Math.max(north, y)
    plain[0] = Math.min(plain[0], x)
    plain[1] = Math.max(plain[1], x)
    const s = x < 0 ? x + 360 : x
    shifted[0] = Math.min(shifted[0], s)
    shifted[1] = Math.max(shifted[1], s)
  }
  const [west, east] = shifted[1] - shifted[0] < plain[1] - plain[0] ? shifted : plain
  return [west > 180 ? west - 360 : west, south, west > 180 ? east - 360 : east, north]
}

export const centreOf = ([west, south, east, north]: Bounds): [number, number] => [(((west + east) / 2 + 540) % 360) - 180, (south + north) / 2]

function distanceToSegment([x, y]: GeoJSON.Position, [ax, ay]: GeoJSON.Position, [bx, by]: GeoJSON.Position): number {
  const dx = bx - ax
  const dy = by - ay
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/** Douglas–Peucker on a closed ring; null when too little of it survives. */
function simplifyRing(ring: GeoJSON.Position[], tolerance: number): GeoJSON.Position[] | null {
  const keep = new Uint8Array(ring.length)
  keep[0] = keep[ring.length - 1] = 1
  const stack: [number, number][] = [[0, ring.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let index = -1
    let furthest = tolerance
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(ring[i], ring[first], ring[last])
      if (d > furthest) {
        index = i
        furthest = d
      }
    }
    if (index < 0) continue
    keep[index] = 1
    stack.push([first, index], [index, last])
  }
  const out = ring.filter((_, i) => keep[i])
  return out.length >= 4 ? out : null
}

/** Rebuilds rings that cross or touch themselves (some published boundaries have tiny spikes), which PostGIS rejects. */
export function repaired(geometry: AreaGeometry): AreaGeometry | null {
  const [first, ...rest] = polygonsOf(geometry).map((polygon) => [polygon] as unknown as Geom)
  if (!first) return null
  const parts = polygonClipping.union(first, ...rest) as GeoJSON.Position[][][]
  if (!parts.length) return null
  return parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts }
}

/** The geometry as the server will accept it: within the vertex limit and valid. Null when nothing usable remains. */
export function fitForSaving(geometry: AreaGeometry, limit = VERTEX_LIMIT): AreaGeometry | null {
  // Repairing is the costly step: very detailed shapes are simplified first.
  let candidate = vertexCount(geometry) <= limit * 2 ? repaired(geometry) : null
  for (let tolerance = 0.0002; (!candidate || vertexCount(candidate) > limit) && tolerance < 1; tolerance *= 1.6) {
    const polygons = polygonsOf(geometry)
      .map((polygon) => {
        const [outer, ...holes] = polygon.map((ring) => simplifyRing(ring, tolerance))
        return outer ? [outer, ...holes.filter((ring): ring is GeoJSON.Position[] => !!ring)] : null
      })
      .filter((polygon): polygon is GeoJSON.Position[][] => !!polygon)
    if (!polygons.length) return null
    candidate = repaired({ type: 'MultiPolygon', coordinates: polygons })
  }
  return candidate && vertexCount(candidate) <= limit ? candidate : null
}
