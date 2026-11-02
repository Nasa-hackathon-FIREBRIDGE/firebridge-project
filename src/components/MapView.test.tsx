// @vitest-environment jsdom
// maplibre-gl and terra-draw are replaced with mocks: jsdom has no WebGL, so these tests
// exercise MapView's own logic. They do NOT verify live basemap loading or real rendering.
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Detection, AreaOfInterest } from '../types'

const mocks = vi.hoisted(() => {
  type Handler = (event?: unknown) => void
  class FakeMap {
    static instances: FakeMap[] = []
    options: Record<string, unknown>
    handlers: Record<string, Handler[]> = {}
    layerHandlers: Record<string, Handler[]> = {}
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
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
    flyTo = vi.fn()
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
    addSource(id: string) { this.sources.set(id, { setData: vi.fn() }) }
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
  setWorkerUrl: vi.fn(),
}))
vi.mock('terra-draw', () => ({
  TerraDraw: mocks.FakeDraw,
  TerraDrawPolygonMode: class {},
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
  const props = { records, selectedId: null, onSelect: vi.fn(), area, showDetections: true, showArea: true, clearDrawingToken: 0, onAreaDrawn: vi.fn(), onAreaRejected: vi.fn(), onClearArea: vi.fn(), styleUrl: '', ...overrides }
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

  it('without a style URL uses the labelled schematic fallback immediately', () => {
    const { container } = renderMap({ styleUrl: '' })
    expect(typeof lastMap().options.style).toBe('object')
    expect(screen.getByText(/SCHEMATIC VIEW — not satellite imagery/)).toBeTruthy()
    expect(screen.getByText(/VITE_MAP_STYLE_URL is not set/)).toBeTruthy()
    expect(screen.queryByText('Loading basemap…')).toBeNull()
    expect(container.querySelector('[data-basemap="schematic"]')).toBeTruthy()
  })

  it('falls back to the schematic when the style fails to load', () => {
    renderMap({ styleUrl: STYLE })
    act(() => lastMap().emit('error', { error: new Error('HTTP 403') }))
    expect(screen.getByText(/could not be loaded \(HTTP 403\)/)).toBeTruthy()
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
    fireEvent.click(screen.getByLabelText('Draw area of interest'))
    expect(lastDraw().setMode).toHaveBeenLastCalledWith('polygon')
    fireEvent.click(screen.getByLabelText('Cancel area drawing'))
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

describe('Finish drawing control', () => {
  const start = () => {
    const view = renderMap()
    act(() => lastMap().emit('style.load'))
    fireEvent.click(screen.getByLabelText('Draw area of interest'))
    return view
  }

  it('is hidden until drawing starts and appears with Cancel', () => {
    renderMap()
    act(() => lastMap().emit('style.load'))
    expect(screen.queryByRole('button', { name: 'Finish drawing' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Draw area of interest'))
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
    expect(screen.getByText(/"someone-else" is not supported/)).toBeTruthy()
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
