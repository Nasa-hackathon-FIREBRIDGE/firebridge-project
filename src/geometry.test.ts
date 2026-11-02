import { describe, expect, it } from 'vitest'
import { validatePolygon } from './geometry'

const polygon = (ring: number[][]): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [ring] })

describe('validatePolygon', () => {
  it('accepts a simple closed polygon', () => {
    expect(validatePolygon(polygon([[-6, 34], [-4, 34], [-4, 36], [-6, 34]])).ok).toBe(true)
  })
  it('rejects empty, non-polygon and unclosed input', () => {
    expect(validatePolygon(null).ok).toBe(false)
    expect(validatePolygon({ type: 'Point', coordinates: [0, 0] }).ok).toBe(false)
    expect(validatePolygon({ type: 'Polygon', coordinates: [] }).ok).toBe(false)
    expect(validatePolygon(polygon([[0, 0], [1, 0], [1, 1], [0.5, 0.5]])).ok).toBe(false)
  })
  it('rejects non-finite and out-of-range coordinates', () => {
    expect(validatePolygon(polygon([[0, 0], [NaN, 0], [1, 1], [0, 0]])).ok).toBe(false)
    expect(validatePolygon(polygon([[0, 0], [200, 0], [1, 1], [0, 0]])).ok).toBe(false)
    expect(validatePolygon(polygon([[0, 0], [1, 95], [1, 1], [0, 0]])).ok).toBe(false)
  })
  it('rejects fewer than three distinct vertices and zero area', () => {
    expect(validatePolygon(polygon([[0, 0], [1, 1], [0, 0], [0, 0]])).ok).toBe(false)
    expect(validatePolygon(polygon([[0, 0], [1, 1], [2, 2], [0, 0]])).ok).toBe(false)
  })
  it('rejects self-intersecting (bow-tie) polygons', () => {
    expect(validatePolygon(polygon([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]])).ok).toBe(false)
  })
})
