import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawRenderMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { MapPinned } from 'lucide-react'
import type { Detection, AreaOfInterest } from '../types'
import { validatePolygon } from '../geometry'
import { envBasemapConfig, resolveBasemap, selectBasemap, type BasemapChoice, type BasemapSelection } from '../basemap'
import { MapWorkspaceControls, type DrawShape } from './MapWorkspaceControls'
import { useAnalysisTiles } from '../features/maps/useAnalysisTiles'
import { registerImageryProtocol } from '../features/maps/imageryCache'
import type { DetectionFeature } from '../features/observations/types'
import { useAtlasLayers, type AtlasLayerConfig } from '../features/atlas/useAtlasLayers'
import { PlacePicker, type PickedPlace } from '../features/places/PlacePicker'
import { usePlacePicker } from '../features/places/usePlacePicker'

export type BasemapMode = 'real' | 'schematic'

const DEFAULT_CENTER: [number, number] = [-5.45, 35.2]
const DEFAULT_ZOOM = 7.2
const STYLE_LOAD_TIMEOUT_MS = 10000

const schematicStyle: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101b26' } }] }

function graticule(global = false): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
  const [west, east, south, north, step] = global ? [-180, 180, -80, 80, 10] : [-14, 4, 30, 40, 1]
  for (let lon = west; lon <= east; lon += step) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, south], [lon, north]] } })
  for (let lat = south; lat <= north; lat += step) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[west, lat], [east, lat]] } })
  return { type: 'FeatureCollection', features }
}

function fitStudyArea(map: MapLibreMap, area: AreaOfInterest) {
  const polygons = area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates
  const positions = polygons.flat(2)
  if (!positions.length) return
  const origin = positions[0][0]
  const longitude = (lon: number) => origin + ((lon - origin + 540) % 360) - 180
  const bounds = positions.reduce((box, p) => box.extend([longitude(p[0]), p[1]]), new maplibregl.LngLatBounds())
  map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 })
}

const DRAW_STYLE = {
  fillColor: '#ff7c40', fillOpacity: 0.16, outlineColor: '#ffb547', outlineWidth: 2,
  coordinatePointColor: '#fff5ee', coordinatePointWidth: 4, coordinatePointOutlineColor: '#ff5f1f', coordinatePointOutlineWidth: 2,
} as const
const POLYGON_STYLE = { ...DRAW_STYLE, closingPointColor: '#ffb547', closingPointWidth: 6, closingPointOutlineColor: '#06070b', closingPointOutlineWidth: 2 } as const

function formatLngLat(lng: number, lat: number) {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(wrapped).toFixed(3)}° ${wrapped >= 0 ? 'E' : 'W'}`
}

/** Touch devices keep two-finger panning so the page can still scroll; mice get direct wheel zoom. */
const coarsePointer = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

maplibregl.setWorkerUrl(maplibreWorker)

interface MapViewProps {
  records: Detection[]
  selectedId: string | null
  onSelect: (id: string) => void
  area: AreaOfInterest | null
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
  apiMode?: boolean
  apiAnalysisId?: string
  nativeRecords?: DetectionFeature[]
  onShowArea?: (visible: boolean) => void
  onShowDetections?: (visible: boolean) => void
  /** Highlights the drawing toolbar when no study area exists yet. */
  promptDraw?: boolean
  /** Every detection drawn client-side, with lenses, time window and picking. */
  atlas?: AtlasLayerConfig
  /** Overlays drawn over the map, inside the frame so fullscreen keeps them. */
  children?: ReactNode
  /** Controls docked under the map, inside the frame. */
  footer?: ReactNode
  /** Choosing a country, region, province or forest as the study area; the toolbar offers it when set. */
  onPlacePicked?: (place: PickedPlace) => void
  /** The server's largest accepted study area, so the picker can say when a place is too large. */
  maxAreaKm2?: number
  /** Told when choosing a place starts and stops, so the limits are fetched only when needed. */
  onPickingChange?: (picking: boolean) => void
}

export function MapView({ records, nativeRecords, selectedId, onSelect, area, showDetections, showArea, onShowArea, onShowDetections, clearDrawingToken, onAreaDrawn, onAreaRejected, onClearArea, styleUrl, basemapProvider, styleTimeoutMs = STYLE_LOAD_TIMEOUT_MS, fullHeight = false, apiMode = false, apiAnalysisId, promptDraw = false, atlas, children, footer, onPlacePicked, maxAreaKm2, onPickingChange }: MapViewProps) {
  const env = envBasemapConfig()
  const configured = useMemo(() => resolveBasemap(styleUrl ?? env.styleUrl, basemapProvider ?? env.provider), [styleUrl, basemapProvider, env.styleUrl, env.provider])
  const [choice, setChoice] = useState<BasemapChoice>(() => configured.key === 'nasa-satellite' ? 'satellite' : 'configured')
  const selection = useMemo(() => selectBasemap(choice, configured), [choice, configured])
  const selectionRef = useRef(selection)
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const switchStyle = useRef<((selection: BasemapSelection) => void) | null>(null)
  const appliedStyle = useRef(selection.key)
  const basemapLayerIds = useRef<string[]>([])
  const mapRef = useRef<MapLibreMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const callbacks = useRef({ onSelect, onAreaDrawn, onAreaRejected })
  const [fallbackReason, setFallbackReason] = useState<string | null>(selection.kind === 'schematic' ? selection.reason : null)
  const [imageryDelayed, setImageryDelayed] = useState(false)
  const retryImagery = useRef<(() => void) | null>(null)
  const [vertexCount, setVertexCount] = useState(0)
  const [styleLoaded, setStyleLoaded] = useState(false)
  const [styleRevision, setStyleRevision] = useState(0)
  const [imageryReady, setImageryReady] = useState(false)
  const [showBasemap, setShowBasemap] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlError, setControlError] = useState('')
  const apiTileState = useAnalysisTiles(mapRef, styleLoaded, apiMode ? apiAnalysisId : undefined, showDetections, styleRevision)
  const [drawControl, setDrawControl] = useState<{ clearToken: number; active: boolean; shape: DrawShape }>({ clearToken: clearDrawingToken, active: false, shape: 'rectangle' })
  const drawActive = drawControl.clearToken === clearDrawingToken && drawControl.active
  const drawShape = drawControl.shape
  const coordinatesRef = useRef<HTMLSpanElement>(null)
  const [panel, setPanel] = useState<'layers' | 'basemap' | 'legend' | null>(null)
  const basemap: BasemapMode = fallbackReason ? 'schematic' : 'real'
  const basemapRef = useRef<BasemapMode>(basemap)
  const drawActiveRef = useRef(drawActive)
  const drawShapeRef = useRef<DrawShape>(drawShape)
  const [pickActive, setPickActiveState] = useState(false)
  const setPickActive = (value: boolean) => {
    setPickActiveState(value)
    onPickingChange?.(value)
  }
  const picker = usePlacePicker(mapRef, styleLoaded, styleRevision, pickActive && !!onPlacePicked)
  useAtlasLayers(mapRef, styleLoaded, styleRevision, atlas, drawActive || pickActive)

  const featureCollection = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; selected: boolean; sensor: string }>>(() => ({
    type: 'FeatureCollection',
    features: nativeRecords ? nativeRecords.map((record) => ({
      type: 'Feature' as const,
      geometry: record.geometry,
      properties: { id: record.properties.detection_id, selected: record.properties.detection_id === selectedId, sensor: 'native' },
    })) : records.map((record) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [record.longitude, record.latitude] },
      properties: { id: record.id, selected: record.id === selectedId, sensor: record.sensor },
    })),
  }), [records, nativeRecords, selectedId])

  const areaFeature = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(() => ({
    type: 'FeatureCollection',
    features: area ? [{ type: 'Feature', properties: {}, geometry: area.geometry }] : [],
  }), [area])
  const sourceData = useRef({ featureCollection, areaFeature })

  useEffect(() => {
    selectionRef.current = selection
    callbacks.current = { onSelect, onAreaDrawn, onAreaRejected }
    sourceData.current = { featureCollection, areaFeature }
    basemapRef.current = basemap
    drawActiveRef.current = drawActive
    drawShapeRef.current = drawShape
  }, [selection, onSelect, onAreaDrawn, onAreaRejected, featureCollection, areaFeature, basemap, drawActive, drawShape])

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return
    let disposed = false
    let loaded = false
    let listenersBound = false
    let timeoutId: number | undefined
    let tilesLoaded = false
    let tileErrors = 0
    let current = selectionRef.current
    let retryId: number | undefined
    let attempt = 0

    registerImageryProtocol()
    const map = new maplibregl.Map({
      container,
      style: current.kind === 'style-url' ? current.url : current.kind === 'schematic' ? schematicStyle : current.style,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      cooperativeGestures: coarsePointer(),
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxZoom: 15,
    })
    // A 2D analysis map: accidental rotation only disorients, so gestures never rotate it.
    map.touchZoomRotate?.disableRotation?.()
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
    map.on('mousemove', (event: maplibregl.MapMouseEvent) => {
      if (coordinatesRef.current && event.lngLat) coordinatesRef.current.textContent = formatLngLat(event.lngLat.lng, event.lngLat.lat)
    })
    map.on('mouseout', () => { if (coordinatesRef.current) coordinatesRef.current.textContent = '' })
    // Compact control shows the style provider's own attribution when a real style is used.
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right')
    mapRef.current = map

    const imagerySources = () => (current.kind === 'esri' || current.kind === 'raster' ? Object.keys(current.style.sources) : [])
    // Slow or failing imagery never replaces the map: the grid underneath shows through while tiles are asked for again.
    const scheduleRetry = () => {
      if (disposed || retryId !== undefined) return
      retryId = window.setTimeout(refreshImagery, Math.min(30_000, 4_000 * 2 ** attempt))
    }
    const refreshImagery = () => {
      window.clearTimeout(retryId)
      retryId = undefined
      if (disposed || basemapRef.current === 'schematic' || !current.sourceId) return
      attempt += 1
      for (const id of imagerySources()) if (map.getSource(id)) map.refreshTiles(id)
      if (!tilesLoaded) scheduleRetry()
    }
    const markDelayed = () => {
      setImageryDelayed(true)
      refreshImagery()
    }
    const stopRetrying = () => {
      window.clearTimeout(retryId)
      retryId = undefined
      attempt = 0
      setImageryDelayed(false)
    }

    const switchToFallback = (reason: string) => {
      if (disposed || basemapRef.current === 'schematic') return
      window.clearTimeout(timeoutId)
      stopRetrying()
      basemapRef.current = 'schematic'
      loaded = false
      setStyleLoaded(false)
      setImageryReady(false)
      setFallbackReason(reason)
      drawRef.current?.stop()
      drawRef.current = null
      map.setStyle(schematicStyle)
    }

    const ensureLayers = () => {
      if (disposed) return
      loaded = true
      const imagery = basemapRef.current === 'real' && (current.kind === 'esri' || current.kind === 'raster') ? current.style.layers : null
      basemapLayerIds.current = basemapRef.current === 'schematic' ? ['background', 'astra-graticule'] : current.kind === 'style-url' ? (map.getStyle?.().layers ?? []).map((layer) => layer.id) : imagery ? [...imagery.map((layer) => layer.id), 'astra-graticule'] : []
      if (current.kind === 'schematic' || !current.sourceId || tilesLoaded) window.clearTimeout(timeoutId)
      setStyleLoaded(true)
      setStyleRevision((value) => value + 1)
      if (current.kind === 'style-url') setImageryReady(true)
      if ((basemapRef.current === 'schematic' || imagery) && !map.getSource('astra-graticule')) {
        map.addSource('astra-graticule', { type: 'geojson', data: graticule(apiMode) })
        // Under satellite imagery the grid only shows where tiles have not arrived.
        map.addLayer({ id: 'astra-graticule', type: 'line', source: 'astra-graticule', paint: { 'line-color': '#2a3e4d', 'line-width': 0.8 } }, imagery?.find((layer) => layer.type === 'raster')?.id)
      }
      if (!map.getSource('astra-study-area')) {
        map.addSource('astra-study-area', { type: 'geojson', data: sourceData.current.areaFeature })
        map.addLayer({ id: 'astra-study-area-fill', type: 'fill', source: 'astra-study-area', paint: { 'fill-color': '#ff7c40', 'fill-opacity': 0.06 } })
        map.addLayer({ id: 'astra-study-area-outline', type: 'line', source: 'astra-study-area', paint: { 'line-color': '#ffb547', 'line-width': 1.6, 'line-dasharray': [2, 1.5] } })
      }
      if (!apiMode && !map.getSource('astra-demo-points')) {
        map.addSource('astra-demo-points', { type: 'geojson', data: sourceData.current.featureCollection })
        map.addLayer({ id: 'astra-demo-points-ring', type: 'circle', source: 'astra-demo-points', paint: { 'circle-radius': ['case', ['get', 'selected'], 9, 6], 'circle-color': ['case', ['==', ['get', 'sensor'], 'MODIS'], '#38c6f4', '#ff7c40'], 'circle-stroke-color': '#f3f7fa', 'circle-stroke-width': ['case', ['get', 'selected'], 2, 1], 'circle-opacity': 0.96 } })
      }
      if (!apiMode && !listenersBound) {
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
            new TerraDrawPolygonMode({ keyEvents: { cancel: 'Escape', finish: 'Enter' }, styles: POLYGON_STYLE }),
            new TerraDrawRectangleMode({ keyEvents: { cancel: 'Escape', finish: 'Enter' }, styles: DRAW_STYLE }),
            new TerraDrawRenderMode({ modeName: 'view', styles: {} }),
          ],
        })
        draw.start()
        draw.setMode(drawActiveRef.current ? drawShapeRef.current : 'view')
        draw.on('finish', (id, context) => {
          if (context.action !== 'draw') return
          const feature = draw.getSnapshotFeature(id)
          // The accepted geometry is rendered from shared state, so the transient drawing is removed.
          draw.removeFeatures([id])
          draw.setMode('view')
          setDrawControl((current) => ({ ...current, active: false }))
          const result = validatePolygon(feature?.geometry)
          if (result.ok) callbacks.current.onAreaDrawn(result.geometry, basemapRef.current === 'real' && (!current.sourceId || tilesLoaded) ? 'real' : 'schematic')
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
      if (data.sourceId === current.sourceId && data.dataType === 'source' && data.tile) { tilesLoaded = true; attempt = 0; setImageryDelayed(false); setImageryReady(true); window.clearTimeout(timeoutId) }
    })
    map.on('error', (event) => {
      if (disposed) return
      if ((event as { sourceId?: string }).sourceId === 'firebridge-detections') return
      if (current.kind === 'style-url' && [401, 403].includes((event.error as { status?: number })?.status ?? 0)) {
        switchToFallback('Configured basemap access was denied. Check its browser-safe API token and allowed origins, or choose another background map.')
        return
      }
      const sourceId = (event as { sourceId?: string }).sourceId
      if (sourceId && imagerySources().includes(sourceId)) {
        if (sourceId === current.sourceId) tileErrors += 1
        if (!tilesLoaded && tileErrors >= 3) setImageryDelayed(true)
        scheduleRetry()
        return
      }
      if (!loaded && basemapRef.current === 'real') {
        switchToFallback('The configured basemap style could not be loaded. Check your connection or use the schematic view.')
      }
    })
    // A map in a hidden tab panel or a background browser tab requests no tiles, so the deadline only runs while it is on screen.
    let size: { width: number; height: number } | null = null
    const onScreen = () => document.visibilityState !== 'hidden' && (!size || (size.width > 0 && size.height > 0))
    const waiting = () => basemapRef.current !== 'schematic' && (!loaded || (!!current.sourceId && !tilesLoaded))
    const armTimeout = () => {
      window.clearTimeout(timeoutId)
      if (current.kind !== 'schematic' && onScreen()) timeoutId = window.setTimeout(() => {
        if (!waiting()) return
        if (loaded) markDelayed()
        else switchToFallback('The selected basemap did not load in time. Choose another background map or retry.')
      }, styleTimeoutMs)
    }
    let shown = onScreen()
    const screenChanged = () => {
      if (disposed || onScreen() === shown) return
      shown = !shown
      if (waiting()) armTimeout()
      if (shown && retryId !== undefined) refreshImagery()
    }
    const retryNow = () => {
      attempt = 0
      refreshImagery()
    }
    const backOnline = () => { if (retryId !== undefined) retryNow() }
    retryImagery.current = retryNow
    document.addEventListener('visibilitychange', screenChanged)
    window.addEventListener('online', backOnline)
    armTimeout()
    switchStyle.current = (next) => {
      current = next
      loaded = false
      tilesLoaded = false
      tileErrors = 0
      stopRetrying()
      setStyleLoaded(false)
      setImageryReady(false)
      setFallbackReason(next.kind === 'schematic' ? next.reason : null)
      basemapRef.current = next.kind === 'schematic' ? 'schematic' : 'real'
      drawRef.current?.stop()
      drawRef.current = null
      armTimeout()
      map.setStyle(next.kind === 'style-url' ? next.url : next.kind === 'schematic' ? schematicStyle : next.style)
    }

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      if (disposed) return
      const box = entries[entries.length - 1]?.contentRect
      if (box) size = { width: box.width, height: box.height }
      map.resize()
      screenChanged()
    })
    observer?.observe(container)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', screenChanged)
      window.removeEventListener('online', backOnline)
      window.clearTimeout(timeoutId)
      window.clearTimeout(retryId)
      retryImagery.current = null
      switchStyle.current = null
      observer?.disconnect()
      drawRef.current?.stop()
      drawRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [styleTimeoutMs, apiMode])

  useEffect(() => {
    if (appliedStyle.current === selection.key) return
    appliedStyle.current = selection.key
    switchStyle.current?.(selection)
  }, [selection])

  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === frameRef.current); mapRef.current?.resize() }
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoaded) return
    for (const id of basemapLayerIds.current) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showBasemap ? 'visible' : 'none')
  }, [selection, showBasemap, styleLoaded, styleRevision])

  useEffect(() => {
    if (!apiMode || !area || !styleLoaded) return
    if (mapRef.current) fitStudyArea(mapRef.current, area)
  }, [apiMode, area, styleLoaded])

  useEffect(() => {
    const source = mapRef.current?.getSource('astra-demo-points') as maplibregl.GeoJSONSource | undefined
    source?.setData(featureCollection)
  }, [featureCollection, styleLoaded, styleRevision])

  const nativeRecordsEnabled = nativeRecords !== undefined
  useEffect(() => {
    const map = mapRef.current
    if (!apiMode || !nativeRecordsEnabled || !styleLoaded || !map) return
    map.addSource('firebridge-native-records', { type: 'geojson', data: sourceData.current.featureCollection })
    map.addLayer({ id: 'firebridge-native-record-points', source: 'firebridge-native-records', type: 'circle', paint: {
      'circle-radius': ['case', ['get', 'selected'], 8, 4.5], 'circle-color': '#ff7c40',
      'circle-stroke-color': '#fff5ee', 'circle-stroke-width': ['case', ['get', 'selected'], 2, 1],
    } })
    const select = (event: maplibregl.MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id
      if (typeof id === 'string') callbacks.current.onSelect(id)
    }
    const enter = () => { map.getCanvas().style.cursor = 'pointer' }
    const leave = () => { map.getCanvas().style.cursor = '' }
    map.on('click', 'firebridge-native-record-points', select)
    map.on('mouseenter', 'firebridge-native-record-points', enter)
    map.on('mouseleave', 'firebridge-native-record-points', leave)
    return () => {
      map.off('click', 'firebridge-native-record-points', select)
      map.off('mouseenter', 'firebridge-native-record-points', enter)
      map.off('mouseleave', 'firebridge-native-record-points', leave)
      if (!mapRef.current) return
      if (map.getLayer('firebridge-native-record-points')) map.removeLayer('firebridge-native-record-points')
      if (map.getSource('firebridge-native-records')) map.removeSource('firebridge-native-records')
    }
  }, [apiMode, nativeRecordsEnabled, styleLoaded, styleRevision])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('firebridge-native-records') as maplibregl.GeoJSONSource | undefined
    source?.setData(featureCollection)
    if (map?.getLayer('firebridge-native-record-points')) map.setLayoutProperty('firebridge-native-record-points', 'visibility', showDetections ? 'visible' : 'none')
  }, [featureCollection, showDetections, nativeRecordsEnabled, styleLoaded, styleRevision])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('astra-study-area') as maplibregl.GeoJSONSource | undefined
    source?.setData(areaFeature)
    if (map?.getLayer('astra-study-area-fill')) map.setLayoutProperty('astra-study-area-fill', 'visibility', showArea ? 'visible' : 'none')
    if (map?.getLayer('astra-study-area-outline')) map.setLayoutProperty('astra-study-area-outline', 'visibility', showArea ? 'visible' : 'none')
  }, [areaFeature, showArea, styleLoaded, styleRevision])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('astra-demo-points-ring')) map.setLayoutProperty('astra-demo-points-ring', 'visibility', showDetections ? 'visible' : 'none')
  }, [showDetections, styleLoaded, styleRevision])

  useEffect(() => {
    // Leaving a drawing mode discards any unfinished shape, which is how cancel works.
    drawRef.current?.setMode(drawActive ? drawShape : 'view')
    // Double-click would zoom in the middle of placing vertices.
    const doubleClick = mapRef.current?.doubleClickZoom
    if (drawActive) doubleClick?.disable?.()
    else doubleClick?.enable?.()
  }, [drawActive, drawShape, styleLoaded])

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

  const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const zoom = (amount: number) => mapRef.current?.zoomTo((mapRef.current.getZoom() ?? 7) + amount, { duration: reducedMotion() ? 0 : 250 })
  const resetView = () => { if (apiMode && area && mapRef.current) fitStudyArea(mapRef.current, area); else mapRef.current?.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: reducedMotion() ? 0 : 450 }) }
  const finishDrawing = () => {
    // Terra Draw finishes on its Enter key handler, which listens on the map canvas.
    mapRef.current?.getCanvas().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  }
  const loading = basemap === 'real' && (!styleLoaded || !imageryReady) && showBasemap && !imageryDelayed
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === frameRef.current) await document.exitFullscreen()
      else if (frameRef.current?.requestFullscreen) await frameRef.current.requestFullscreen()
      else setControlError('Fullscreen is unavailable in this browser.')
    } catch { setControlError('Fullscreen could not open. Try your browser’s fullscreen command.') }
  }

  return (
    <div ref={frameRef} className={`map-frame ${fullHeight ? 'map-frame-full' : ''} ${footer ? 'map-frame-docked' : ''}`} data-basemap={basemap} data-atlas={atlas ? (atlas.replay ? "replay" : "atlas") : undefined}>
      <div className="map-stage">
      <div ref={containerRef} className="map-canvas" aria-label={apiMode ? 'Interactive map of the selected analysis and study area' : basemap === 'real' ? 'Interactive map of synthetic demonstration detections' : 'Interactive schematic map of synthetic demonstration detections (no real basemap)'} />
      {basemap === 'schematic' && (
        <div className="map-basemap-banner" role="status">
          <strong>SCHEMATIC VIEW — not satellite imagery</strong>
          <span>{fallbackReason} Grid = {apiMode ? '10°' : '1°'} lines; drawn areas are unverified.</span>
          <div className="map-recovery-actions"><button type="button" onClick={() => { appliedStyle.current = selection.key; switchStyle.current?.(selection) }}>Retry background</button><button type="button" onClick={() => setChoice(selection.key.startsWith('nasa-') ? 'streets' : 'satellite')}>Try {selection.key.startsWith('nasa-') ? 'streets' : 'NASA satellite'}</button></div>
        </div>
      )}
      {loading && <div className="map-loading" role="status">Loading basemap…</div>}
      {controlError && <div className="map-control-error" role="status">{controlError}<button type="button" onClick={() => setControlError('')} aria-label="Dismiss map control message">×</button></div>}
      {imageryDelayed && basemap === 'real' && showBasemap && (
        <div className="map-basemap-banner map-imagery-delayed" role="status">
          <strong>{selection.label} is slow to arrive</strong>
          <span>Detections stay usable meanwhile, and the map keeps trying on its own.</span>
          <div className="map-recovery-actions"><button type="button" onClick={() => retryImagery.current?.()}>Try now</button><button type="button" onClick={() => setChoice(selection.key.startsWith('nasa-') ? 'streets' : 'satellite')}>Use {selection.key.startsWith('nasa-') ? 'street map' : 'NASA satellite'}</button></div>
        </div>
      )}
      {!apiMode && records.length === 0 && <div className="map-empty" role="status"><strong>No demo records match the current filters</strong><span>Adjust the date range, platforms, search, FRP minimum or area.</span></div>}
      {apiMode && apiAnalysisId && showDetections && apiTileState !== 'ready' && <div className="map-empty" role={apiTileState === 'error' ? 'alert' : 'status'}><strong>{apiTileState === 'error' ? 'Analysis tiles could not be loaded' : apiTileState === 'empty' ? 'No detections in the visible tiles' : 'Loading analysis tiles…'}</strong><span>{apiTileState === 'error' ? 'Check analysis availability or request limits. Hide and re-enable the layer to retry.' : 'Tile counts are aggregated records, not observation coverage.'}</span></div>}
      <MapWorkspaceControls panel={panel} onPanel={setPanel} choice={choice} onChoice={setChoice} selection={selection} configured={configured.key !== 'nasa-satellite'}
        drawActive={drawActive || pickActive} onDraw={(shape) => { setPickActive(false); setDrawControl({ clearToken: clearDrawingToken, active: true, shape }) }} promptDraw={promptDraw}
        onPick={onPlacePicked ? () => { setDrawControl({ clearToken: clearDrawingToken, active: false, shape: drawShape }); setPickActive(true) } : undefined}
        onClear={() => { setDrawControl({ clearToken: clearDrawingToken, active: false, shape: drawShape }); onClearArea?.() }}
        onZoom={zoom} onFit={resetView} onNorth={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: reducedMotion() ? 0 : 250 })}
        onFullscreen={() => { void toggleFullscreen() }} fullscreen={fullscreen}
        showArea={showArea} onShowArea={onShowArea} showDetections={showDetections} onShowDetections={onShowDetections}
        showBasemap={showBasemap} onShowBasemap={setShowBasemap} apiMode={apiMode} recordMode={nativeRecords !== undefined} atlasMode={!!atlas} />
      {drawActive && (
        <div className="map-draw-bar" role="group" aria-label="Area drawing">
          <span className="map-draw-hint" role="status">
            {drawShape === 'rectangle'
              ? 'Click one corner, then click the opposite corner. Esc cancels.'
              : `${vertexCount < 3 ? `Click the map to add vertices (${vertexCount}/3 minimum).` : `${vertexCount} vertices added. Finish when ready.`} Click the first point or press Enter to finish. Esc cancels.`}
          </span>
          {drawShape === 'polygon' && <button type="button" className="map-draw-button map-draw-finish" onClick={finishDrawing} disabled={vertexCount < 3} title={vertexCount < 3 ? 'Add at least 3 vertices to finish' : 'Finish drawing'}>Finish drawing</button>}
          <button type="button" className="map-draw-button" data-draw-cancel onClick={() => { setVertexCount(0); setDrawControl({ clearToken: clearDrawingToken, active: false, shape: drawShape }) }}>Cancel</button>
        </div>
      )}
      {pickActive && onPlacePicked && (
        <PlacePicker picker={picker} maxAreaKm2={maxAreaKm2} onClose={() => setPickActive(false)} onUse={(place) => { setPickActive(false); onPlacePicked(place) }} />
      )}
      <div className="map-scale"><MapPinned size={12} /> {apiMode ? 'Study area' : 'Northern Morocco'} · WGS 84{basemap === 'real' && selection.kind === 'esri' ? ' · Esri World Imagery' : ''}<span ref={coordinatesRef} className="map-coordinates" aria-hidden="true" /></div>
      {children}
      </div>
      {footer}
    </div>
  )
}
