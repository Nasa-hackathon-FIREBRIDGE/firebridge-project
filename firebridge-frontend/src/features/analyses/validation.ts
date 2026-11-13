import type { MultiPolygonGeometry, PolygonGeometry } from '@firebridge/contracts'
import { UserInputError } from '../../lib/userFeedback'

const geometryError = (message: string) => new UserInputError(message, 'geometry')

function checkRings(rings: unknown) {
  if (!Array.isArray(rings) || !rings.length) throw geometryError('Each polygon needs at least one ring.')
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4)
      throw geometryError('Each ring needs at least three vertices and a closing position.')
    for (const p of ring) {
      if (
        !Array.isArray(p) ||
        p.length < 2 ||
        p.length > 3 ||
        !p.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
        p[0] < -180 ||
        p[0] > 180 ||
        p[1] < -90 ||
        p[1] > 90
      )
        throw geometryError(
          'Positions must contain finite WGS 84 longitude [-180, 180] and latitude [-90, 90], with optional elevation.',
        )
    }
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
      throw geometryError(
        'Every ring must be closed: repeat its first longitude and latitude at the end.',
      )
    if (new Set(ring.slice(0, -1).map((p: number[]) => `${p[0]},${p[1]}`)).size < 3)
      throw geometryError('Each ring needs three distinct vertices.')
  }
}

/** Preserve holes/elevation and antimeridian edges; PostGIS owns topology and budgets. */
export function parseAreaGeometry(input: string): PolygonGeometry | MultiPolygonGeometry {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    throw geometryError('Enter valid GeoJSON geometry JSON.')
  }
  const type = value && typeof value === 'object' && 'type' in value ? value.type : undefined
  const coordinates = value && typeof value === 'object' && 'coordinates' in value ? value.coordinates : undefined
  if ((type !== 'Polygon' && type !== 'MultiPolygon') || !Array.isArray(coordinates) || !coordinates.length)
    throw geometryError('Provide a GeoJSON Polygon or MultiPolygon geometry with at least one ring.')
  if (type === 'Polygon') checkRings(coordinates)
  else for (const polygon of coordinates) checkRings(polygon)
  return value as PolygonGeometry | MultiPolygonGeometry
}
export function validDateRange(start: string, end: string): boolean {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  return valid(start) && valid(end) && end > start
}
export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
