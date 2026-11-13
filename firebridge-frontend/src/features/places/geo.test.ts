import { describe, expect, it } from 'vitest'
import { areaKm2, boundsOf, centreOf, fitForSaving, polygonsOf, repaired, vertexCount, VERTEX_LIMIT } from './geo'

const square = (x: number, y: number, size: number): GeoJSON.Position[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
const circle = (n: number, radius: number): GeoJSON.Position[] => {
  const ring = Array.from({ length: n }, (_, i) => [-5 + radius * Math.cos((2 * Math.PI * i) / n), 34 + radius * Math.sin((2 * Math.PI * i) / n)])
  return [...ring, ring[0]]
}

describe('place geometry', () => {
  it('measures surface on the sphere', () => {
    // One degree square at the equator: R² · (π/180) · sin 1° on a sphere of mean Earth radius.
    expect(areaKm2({ type: 'Polygon', coordinates: [square(0, 0, 1)] })).toBeCloseTo(12364.2, 0)
    const withHole: GeoJSON.Polygon = { type: 'Polygon', coordinates: [square(0, 0, 2), square(0.5, 0.5, 1)] }
    const parts: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [[square(0, 0, 1)], [square(5, 0, 1)]] }
    expect(areaKm2(withHole)).toBeCloseTo(areaKm2({ type: 'Polygon', coordinates: [square(0, 0, 2)] }) - areaKm2({ type: 'Polygon', coordinates: [square(0.5, 0.5, 1)] }), 3)
    expect(areaKm2(parts)).toBeCloseTo(2 * 12364.2, -1)
  })

  it('frames a place that crosses the dateline tightly', () => {
    const fiji: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [[square(177, -18, 2)], [[[-180, -17], [-179, -17], [-179, -16], [-180, -16], [-180, -17]]]] }
    const [west, south, east, north] = boundsOf(fiji)
    expect([west, south, north]).toEqual([177, -18, -16])
    expect(east).toBe(181) // beyond 180, so the frame does not span the whole world
    expect(centreOf(boundsOf(fiji))[0]).toBe(179)
    expect(boundsOf({ type: 'Polygon', coordinates: [square(-6, 34, 2)] })).toEqual([-6, 34, -4, 36])
  })

  it('rebuilds a ring that crosses itself into valid parts', () => {
    const bowTie: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]] }
    const fixed = repaired(bowTie)!
    expect(fixed.type).toBe('MultiPolygon')
    expect(polygonsOf(fixed)).toHaveLength(2)
    expect(areaKm2(fixed)).toBeGreaterThan(0)
  })

  it('fits a detailed boundary within the vertex limit, keeping its shape', () => {
    const detailed: GeoJSON.Polygon = { type: 'Polygon', coordinates: [circle(20_000, 1)] }
    const fitted = fitForSaving(detailed)!
    expect(vertexCount(fitted)).toBeLessThanOrEqual(VERTEX_LIMIT)
    expect(Math.abs(areaKm2(fitted) - areaKm2(detailed)) / areaKm2(detailed)).toBeLessThan(0.01)
    const small: GeoJSON.Polygon = { type: 'Polygon', coordinates: [square(0, 0, 1)] }
    expect(areaKm2(fitForSaving(small)!)).toBeCloseTo(areaKm2(small), 3)
  })
})
