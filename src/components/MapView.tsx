import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRenderMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { Crosshair, Layers2, MapPinned, Minus, Plus, SquareDashedMousePointer, Trash2, X } from 'lucide-react'
import type { Detection, AreaOfInterest } from '../types'
import { validatePolygon } from '../geometry'
import { ESRI_SOURCE_ID, envBasemapConfig, resolveBasemap } from '../basemap'

export type BasemapMode = 'real' | 'schematic'

const DEFAULT_CENTER: [number, number] = [-5.45, 35.2]
const DEFAULT_ZOOM = 7.2
const STYLE_LOAD_TIMEOUT_MS = 10000

const schematicStyle: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101b26' } }] }

function graticule(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  for (let lon = -14; lon <= 4; lon += 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, 30], [lon, 40]] } })
  for (let lat = 30; lat <= 40; lat += 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-14, lat], [4, lat]] } })
  return { type: 'FeatureCollection', features }
}

maplibregl.setWorkerUrl(maplibreWorker)

interface MapViewProps {
  records: Detection[]
  selectedId: string | null
  onSelect: (id: string) => void
  area: AreaOfInterest
  showDetections: boolean
  showArea: boolean
  clearDrawingToken: number
  onAreaDrawn: (geometry: GeoJSON.Polygon, basemap: BasemapMode) => void
  onAreaRejected?: (reason: string) => void
  onClearArea?: () => void
  styleUrl?: string
  basemapProvider?: string
  styleTimeoutMs?: number
  fullHeight?: boolean
}

export function MapView({ records, selectedId, onSelect, area, showDetections, showArea, clearDrawingToken, onAreaDrawn, onAreaRejected, onClearArea, styleUrl, basemapProvider, styleTimeoutMs = STYLE_LOAD_TIMEOUT_MS, fullHeight = false }: MapViewProps) {
  const env = envBasemapConfig()
  const selection = useMemo(() => resolveBasemap(styleUrl ?? env.styleUrl, basemapProvider ?? env.provider), [styleUrl, basemapProvider, env.styleUrl, env.provider])
  const selectionRef = useRef(selection)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const callbacks = useRef({ onSelect, onAreaDrawn, onAreaRejected })
  const [fallbackReason, setFallbackReason] = useState<string | null>(selection.kind === 'schematic' ? selection.reason : null)
  const [tileIssue, setTileIssue] = useState(false)
  const [vertexCount, setVertexCount] = useState(0)
  const [styleLoaded, setStyleLoaded] = useState(false)
  const [drawControl, setDrawControl] = useState({ clearToken: clearDrawingToken, active: false })
  const drawActive = drawControl.clearToken === clearDrawingToken && drawControl.active
  const [layersOpen, setLayersOpen] = useState(false)
  const basemap: BasemapMode = fallbackReason ? 'schematic' : 'real'
  const basemapRef = useRef<BasemapMode>(basemap)
  const drawActiveRef = useRef(drawActive)

  const featureCollection = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; selected: boolean; sensor: string }>>(() => ({
    type: 'FeatureCollection',
    features: records.map((record) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [record.longitude, record.latitude] },
      properties: { id: record.id, selected: record.id === selectedId, sensor: record.sensor },
    })),
  }), [records, selectedId])

  const areaFeature = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(() => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: area.geometry }],
  }), [area.geometry])
  const sourceData = useRef({ featureCollection, areaFeature })

  useEffect(() => {
    selectionRef.current = selection
    callbacks.current = { onSelect, onAreaDrawn, onAreaRejected }
    sourceData.current = { featureCollection, areaFeature }
    basemapRef.current = basemap
    drawActiveRef.current = drawActive
  }, [selection, onSelect, onAreaDrawn, onAreaRejected, featureCollection, areaFeature, basemap, drawActive])

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return
    let disposed = false
    let loaded = false
    let listenersBound = false
    let timeoutId: number | undefined
    let tilesLoaded = false
    let tileErrors = 0
    const current = selectionRef.current

    const map = new maplibregl.Map({
      container,
      style: current.kind === 'style-url' ? current.url : current.kind === 'esri' ? current.style : schematicStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      cooperativeGestures: true,
      maxZoom: 15,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // Compact control shows the style provider's own attribution when a real style is used.
    map.addControl(new maplibregl.AttributionControl({ compact: current.kind !== 'esri' }), 'bottom-right')
    mapRef.current = map

    const switchToFallback = (reason: string) => {
      if (disposed || basemapRef.current === 'schematic') return
      window.clearTimeout(timeoutId)
      basemapRef.current = 'schematic'
      loaded = false
      setStyleLoaded(false)
      setFallbackReason(reason)
      drawRef.current?.stop()
      drawRef.current = null
      map.setStyle(schematicStyle)
    }

    const ensureLayers = () => {
      if (disposed) return
      loaded = true
      window.clearTimeout(timeoutId)
      setStyleLoaded(true)
      if (basemapRef.current === 'schematic' && !map.getSource('astra-graticule')) {
        map.addSource('astra-graticule', { type: 'geojson', data: graticule() })
        map.addLayer({ id: 'astra-graticule', type: 'line', source: 'astra-graticule', paint: { 'line-color': '#2a3e4d', 'line-width': 0.8 } })
      }
      if (!map.getSource('astra-study-area')) {
        map.addSource('astra-study-area', { type: 'geojson', data: sourceData.current.areaFeature })
        map.addLayer({ id: 'astra-study-area-fill', type: 'fill', source: 'astra-study-area', paint: { 'fill-color': '#44bac1', 'fill-opacity': 0.05 } })
        map.addLayer({ id: 'astra-study-area-outline', type: 'line', source: 'astra-study-area', paint: { 'line-color': '#69d1d1', 'line-width': 1.5, 'line-dasharray': [2, 2] } })
      }
      if (!map.getSource('astra-demo-points')) {
        map.addSource('astra-demo-points', { type: 'geojson', data: sourceData.current.featureCollection })
        map.addLayer({ id: 'astra-demo-points-ring', type: 'circle', source: 'astra-demo-points', paint: { 'circle-radius': ['case', ['get', 'selected'], 9, 6], 'circle-color': ['case', ['==', ['get', 'sensor'], 'MODIS'], '#35c9cf', '#f09455'], 'circle-stroke-color': '#f3f7fa', 'circle-stroke-width': ['case', ['get', 'selected'], 2, 1], 'circle-opacity': 0.96 } })
      }
      if (!listenersBound) {
        listenersBound = true
        map.on('click', 'astra-demo-points-ring', (event) => {
          const id = event.features?.[0]?.properties?.id
          if (typeof id === 'string') callbacks.current.onSelect(id)
        })
        map.on('mouseenter', 'astra-demo-points-ring', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'astra-demo-points-ring', () => { map.getCanvas().style.cursor = '' })
      }
      if (!drawRef.current) {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map }),
          modes: [
            new TerraDrawPolygonMode({ keyEvents: { cancel: 'Escape', finish: 'Enter' } }),
            new TerraDrawRenderMode({ modeName: 'view', styles: {} }),
          ],
        })
        draw.start()
        draw.setMode(drawActiveRef.current ? 'polygon' : 'view')
        draw.on('finish', (id, context) => {
          if (context.action !== 'draw') return
          const feature = draw.getSnapshotFeature(id)
          // The accepted geometry is rendered from shared state, so the transient drawing is removed.
          draw.removeFeatures([id])
          draw.setMode('view')
          setDrawControl((current) => ({ ...current, active: false }))
          const result = validatePolygon(feature?.geometry)
          if (result.ok) callbacks.current.onAreaDrawn(result.geometry, basemapRef.current)
          else callbacks.current.onAreaRejected?.(result.reason)
        })
        draw.on('change', () => {
          const ring = draw.getSnapshot().find((feature) => feature.geometry.type === 'Polygon')?.geometry
          const coordinates = ring && ring.type === 'Polygon' ? ring.coordinates[0] : undefined
          setVertexCount(coordinates ? Math.max(0, coordinates.length - 2) : 0)
        })
        drawRef.current = draw
      }
    }

    map.on('style.load', ensureLayers)
    map.on('data', (event) => {
      const data = event as { sourceId?: string; dataType?: string; tile?: unknown }
      if (data.sourceId === ESRI_SOURCE_ID && data.dataType === 'source' && data.tile) { tilesLoaded = true; setTileIssue(false) }
    })
    map.on('error', (event) => {
      if (disposed) return
      if ((event as { sourceId?: string }).sourceId === ESRI_SOURCE_ID) {
        tileErrors += 1
        if (!tilesLoaded && tileErrors >= 3) switchToFallback('Esri World Imagery tiles could not be loaded (network unavailable or blocked).')
        else if (tilesLoaded) setTileIssue(true)
        return
      }
      if (!loaded && basemapRef.current === 'real') {
        const message = event.error?.message
        switchToFallback(`The configured basemap style could not be loaded${message ? ` (${message})` : ''}.`)
      }
    })
    if (current.kind === 'style-url') {
      timeoutId = window.setTimeout(() => { if (!loaded) switchToFallback('The configured basemap style did not load in time.') }, styleTimeoutMs)
    }

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (!disposed) map.resize() })
    observer?.observe(container)

    return () => {
      disposed = true
      window.clearTimeout(timeoutId)
      observer?.disconnect()
      drawRef.current?.stop()
      drawRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [selection.key, styleTimeoutMs])

  useEffect(() => {
    const source = mapRef.current?.getSource('astra-demo-points') as maplibregl.GeoJSONSource | undefined
    source?.setData(featureCollection)
  }, [featureCollection, styleLoaded])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('astra-study-area') as maplibregl.GeoJSONSource | undefined
    source?.setData(areaFeature)
    if (map?.getLayer('astra-study-area-fill')) map.setLayoutProperty('astra-study-area-fill', 'visibility', showArea ? 'visible' : 'none')
    if (map?.getLayer('astra-study-area-outline')) map.setLayoutProperty('astra-study-area-outline', 'visibility', showArea ? 'visible' : 'none')
  }, [areaFeature, showArea, styleLoaded])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('astra-demo-points-ring')) map.setLayoutProperty('astra-demo-points-ring', 'visibility', showDetections ? 'visible' : 'none')
  }, [showDetections, styleLoaded])

  useEffect(() => {
    // Leaving polygon mode discards any unfinished drawing, which is how cancel works.
    drawRef.current?.setMode(drawActive ? 'polygon' : 'view')
  }, [drawActive, styleLoaded])

  useEffect(() => {
    if (clearDrawingToken > 0) {
      const draw = drawRef.current
      if (draw) {
        const ids = draw.getSnapshot().map((feature) => feature.id).filter((id): id is string | number => id !== undefined)
        if (ids.length) draw.removeFeatures(ids)
        draw.setMode('view')
      }
    }
  }, [clearDrawingToken])

  const zoom = (amount: number) => mapRef.current?.zoomTo((mapRef.current.getZoom() ?? 7) + amount, { duration: 250 })
  const resetView = () => mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 450 })
  const finishDrawing = () => {
    // Terra Draw finishes on its Enter key handler, which listens on the map canvas.
    mapRef.current?.getCanvas().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  }
  const loading = basemap === 'real' && !styleLoaded

  return (
    <div className={`map-frame ${fullHeight ? 'map-frame-full' : ''}`} data-basemap={basemap}>
      <div ref={containerRef} className="map-canvas" aria-label={basemap === 'real' ? 'Interactive map of synthetic demonstration detections' : 'Interactive schematic map of synthetic demonstration detections (no real basemap)'} />
      {basemap === 'schematic' && (
        <div className="map-basemap-banner" role="status">
          <strong>SCHEMATIC VIEW — not satellite imagery</strong>
          <span>{fallbackReason} Real basemap unavailable; grid = 1° lines. Drawn areas are unverified.</span>
        </div>
      )}
      {loading && <div className="map-loading" role="status">Loading basemap…</div>}
      {tileIssue && basemap === 'real' && <div className="map-basemap-banner map-tile-issue" role="status"><strong>Some imagery tiles failed to load</strong><span>Detections remain usable; check your network connection.</span></div>}
      {records.length === 0 && <div className="map-empty" role="status"><strong>No demo records match the current filters</strong><span>Adjust the date range, platforms, search, FRP minimum or area.</span></div>}
      <div className="map-actions" aria-label="Map controls">
        <button type="button" className={`map-icon-button ${drawActive ? 'is-selected' : ''}`} aria-label={drawActive ? 'Cancel area drawing' : 'Draw area of interest'} title={drawActive ? 'Cancel drawing' : 'Draw area of interest'} onClick={() => setDrawControl({ clearToken: clearDrawingToken, active: !drawActive })}>{drawActive ? <X size={16} /> : <SquareDashedMousePointer size={16} />}</button>
        <button type="button" className="map-icon-button" aria-label="Clear selected area" title="Clear selected area" onClick={() => { setDrawControl({ clearToken: clearDrawingToken, active: false }); onClearArea?.() }}><Trash2 size={16} /></button>
        <button type="button" className="map-icon-button" aria-label="Zoom in" onClick={() => zoom(1)}><Plus size={16} /></button>
        <button type="button" className="map-icon-button" aria-label="Zoom out" onClick={() => zoom(-1)}><Minus size={16} /></button>
        <button type="button" className="map-icon-button" aria-label="Return to northern Morocco" onClick={resetView}><Crosshair size={16} /></button>
        <button type="button" className={`map-icon-button ${layersOpen ? 'is-selected' : ''}`} aria-label="Map layer legend" aria-expanded={layersOpen} onClick={() => setLayersOpen((value) => !value)}><Layers2 size={16} /></button>
      </div>
      {layersOpen && <div className="map-legend"><strong>Map legend</strong><span><i className="legend-dot legend-modis" />MODIS demo record</span><span><i className="legend-dot legend-viirs" />VIIRS demo record</span><span><i className="legend-dot legend-selected" />Selected record (larger)</span><span><i className="legend-line" />Study area</span></div>}
      {drawActive && (
        <div className="map-draw-bar" role="group" aria-label="Area drawing">
          <span className="map-draw-hint" role="status">{vertexCount < 3 ? `Click the map to add vertices (${vertexCount}/3 minimum).` : `${vertexCount} vertices added. Finish when ready.`} Enter finishes, Esc cancels.</span>
          <button type="button" className="map-draw-button map-draw-finish" onClick={finishDrawing} disabled={vertexCount < 3} title={vertexCount < 3 ? 'Add at least 3 vertices to finish' : 'Finish drawing'}>Finish drawing</button>
          <button type="button" className="map-draw-button" onClick={() => { setVertexCount(0); setDrawControl({ clearToken: clearDrawingToken, active: false }) }}>Cancel</button>
        </div>
      )}
      <div className="map-scale"><MapPinned size={12} /> Northern Morocco · WGS 84{basemap === 'real' && selection.kind === 'esri' ? ' · Esri World Imagery' : ''}</div>
    </div>
  )
}
