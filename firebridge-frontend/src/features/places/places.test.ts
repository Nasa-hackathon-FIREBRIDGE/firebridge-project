import { afterEach, describe, expect, it, vi } from 'vitest'
import { describe as describePlace, geoBoundariesUrl, loadPlaces, search, zoneFor, type CountryProps } from './places'

const square = (x: number, y: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function serve(files: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => (url in files ? json(files[url]) : new Response('missing', { status: 404 })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('places', () => {
  it('reads prepared countries from the app, and others straight from geoBoundaries', async () => {
    const prepared = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square(-7, 33), properties: { id: 'gb-1', name: 'Rabat-Salé-Kenitra', level: 'region', iso3: 'MAR', area_km2: 17675, source: 'geoBoundaries gbOpen MAR ADM1 (ODbL 1.0)', source_id: '1' } }] }
    const published = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square(10, 36), properties: { shapeName: 'Tunis', shapeID: 'TUN-1' } }, { type: 'Feature', geometry: null, properties: {} }] }
    const fetchMock = serve({
      '/places/index.json': { countries: { MAR: { regions: 1, prepared: '2026-11-11' } } },
      '/places/MAR/regions.json': prepared,
      [geoBoundariesUrl('TUN', 'ADM1')]: published,
    })

    expect((await loadPlaces('MAR', 'region'))?.map((p) => p.properties.name)).toEqual(['Rabat-Salé-Kenitra'])
    const tunisia = await loadPlaces('TUN', 'region')
    expect(tunisia).toHaveLength(1)
    expect(tunisia![0].properties).toMatchObject({ id: 'gb-TUN-1', name: 'Tunis', level: 'region', iso3: 'TUN', source: 'geoBoundaries gbOpen TUN ADM1 (ODbL 1.0)', source_id: 'TUN-1' })
    expect(tunisia![0].properties.area_km2).toBeGreaterThan(9000)
    // Forests are only ever prepared files: an unprepared country has none to offer yet.
    expect(await loadPlaces('TUN', 'forest')).toBeNull()
    // Each file is fetched once per session.
    await loadPlaces('MAR', 'region')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/places/MAR/regions.json')).toHaveLength(1)
  })

  it('suggests the time zone nearest the place', () => {
    const brazil = { zones: [['America/Noronha', -3.85, -32.42], ['America/Manaus', -3.13, -60.02], ['America/Sao_Paulo', -23.53, -46.62]] } as CountryProps
    expect(zoneFor(brazil, square(-61, -4))).toBe('America/Manaus')
    expect(zoneFor(brazil, square(-47, -24))).toBe('America/Sao_Paulo')
    expect(zoneFor({ zones: [] } as unknown as CountryProps, square(0, 0))).toBe('UTC')
  })

  it('finds names without accents or case, starts first', () => {
    const names = ['Béni Mellal-Khénifra', 'Fès-Meknès', 'Souss-Massa', 'Guelmim-Oued Noun']
    expect(search(names, 'fes', (n) => [n])).toEqual(['Fès-Meknès'])
    expect(search(names, 'ss', (n) => [n])).toEqual(['Souss-Massa'])
    expect(search(names, 'kh', (n) => [n])).toEqual(['Béni Mellal-Khénifra'])
    expect(search(names, '  ', (n) => [n])).toEqual([])
  })

  it('describes a place in plain words', () => {
    const base = { id: 'x', name: 'x', iso3: 'MAR', area_km2: 1, source: '', source_id: '' }
    expect(describePlace({ ...base, level: 'region' }, 'Morocco')).toBe('Region of Morocco')
    expect(describePlace({ ...base, level: 'forest', kind: 'national park' }, 'Morocco')).toBe('National park · Morocco')
    expect(describePlace({ ...base, level: 'country' }, 'Morocco')).toBe('The whole country')
  })
})
