// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacePicker, type PickedPlace } from './PlacePicker'
import { geoBoundariesUrl } from './places'
import { usePlacePicker } from './usePlacePicker'

const square = (x: number, y: number, size = 1): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] })
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features })
const country = (id: string, name: string, nameFr: string, area: number, regions: number, geometry: GeoJSON.Polygon, zones: unknown[]) => ({
  type: 'Feature', geometry, properties: { id, iso3: id, name, name_fr: nameFr, name_ar: '', area_km2: area, regions, provinces: 0, zones },
})
const region = (id: string, name: string, area: number, geometry: GeoJSON.Polygon) => ({
  type: 'Feature', geometry, properties: { id: `gb-${id}`, name, level: 'region', iso3: 'MAR', area_km2: area, source: 'geoBoundaries gbOpen MAR ADM1 (ODbL 1.0)', source_id: id },
})

const FILES: Record<string, unknown> = {
  '/places/countries.json': collection([
    country('MAR', 'Morocco', 'Maroc', 685201, 2, square(-17, 21, 15), [['Africa/Casablanca', 33.65, -7.58]]),
    country('TUN', 'Tunisia', 'Tunisie', 157005, 1, square(8, 30, 4), [['Africa/Tunis', 36.8, 10.18]]),
  ]),
  '/places/index.json': { countries: { MAR: { regions: 2, forests: 0, prepared: '2026-11-11' } } },
  '/places/MAR/regions.json': collection([region('1', 'Rabat-Salé-Kenitra', 17675, square(-7, 33)), region('2', 'Souss-Massa', 53820, square(-10, 29, 2))]),
  '/places/MAR/country.json': collection([{ ...region('0', 'Morocco', 685201, square(-17, 21, 15)), properties: { ...region('0', 'Morocco', 685201, square(-17, 21, 15)).properties, level: 'country' } }]),
  '/places/MAR/forests.json': collection([]),
  [geoBoundariesUrl('TUN', 'ADM1')]: collection([{ type: 'Feature', geometry: square(9, 35), properties: { shapeName: 'Tunis', shapeID: 'T1' } }]),
}

/** Just enough of MapLibre to run the picker: sources, layers, events and picking. */
class FakeMap {
  sources = new Map<string, { data: GeoJSON.FeatureCollection | null }>()
  layers = new Set<string>()
  handlers = new Map<string, (event: unknown) => void>()
  under: { id: string; source: string }[] = []
  fitBounds = vi.fn()
  easeTo = vi.fn()
  getZoom() { return 7 }
  getContainer() { return { clientHeight: 700 } }
  doubleClickZoom = { disable: vi.fn(), enable: vi.fn() }
  addSource(id: string) {
    const source = { data: null as GeoJSON.FeatureCollection | null, setData: (data: GeoJSON.FeatureCollection) => { source.data = data } }
    this.sources.set(id, source)
  }
  getSource(id: string) { return this.sources.get(id) }
  removeSource(id: string) { this.sources.delete(id) }
  addLayer(layer: { id: string }) { this.layers.add(layer.id) }
  getLayer(id: string) { return this.layers.has(id) ? { id } : undefined }
  removeLayer(id: string) { this.layers.delete(id) }
  getStyle() { return { layers: [{ id: 'imagery', type: 'raster' }] } }
  setPaintProperty() {}
  setFilter() {}
  setFeatureState() {}
  getCanvas() { return { style: { cursor: '' } } }
  on(type: string, handler: (event: unknown) => void) { this.handlers.set(type, handler) }
  off(type: string) { this.handlers.delete(type) }
  queryRenderedFeatures() { return this.under }
  click(target: { id: string; source: string } | null) {
    this.under = target ? [target] : []
    act(() => this.handlers.get('click')?.({ point: { x: 10, y: 10 } }))
  }
}

let map: FakeMap
function Harness({ onUse }: { onUse: (place: PickedPlace) => void }) {
  const mapRef = useRef(map as unknown as MapLibreMap)
  const picker = usePlacePicker(mapRef, true, 1, true)
  return <PlacePicker picker={picker} maxAreaKm2={250_000} onUse={onUse} onClose={() => {}} />
}

beforeEach(() => {
  map = new FakeMap()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url in FILES ? new Response(JSON.stringify(FILES[url])) : new Response('', { status: 404 }))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const bar = () => within(screen.getByRole('region', { name: 'Choose a zone' }))
const searchFor = (text: string) => fireEvent.change(bar().getByRole('searchbox'), { target: { value: text } })

describe('choosing a zone on the map', () => {
  it('opens a country, picks a region and hands it over named, sourced and ready to save', async () => {
    const onUse = vi.fn()
    render(<Harness onUse={onUse} />)
    expect(await bar().findByText('Click a country on the map, or search for it.')).toBeInTheDocument()
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 2.6 })) // the world comes into view
    await waitFor(() => expect(map.sources.get('places-countries')?.data?.features).toHaveLength(2))

    searchFor('maroc')
    fireEvent.click(bar().getByRole('button', { name: /Morocco/ }))
    expect(bar().getByText('Morocco')).toBeInTheDocument()
    expect(map.fitBounds).toHaveBeenCalled()
    expect(await bar().findByText('Click a region on the map, or search.')).toBeInTheDocument()
    expect(bar().getByRole('radio', { name: /Regions/ })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(map.sources.get('places-units')?.data?.features).toHaveLength(2))

    searchFor('rabat')
    fireEvent.click(bar().getByRole('button', { name: /Rabat-Salé-Kenitra/ }))
    expect(bar().getByText('Region of Morocco')).toBeInTheDocument()
    expect(bar().getByText('17,675 km²')).toBeInTheDocument()
    fireEvent.click(bar().getByRole('button', { name: /Use this area/ }))
    const picked: PickedPlace = onUse.mock.calls[0][0]
    expect(picked).toMatchObject({ name: 'Rabat-Salé-Kenitra, Morocco', provenance: 'geoBoundaries gbOpen MAR ADM1 (ODbL 1.0) · 1', timezone: 'Africa/Casablanca' })
    expect(picked.geometry.type).toBe('Polygon')
  })

  it('selects by clicking the map, and explains what cannot be analysed', async () => {
    render(<Harness onUse={vi.fn()} />)
    await bar().findByText('Click a country on the map, or search for it.')
    map.click({ id: 'MAR', source: 'places-countries' })
    await bar().findByText('Click a region on the map, or search.')
    map.click({ id: 'gb-2', source: 'places-units' })
    expect(bar().getByText('Souss-Massa')).toBeInTheDocument()

    fireEvent.click(bar().getByRole('radio', { name: 'Whole country' }))
    expect(await bar().findByText(/Too large to analyse as one area: 685,201 km², and the limit is 250,000 km²/)).toBeInTheDocument()
    expect(bar().queryByRole('button', { name: /Use this area/ })).toBeNull()

    fireEvent.click(bar().getByRole('radio', { name: /Forests/ }))
    expect(await bar().findByText('No named forests or parks were found for Morocco.')).toBeInTheDocument()

    fireEvent.click(bar().getByRole('button', { name: /World/ }))
    searchFor('tunis')
    fireEvent.click(bar().getByRole('button', { name: /Tunisia/ }))
    await waitFor(() => expect(map.sources.get('places-units')?.data?.features).toHaveLength(1)) // live from geoBoundaries
    fireEvent.click(bar().getByRole('radio', { name: /Forests/ }))
    expect(await bar().findByText("Forests and parks aren't prepared for Tunisia yet. Pick a region or province instead.")).toBeInTheDocument()
  })
})
