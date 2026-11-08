import { describe, expect, it } from 'vitest'
import { parseAreaGeometry, validDateRange } from './validation'

describe('Area and interval input boundaries', () => {
  it('preserves antimeridian geometry, holes and elevation for backend validation', () => {
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [179, -1, 5],
          [-179, -1, 5],
          [-179, 1, 5],
          [179, 1, 5],
          [179, -1, 5],
        ],
        [
          [179.3, -0.5],
          [-179.3, -0.5],
          [-179.3, 0.5],
          [179.3, 0.5],
          [179.3, -0.5],
        ],
      ],
    }
    expect(parseAreaGeometry(JSON.stringify(geometry))).toEqual(geometry)
  })
  it.each([
    '{',
    '{}',
    '{"type":"Feature"}',
    '{"type":"Polygon","coordinates":[]}',
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1],[1,1]]]}',
    '{"type":"Polygon","coordinates":[[[181,0],[1,0],[0,1],[181,0]]]}',
  ])('rejects malformed geometry: %s', (input) => {
    expect(() => parseAreaGeometry(input)).toThrow()
  })
  it('validates calendar dates and a strictly exclusive end', () => {
    expect(validDateRange('2024-02-29', '2024-03-01')).toBe(true)
    expect(validDateRange('2023-02-29', '2023-03-01')).toBe(false)
    expect(validDateRange('2024-01-01', '2024-01-01')).toBe(false)
    expect(validDateRange('2024-02-01', '2024-01-01')).toBe(false)
    expect(validDateRange('', '2024-01-01')).toBe(false)
  })
})
