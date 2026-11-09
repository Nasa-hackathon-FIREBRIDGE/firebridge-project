// @vitest-environment jsdom
// maplibre-gl and terra-draw are replaced with mocks: jsdom has no WebGL, so these tests
// exercise MapView's own logic. They do NOT verify live basemap loading or real rendering.
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Detection, AreaOfInterest } from '../types'
import { resultFixtures } from '../services/results.test-fixtures'

const mocks = vi.hoisted(() => {
  type Handler = (event?: unknown) => void
  class FakeMap {
    static instances: FakeMap[] = []
    options: Record<string, unknown>
    handlers: Record<string, Handler[]> = {}
    layerHandlers: Record<string, Handler[]> = {}
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
    sourceDefinitions = new Map<string, unknown>()
    layers = new Set<string>()
    remove = vi.fn()
    resize = vi.fn()
    setStyle = vi.fn((style: unknown) => {
      this.options.style = style
      this.sources.clear()
      this.layers.clear()
      this.emit('style.load')
    })
    setLayoutProperty = vi.fn()
    addControl = vi.fn()
    zoomTo = vi.fn()
    easeTo = vi.fn()
    flyTo = vi.fn()
    fitBounds = vi.fn()
    isSourceLoaded = () => true
    querySourceFeatures = vi.fn((): unknown[] => [])
    getZoom = () => 7
    getCanvas = () => this.canvas
    canvas = Object.assign(new EventTarget(), { style: {} as Record<string, string> })
    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeMap.instances.push(this)
    }
    on(event: string, layerOrHandler: string | Handler, handler?: Handler) {
      if (typeof layerOrHandler === 'string' && handler) (this.layerHandlers[`${event}:${layerOrHandler}`] ??= []).push(handler)
      else (this.handlers[event] ??= []).push(layerOrHandler as Handler)
    }
    emit(event: string, payload?: unknown) { this.handlers[event]?.forEach((handler) => handler(payload)) }
    emitLayer(event: string, layer: string, payload?: unknown) { this.layerHandlers[`${event}:${layer}`]?.forEach((handler) => handler(payload)) }
    off(event: string, layerOrHandler: string | Handler, handler?: Handler) {
      if (typeof layerOrHandler === 'string') this.layerHandlers[`${event}:${layerOrHandler}`] = this.layerHandlers[`${event}:${layerOrHandler}`]?.filter((item) => item !== handler) ?? []
      else this.handlers[event] = this.handlers[event]?.filter((item) => item !== layerOrHandler) ?? []
    }
    addSource(id: string, definition?: unknown) { this.sources.set(id, { setData: vi.fn() }); this.sourceDefinitions.set(id, definition) }
    removeSource(id: string) { this.sources.delete(id) }
    removeLayer(id: string) { this.layers.delete(id) }
    getSource(id: string) { return this.sources.get(id) }
    addLayer(layer: { id: string }) { this.layers.add(layer.id) }
    getLayer(id: string) { return this.layers.has(id) ? { id } : undefined }
  }
  class FakeDraw {
    static instances: FakeDraw[] = []
    handlers: Record<string, (...args: any[]) => void> = {}
    features = new Map<string, unknown>()
    start = vi.fn()
    stop = vi.fn()
    setMode = vi.fn()
    removeFeatures = vi.fn((ids: string[]) => ids.forEach((id) => this.features.delete(id)))
    constructor() { FakeDraw.instances.push(this) }
    on(event: string, handler: (...args: any[]) => void) { this.handlers[event] = handler }
    getSnapshot() { return [...this.features.entries()].map(([id, geometry]) => ({ id, geometry })) }
    getSnapshotFeature(id: string) { return this.features.has(id) ? { id, geometry: this.features.get(id) } : undefined }
    finish(id: string, geometry: unknown) { this.features.set(id, geometry); this.handlers.finish(id, { action: 'draw' }) }
    progress(vertices: number) {
      const ring = Array.from({ length: vertices + 2 }, (_, index) => [-6 + index * 0.1, 34])
      this.features.set('wip', { type: 'Polygon', coordinates: [ring] })
      this.handlers.change(['wip'], { action: 'draw' })
    }
  }
  return { FakeMap, FakeDraw }
})

vi.mock('maplibre-gl', () => ({
  Map: mocks.FakeMap,
  NavigationControl: class {},
  AttributionControl: class {},
  ScaleControl: class {},
  setWorkerUrl: vi.fn(),
  addProtocol: vi.fn(),
  LngLatBounds: class { points: unknown[] = []; extend(point: unknown) { this.points.push(point); return this } },
}))
vi.mock('terra-draw', () => ({
  TerraDraw: mocks.FakeDraw,
  TerraDrawPolygonMode: class {},
  TerraDrawRectangleMode: class {},
  TerraDrawRenderMode: class {},
}))
vi.mock('terra-draw-maplibre-gl-adapter', () => ({ TerraDrawMapLibreGLAdapter: class {} }))

import { MapView } from './MapView'

const { FakeMap, FakeDraw } = mocks
const STYLE = 'https://styles.example.test/style.json'

const makeRecord = (id: string, sensor: 'MODIS' | 'VIIRS'): Detection => ({
  id, observedAtUtc: '2024-07-20T14:00:00Z', latitude: 35, longitude: -5, sensor, platform: sensor === 'MODIS' ? 'Aqua' : 'Suomi-NPP',
  productIdentifier: null, frpMw: 1, confidence: null, clusterGroup: null, sourceDatasetId: 'demo', provenance: 'synthetic', synthetic: true,
})
const area: AreaOfInterest = { id: 'a', name: 'Area', provenance: 'default-demo', geometry: { type: 'Polygon', coordinates: [[[-6, 34], [-4, 34], [-4, 36], [-6, 36], [-6, 34]]] } }
const records = [makeRecord('d1', 'MODIS'), makeRecord('d2', 'VIIRS')]

function renderMap(overrides: Partial<React.ComponentProps<typeof MapView>> = {}) {
  const props = { records, selectedId: null, onSelect: vi.fn(), area, showDetections: true, showArea: true, clearDrawingToken: 0, onAreaDrawn: vi.fn(), onAreaRejected: vi.fn(), onClearArea: vi.fn(), styleUrl: '', basemapProvider: 'schematic', ...overrides }
  return { props, ...render(<MapView {...props} />) }
}
const lastMap = () => FakeMap.instances[FakeMap.instances.length - 1]
const lastDraw = () => FakeDraw.instances[FakeDraw.instances.length - 1]

beforeEach(() => { FakeMap.instances.length = 0; FakeDraw.instances.length = 0 })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('MapView with mocked MapLibre', () => {
  it('creates one map with the configured style URL and shows a loading state until it loads', () => {
    renderMap({ styleUrl: STYLE })
    expect(FakeMap.instances).toHaveLength(1)
    expect(lastMap().options.style).toBe(STYLE)
    expect(screen.getByText('Loading basemap…')).toBeTruthy()
    act(() => lastMap().emit('style.load'))
    expect(screen.queryByText('Loading basemap…')).toBeNull()
    expect(screen.queryByText(/SCHEMATIC VIEW/)).toBeNull()
    expect(lastMap().sources.has('astra-demo-points')).toBe(true)
    expect(lastDraw().start).toHaveBeenCalled()
  })

  it('uses an explicitly selected offline grid without claiming satellite imagery', () => {
    const { container } = renderMap({ styleUrl: '' })
    expect(typeof lastMap().options.style).toBe('object')
    expect(screen.getByText(/SCHEMATIC VIEW — not satellite imagery/)).toBeTruthy()
    expect(screen.getByText(/Offline coordinate grid selected/)).toBeTruthy()
    expect(screen.queryByText('Loading basemap…')).toBeNull()
    expect(container.querySelector('[data-basemap="schematic"]')).toBeTruthy()
  })

  it('falls back to the schematic when the style fails to load', () => {
    renderMap({ styleUrl: STYLE })
    act(() => lastMap().emit('error', { error: new Error('HTTP 403') }))
    expect(screen.getByText(/could not be loaded. Check your connection/)).toBeTruthy()
    expect(screen.queryByText(/HTTP 403/)).toBeNull()
    expect(lastMap().setStyle).toHaveBeenCalledTimes(1)
    expect(lastMap().sources.has('astra-graticule')).toBe(true)
    expect(screen.queryByText('Loading basemap…')).toBeNull()
  })

  it('falls back when the style never loads, so loading cannot last forever', () => {
    vi.useFakeTimers()
    renderMap({ styleUrl: STYLE, styleTimeoutMs: 500 })
    expect(screen.getByText('Loading basemap…')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(600) })
    expect(screen.getByText(/did not load in time/)).toBeTruthy()
    expect(screen.queryByText('Loading basemap…')).toBeNull()
  })

  it('ignores post-load errors such as a single failed tile', () => {
    renderMap({ styleUrl: STYLE })
    act(() => lastMap().emit('style.load'))
    act(() => lastMap().emit('error', { error: new Error('tile 404') }))
    expect(screen.queryByText(/SCHEMATIC VIEW/)).toBeNull()
    expect(lastMap().setStyle).not.toHaveBeenCalled()
  })

  it('pushes filtered records to the map and shows an empty state when none match', () => {
    const { rerender, props } = renderMap()
    act(() => lastMap().emit('style.load'))
    const source = lastMap().sources.get('astra-demo-points')!
    rerender(<MapView {...props} records={[records[0]]} />)
    const latest = source.setData.mock.calls.at(-1)![0] as GeoJSON.FeatureCollection
    expect(latest.features).toHaveLength(1)
    expect(latest.features[0].properties?.sensor).toBe('MODIS')
    rerender(<MapView {...props} records={[]} />)
    expect(screen.getByText('No demo records match the current filters')).toBeTruthy()
  })

  it('toggles layer visibility', () => {
    const { rerender, props } = renderMap()
    act(() => lastMap().emit('style.load'))
    rerender(<MapView {...props} showDetections={false} />)
    expect(lastMap().setLayoutProperty).toHaveBeenCalledWith('astra-demo-points-ring', 'visibility', 'none')
  })

  it('selects a record when its marker is clicked', () => {
    const { props } = renderMap()
    act(() => lastMap().emit('style.load'))
    act(() => lastMap().emitLayer('click', 'astra-demo-points-ring', { features: [{ properties: { id: 'd2' } }] }))
    expect(props.onSelect).toHaveBeenCalledWith('d2')
  })

  it('stores a valid drawn polygon and flags schematic coordinates', () => {
    const { props } = renderMap()
    act(() => lastMap().emit('style.load'))
    const ring = [[-6, 34], [-5, 34], [-5, 35], [-6, 34]]
    act(() => lastDraw().finish('f1', { type: 'Polygon', coordinates: [ring] }))
    expect(props.onAreaDrawn).toHaveBeenCalledWith({ type: 'Polygon', coordinates: [ring] }, 'schematic')
    expect(lastDraw().removeFeatures).toHaveBeenCalledWith(['f1'])
  })

  it('rejects an invalid drawn polygon', () => {
    const { props } = renderMap()
    act(() => lastMap().emit('style.load'))
    act(() => lastDraw().finish('f2', { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0], [0, 0]]] }))
    expect(props.onAreaDrawn).not.toHaveBeenCalled()
    expect(props.onAreaRejected).toHaveBeenCalledTimes(1)
  })

  it('starts and cancels drawing, and clears the selected area', () => {
    const { props } = renderMap()
    act(() => lastMap().emit('style.load'))
    fireEvent.click(screen.getByLabelText('Draw polygon'))
    expect(lastDraw().setMode).toHaveBeenLastCalledWith('polygon')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(lastDraw().setMode).toHaveBeenLastCalledWith('view')
    fireEvent.click(screen.getByLabelText('Clear selected area'))
    expect(props.onClearArea).toHaveBeenCalled()
  })

  it('removes drawn features when the clear token changes', () => {
    const { rerender, props } = renderMap()
    act(() => lastMap().emit('style.load'))
    lastDraw().features.set('x', { type: 'Polygon', coordinates: [] })
    rerender(<MapView {...props} clearDrawingToken={1} />)
    expect(lastDraw().removeFeatures).toHaveBeenCalledWith(['x'])
  })

  it('cleans up the map and draw instance on unmount and creates no duplicates under StrictMode', () => {
    const props = { records, selectedId: null, onSelect: vi.fn(), area, showDetections: true, showArea: true, clearDrawingToken: 0, onAreaDrawn: vi.fn(), styleUrl: '' }
    const { unmount } = render(<StrictMode><MapView {...props} /></StrictMode>)
    const live = FakeMap.instances.filter((instance) => instance.remove.mock.calls.length === 0)
    expect(live).toHaveLength(1)
    act(() => live[0].emit('style.load'))
    const draw = lastDraw()
    unmount()
    expect(live[0].remove).toHaveBeenCalledTimes(1)
    expect(draw.stop).toHaveBeenCalled()
  })

  it('resizes the map when its container changes size', () => {
    let trigger: () => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { trigger = callback } observe() {} disconnect = disconnect })
    const { unmount } = renderMap()
    trigger()
    expect(lastMap().resize).toHaveBeenCalled()
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('MapView real-API layer integration (mocked renderer)', () => {
  it('preserves one renderer and restores record selection across attributed basemap changes', () => {
    const nativeRecords: import('../features/observations/types').DetectionFeature[] = resultFixtures.detections.features.map((feature) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] }, properties: feature.properties }))
    const { props } = renderMap({ apiMode: true, records: [], nativeRecords, basemapProvider: 'nasa-gibs' })
    act(() => lastMap().emit('style.load'))
    const map = lastMap()
    fireEvent.click(screen.getByRole('button', { name: 'Choose basemap' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Basemap' }), { target: { value: 'hybrid' } })
    expect(FakeMap.instances).toHaveLength(1)
    expect(map.setStyle).toHaveBeenCalledTimes(1)
    expect(map.sources.has('firebridge-native-records')).toBe(true)
    act(() => map.emitLayer('click', 'firebridge-native-record-points', { features: [{ properties: { id: 'native' } }] }))
    expect(props.onSelect).toHaveBeenCalledTimes(1)
    expect(props.onSelect).toHaveBeenCalledWith('native')
    fireEvent.click(screen.getByRole('button', { name: 'Reset map orientation' }))
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ bearing: 0, pitch: 0 }))
  })
  it('distinguishes failed satellite imagery from API data and offers explicit recovery choices', () => {
    renderMap({ apiMode: true, records: [], basemapProvider: 'nasa-gibs' })
    act(() => lastMap().emit('style.load'))
    act(() => { for (let i = 0; i < 3; i++) lastMap().emit('error', { sourceId: 'firebridge-nasa-imagery', error: new Error('offline') }) })
    expect(screen.getByText(/NASA satellite tiles could not be loaded/)).toBeTruthy()
    expect(screen.getByText(/SCHEMATIC VIEW — not satellite imagery/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry background' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try streets' })).toBeTruthy()
    expect(screen.queryByText('Analysis tiles could not be loaded')).toBeNull()
  })
  it('switches between native record inspection and aggregate tiles without recreating the map', () => {
    const nativeRecords: import('../features/observations/types').DetectionFeature[] = resultFixtures.detections.features.map((feature) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] }, properties: feature.properties,
    }))
    const { props, rerender } = renderMap({ apiMode: true, records: [], nativeRecords })
    act(() => lastMap().emit('style.load'))
    const map = lastMap()
    expect(map.sources.has('firebridge-native-records')).toBe(true)
    expect(map.sources.has('astra-demo-points')).toBe(false)
    const id = nativeRecords[0].properties.detection_id
    act(() => map.emitLayer('click', 'firebridge-native-record-points', { features: [{ properties: { id } }] }))
    expect(props.onSelect).toHaveBeenCalledWith(id)
    rerender(<MapView {...props} selectedId={id} />)
    expect(map.sources.get('firebridge-native-records')?.setData).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ properties: expect.objectContaining({ id, selected: true }) })] }))
    rerender(<MapView {...props} nativeRecords={undefined} />)
    expect(lastMap()).toBe(map)
    expect(map.sources.has('firebridge-native-records')).toBe(false)
  })
  const id = '22222222-2222-4222-8222-222222222222'
  it('requests only the whitelisted MVT source and renders no demo point source', () => {
    renderMap({ apiMode: true, apiAnalysisId: id, area: null })
    act(() => lastMap().emit('style.load'))
    expect(lastMap().sources.has('astra-demo-points')).toBe(false)
    expect(lastMap().sourceDefinitions.get('firebridge-detections')).toMatchObject({ type: 'vector', tiles: [`firebridge://tiles/${id}/detections/{z}/{x}/{y}.mvt`] })
    expect(screen.queryByText(/No demo records/)).toBeNull()
    expect(screen.getByText('Loading analysis tiles…')).toBeTruthy()
    act(() => lastMap().emit('idle'))
    expect(screen.getByText('No detections in the visible tiles')).toBeTruthy()
  })
  it('makes no tile source before results are available or while the layer is off', () => {
    const { rerender, props } = renderMap({ apiMode: true, area: null })
    act(() => lastMap().emit('style.load'))
    expect(lastMap().sources.has('firebridge-detections')).toBe(false)
    rerender(<MapView {...props} apiAnalysisId={id} showDetections={false} />)
    expect(lastMap().sources.has('firebridge-detections')).toBe(false)
    rerender(<MapView {...props} apiAnalysisId={id} showDetections />)
    expect(lastMap().sources.has('firebridge-detections')).toBe(true)
    rerender(<MapView {...props} apiAnalysisId={id} showDetections={false} />)
    expect(lastMap().sources.has('firebridge-detections')).toBe(false)
  })
  it('shows source failures separately from basemap availability and keeps errors visible on idle', () => {
    renderMap({ apiMode: true, apiAnalysisId: id, area: null, styleUrl: STYLE })
    act(() => lastMap().emit('style.load'))
    act(() => lastMap().emit('error', { sourceId: 'firebridge-detections', error: new Error('503') }))
    act(() => lastMap().emit('idle'))
    expect(screen.getByText('Analysis tiles could not be loaded')).toBeTruthy()
    expect(lastMap().setStyle).not.toHaveBeenCalled()
  })
  it('fits a saved area and restores its extent with the dedicated control', () => {
    renderMap({ apiMode: true })
    act(() => lastMap().emit('style.load'))
    expect(lastMap().fitBounds).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fit study area' }))
    expect(lastMap().fitBounds).toHaveBeenCalledTimes(2)
  })
})

describe('Finish drawing control', () => {
  const start = () => {
    const view = renderMap()
    act(() => lastMap().emit('style.load'))
    fireEvent.click(screen.getByLabelText('Draw polygon'))
    return view
  }

  it('is hidden until drawing starts and appears with Cancel', () => {
    renderMap()
    act(() => lastMap().emit('style.load'))
    expect(screen.queryByRole('button', { name: 'Finish drawing' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Draw polygon'))
    expect(screen.getByRole('button', { name: 'Finish drawing' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('is disabled and explained until three vertices exist', () => {
    start()
    const finish = screen.getByRole('button', { name: 'Finish drawing' }) as HTMLButtonElement
    expect(finish.disabled).toBe(true)
    act(() => lastDraw().progress(2))
    expect(finish.disabled).toBe(true)
    expect(screen.getByText(/2\/3 minimum/)).toBeTruthy()
    act(() => lastDraw().progress(3))
    expect(finish.disabled).toBe(false)
    expect(screen.getByText(/3 vertices added/)).toBeTruthy()
  })

  it('finishes through the same Enter handler Terra Draw uses', () => {
    start()
    act(() => lastDraw().progress(3))
    const keys: string[] = []
    lastMap().canvas.addEventListener('keyup', (event) => keys.push((event as KeyboardEvent).key))
    fireEvent.click(screen.getByRole('button', { name: 'Finish drawing' }))
    expect(keys).toEqual(['Enter'])
  })

  it('Cancel leaves polygon mode without creating an area', () => {
    const { props } = start()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(lastDraw().setMode).toHaveBeenLastCalledWith('view')
    expect(screen.queryByRole('button', { name: 'Finish drawing' })).toBeNull()
    expect(props.onAreaDrawn).not.toHaveBeenCalled()
  })

  it('offers a two-click rectangle that needs no Finish step and is validated the same way', () => {
    const { props } = renderMap()
    act(() => lastMap().emit('style.load'))
    fireEvent.click(screen.getByLabelText('Draw rectangle'))
    expect(lastDraw().setMode).toHaveBeenLastCalledWith('rectangle')
    expect(screen.queryByRole('button', { name: 'Finish drawing' })).toBeNull()
    expect(screen.getByText(/Click one corner, then click the opposite corner/)).toBeTruthy()
    const ring = [[-6, 34], [-5, 34], [-5, 35], [-6, 35], [-6, 34]]
    act(() => lastDraw().finish('r1', { type: 'Polygon', coordinates: [ring] }))
    expect(props.onAreaDrawn).toHaveBeenCalledWith({ type: 'Polygon', coordinates: [ring] }, expect.any(String))
    expect(screen.getByRole('group', { name: 'Draw a study area' })).toBeTruthy()
  })

  it('uses direct mouse gestures and never rotates the analysis map', () => {
    renderMap()
    expect(lastMap().options).toMatchObject({ cooperativeGestures: false, dragRotate: false, touchPitch: false })
  })

  it('still validates the finished polygon through shared handlers', () => {
    const { props } = start()
    const ring = [[-6, 34], [-5, 34], [-5, 35], [-6, 34]]
    act(() => lastDraw().finish('f1', { type: 'Polygon', coordinates: [ring] }))
    expect(props.onAreaDrawn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Finish drawing' })).toBeNull()
  })
})

describe('Optional Esri World Imagery provider (mocked MapLibre; no real tiles)', () => {
  it('uses a raster style with Esri attribution and no schematic banner', () => {
    renderMap({ basemapProvider: 'esri-world-imagery' })
    const style = lastMap().options.style as { sources: Record<string, { type: string; attribution: string; tiles: string[] }> }
    const source = Object.values(style.sources)[0]
    expect(source.type).toBe('raster')
    expect(source.attribution).toMatch(/Esri/)
    expect(source.tiles[0]).toContain('services.arcgisonline.com')
    expect(screen.queryByText(/SCHEMATIC VIEW/)).toBeNull()
  })

  it('lets an explicit style URL take precedence over the provider', () => {
    renderMap({ styleUrl: STYLE, basemapProvider: 'esri-world-imagery' })
    expect(lastMap().options.style).toBe(STYLE)
  })

  it('rejects unknown providers and stays on the schematic', () => {
    renderMap({ basemapProvider: 'someone-else' })
    expect(typeof lastMap().options.style).toBe('object')
    expect(screen.getByText(/map provider is not supported/)).toBeTruthy()
    expect(screen.getByText(/SCHEMATIC VIEW/)).toBeTruthy()
  })

  it('falls back after repeated tile failures before any tile loads', () => {
    renderMap({ basemapProvider: 'esri-world-imagery' })
    act(() => lastMap().emit('style.load'))
    for (let index = 0; index < 3; index += 1) act(() => lastMap().emit('error', { sourceId: 'astra-esri-world-imagery', error: new Error('net') }))
    expect(screen.getByText(/imagery tiles could not be loaded/i)).toBeTruthy()
    expect(lastMap().setStyle).toHaveBeenCalledTimes(1)
  })

  it('keeps the imagery and warns when tiles fail after some loaded', () => {
    renderMap({ basemapProvider: 'esri-world-imagery' })
    act(() => lastMap().emit('style.load'))
    act(() => lastMap().emit('data', { sourceId: 'astra-esri-world-imagery', dataType: 'source', tile: {} }))
    act(() => lastMap().emit('error', { sourceId: 'astra-esri-world-imagery', error: new Error('tile 500') }))
    expect(screen.getByText('Some imagery tiles failed to load')).toBeTruthy()
    expect(lastMap().setStyle).not.toHaveBeenCalled()
  })
})
