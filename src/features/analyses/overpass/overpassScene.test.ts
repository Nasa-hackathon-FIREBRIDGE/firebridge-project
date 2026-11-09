import { describe, expect, it } from 'vitest'
import { isLand } from './landMask'
import { overpassTarget } from './overpassScene'

describe('Overpass illustration geography', () => {
  it.each([
    ['Paris', 48.85, 2.35, true],
    ['Congo basin', 0, 20, true],
    ['Northern Morocco', 34.5, -5, true],
    ['Amazon', -5, -60, true],
    ['Antarctica', -80, 0, true],
    ['mid-Atlantic', 0, -30, false],
    ['North Pacific', 35, -150, false],
    ['Indian Ocean', -20, 75, false],
  ] as const)('classifies %s as land=%s', (_name, lat, lon, land) => {
    expect(isLand(lat, lon)).toBe(land)
  })
  it('centres on the bounding box of a polygon and keeps its outline', () => {
    const target = overpassTarget({ type: 'Polygon', coordinates: [[[-6, 34], [-4, 34], [-4, 36], [-6, 36], [-6, 34]]] }, 'Northern Morocco')
    expect(target).toMatchObject({ lat: 35, lon: -5, label: 'Northern Morocco' })
    expect(target?.rings[0]).toHaveLength(5)
  })
  it('handles multipolygons that cross the antimeridian', () => {
    const target = overpassTarget({
      type: 'MultiPolygon',
      coordinates: [
        [[[178, -18], [180, -18], [180, -16], [178, -16], [178, -18]]],
        [[[-180, -18], [-178, -18], [-178, -16], [-180, -16], [-180, -18]]],
      ],
    })
    expect(target?.lat).toBeCloseTo(-17)
    expect(Math.abs(target!.lon)).toBeCloseTo(180)
    expect(target?.rings).toHaveLength(2)
  })
  it.each([undefined, null, { type: 'Point', coordinates: [0, 0] }, { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }])('ignores unusable geometry %j', (geometry) => {
    expect(overpassTarget(geometry)).toBeUndefined()
  })
})
