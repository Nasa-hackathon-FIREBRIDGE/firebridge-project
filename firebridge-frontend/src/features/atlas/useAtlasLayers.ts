import { useEffect, useRef, type RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { ExpressionSpecification, FilterSpecification, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { DAY, type AtlasData, type AtlasPoint } from './atlas'

/** What the pointer is over: one detection, or a group of detections close together at this zoom. */
export type AtlasHit =
  | { kind: 'detection'; index: number; x: number; y: number; lngLat: [number, number] }
  | { kind: 'group'; count: number; x: number; y: number; lngLat: [number, number]; cluster: number }

export interface AtlasPick {
  indices: number[]
  lngLat: [number, number]
}

export interface AtlasLayerConfig {
  data: AtlasData
  /** Detections in the selected period and satellites, grouped on the map. */
  visible: AtlasPoint[]
  /** While replaying: the end of the current day (ms), the satellites shown, and the afterglow length. */
  replay: { now: number; sensors: readonly number[]; glowDays: number } | null
  popup: { lngLat: [number, number]; node: HTMLElement } | null
  focus: { bounds: [number, number, number, number]; nonce: number; maxZoom?: number } | null
  onHover: (hit: AtlasHit | null) => void
  onPick: (pick: AtlasPick | null) => void
}

const GROUPS = 'atlas-groups'
const REPLAY = 'atlas-replay'
const STATIC_LAYERS = ['atlas-glow', 'atlas-core'] as const
const REPLAY_LAYERS = ['atlas-replay-glow', 'atlas-replay-core'] as const

const count: ExpressionSpecification = ['coalesce', ['get', 'point_count'], 1]
// The original FIREBRIDGE ember scale: more detections, larger and deeper red.
const coreColor: ExpressionSpecification = ['interpolate', ['linear'], count, 1, '#ffd28a', 8, '#ffa040', 40, '#ff5f1f', 200, '#d62d0a']
const glowColor: ExpressionSpecification = ['interpolate', ['linear'], count, 1, '#ff9f40', 40, '#ff5f1f', 200, '#d62d0a']
const coreRadius: ExpressionSpecification = ['interpolate', ['linear'], count, 1, 3, 20, 6.5, 200, 12, 2000, 18]
const glowRadius: ExpressionSpecification = ['interpolate', ['linear'], count, 1, 8, 20, 16, 200, 30, 2000, 40]

/** Days since a replayed detection, at the current replay instant. */
const age = (now: number): ExpressionSpecification => ['/', ['-', now, ['get', 't']], DAY]
const ember = (now: number, glowDays: number): ExpressionSpecification => ['interpolate', ['linear'], age(now), 0, '#fff4d6', 0.6, '#ffc56b', glowDays * 0.3, '#ff7c40', glowDays, '#8f2d0f']
const replayFilter = (now: number, sensors: readonly number[], glowDays: number): FilterSpecification => [
  'all', ['<', ['get', 't'], now], ['>=', ['get', 't'], now - glowDays * DAY], ['in', ['get', 's'], ['literal', [...sensors]]],
]

const has = (map: MapLibreMap, id: string) => !!map.getLayer(id)
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Draws the fire atlas on a MapLibre map: glowing ember circles grouped by proximity, a replay
 *  layer whose detections cool like embers, and a popup anchored to what was clicked. */
export function useAtlasLayers(mapRef: RefObject<MapLibreMap | null>, styleLoaded: boolean, styleRevision: number, config: AtlasLayerConfig | undefined, drawActive: boolean) {
  const latest = useRef(config)
  const drawing = useRef(drawActive)
  useEffect(() => {
    latest.current = config
    drawing.current = drawActive
  })
  const data = config?.data

  useEffect(() => {
    const map = mapRef.current
    const initial = latest.current
    if (!map || !styleLoaded || !data || !initial) return
    // Dim the imagery a little so fire reads first: the basemap is context, not data.
    const rasters = (map.getStyle?.()?.layers ?? []).filter((layer) => layer.type === 'raster').map((layer) => layer.id)
    for (const id of rasters) {
      map.setPaintProperty(id, 'raster-brightness-max', 0.62)
      map.setPaintProperty(id, 'raster-saturation', -0.35)
    }
    map.addSource(GROUPS, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: initial.visible } as GeoJSON.FeatureCollection,
      cluster: true,
      clusterRadius: 14,
      clusterMaxZoom: 12,
    })
    map.addSource(REPLAY, { type: 'geojson', data: { type: 'FeatureCollection', features: data.points } as GeoJSON.FeatureCollection })
    map.addLayer({ id: 'atlas-glow', type: 'circle', source: GROUPS, paint: { 'circle-color': glowColor, 'circle-radius': glowRadius, 'circle-blur': 1, 'circle-opacity': 0.32 } })
    map.addLayer({
      id: 'atlas-core', type: 'circle', source: GROUPS,
      paint: { 'circle-color': coreColor, 'circle-radius': coreRadius, 'circle-opacity': 0.95, 'circle-stroke-width': 0.8, 'circle-stroke-color': 'rgba(255, 245, 238, 0.85)' },
    })
    map.addLayer({ id: 'atlas-replay-glow', type: 'circle', source: REPLAY, filter: ['==', ['get', 'i'], -1], paint: { 'circle-blur': 1, 'circle-radius': 12, 'circle-opacity': 0.4 } })
    map.addLayer({ id: 'atlas-replay-core', type: 'circle', source: REPLAY, filter: ['==', ['get', 'i'], -1], paint: { 'circle-radius': 3, 'circle-blur': 0.35 } })

    let frame = 0
    let pending: MapMouseEvent | null = null
    const hitAt = (event: MapMouseEvent): AtlasHit | null => {
      const config = latest.current
      if (!config || drawing.current || typeof map.queryRenderedFeatures !== 'function') return null
      const { x, y } = event.point
      const layer = config.replay ? 'atlas-replay-core' : 'atlas-core'
      if (!has(map, layer)) return null
      let best: { hit: AtlasHit; d: number } | null = null
      for (const feature of map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: [layer] })) {
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
        const p = map.project(coordinates)
        const d = Math.hypot(p.x - x, p.y - y)
        if (best && d >= best.d) continue
        const props = feature.properties ?? {}
        const hit: AtlasHit = props.cluster
          ? { kind: 'group', count: Number(props.point_count), cluster: Number(props.cluster_id), x, y, lngLat: coordinates }
          : { kind: 'detection', index: Number(props.i), x, y, lngLat: coordinates }
        best = { hit, d }
      }
      return best?.hit ?? null
    }
    const flush = () => {
      frame = 0
      if (!pending) return
      const hit = hitAt(pending)
      pending = null
      map.getCanvas().style.cursor = hit ? 'pointer' : ''
      latest.current?.onHover(hit)
    }
    const move = (event: MapMouseEvent) => {
      pending = event
      if (!frame) frame = requestAnimationFrame(flush)
    }
    const out = () => {
      pending = null
      latest.current?.onHover(null)
    }
    const click = (event: MapMouseEvent) => {
      if (drawing.current) return
      const hit = hitAt(event)
      const config = latest.current
      if (!hit || !config) {
        config?.onPick(null)
        return
      }
      if (hit.kind === 'detection') {
        config.onPick({ indices: [hit.index], lngLat: hit.lngLat })
        return
      }
      const source = map.getSource(GROUPS) as maplibregl.GeoJSONSource | undefined
      void source?.getClusterLeaves(hit.cluster, hit.count, 0).then((leaves) => {
        latest.current?.onPick({ indices: leaves.map((leaf) => Number(leaf.properties?.i)).filter(Number.isInteger), lngLat: hit.lngLat })
      }).catch(() => undefined)
    }
    let removed = false
    const onRemove = () => {
      removed = true
    }
    map.on('mousemove', move)
    map.on('mouseout', out)
    map.on('click', click)
    map.on('remove', onRemove)
    return () => {
      cancelAnimationFrame(frame)
      map.off('mousemove', move)
      map.off('mouseout', out)
      map.off('click', click)
      map.off('remove', onRemove)
      if (removed) return
      for (const id of [...REPLAY_LAYERS, ...STATIC_LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of [GROUPS, REPLAY]) if (map.getSource(id)) map.removeSource(id)
      for (const id of rasters) {
        if (!map.getLayer(id)) continue
        map.setPaintProperty(id, 'raster-brightness-max', 1)
        map.setPaintProperty(id, 'raster-saturation', 0)
      }
    }
  }, [mapRef, styleLoaded, styleRevision, data])

  const visible = config?.visible
  useEffect(() => {
    const source = mapRef.current?.getSource(GROUPS) as maplibregl.GeoJSONSource | undefined
    source?.setData({ type: 'FeatureCollection', features: visible ?? [] } as GeoJSON.FeatureCollection)
  }, [mapRef, styleLoaded, styleRevision, data, visible])

  const replay = config?.replay ?? null
  const now = replay?.now
  const glowDays = replay?.glowDays ?? 7
  const replaySensors = replay?.sensors.join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoaded || !data) return
    const on = now !== undefined
    for (const id of STATIC_LAYERS) if (has(map, id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible')
    for (const id of REPLAY_LAYERS) if (has(map, id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    if (!on) return
    const sensors = (replaySensors ?? '').split(',').filter(Boolean).map(Number)
    const filter = replayFilter(now, sensors, glowDays)
    const color = ember(now, glowDays)
    if (has(map, 'atlas-replay-glow')) {
      map.setFilter('atlas-replay-glow', filter)
      map.setPaintProperty('atlas-replay-glow', 'circle-color', color)
      map.setPaintProperty('atlas-replay-glow', 'circle-radius', ['interpolate', ['linear'], age(now), 0, 14, glowDays * 0.3, 9, glowDays, 4])
      map.setPaintProperty('atlas-replay-glow', 'circle-opacity', ['interpolate', ['linear'], age(now), 0, 0.2, glowDays, 0.03])
    }
    if (has(map, 'atlas-replay-core')) {
      map.setFilter('atlas-replay-core', filter)
      map.setPaintProperty('atlas-replay-core', 'circle-color', color)
      map.setPaintProperty('atlas-replay-core', 'circle-radius', ['interpolate', ['linear'], age(now), 0, 3.6, glowDays, 1.6])
      map.setPaintProperty('atlas-replay-core', 'circle-opacity', ['interpolate', ['linear'], age(now), 0, 1, glowDays, 0.35])
    }
  }, [mapRef, styleLoaded, styleRevision, data, now, glowDays, replaySensors])

  const popupNode = config?.popup?.node
  const popupAt = config?.popup?.lngLat.join(',')
  useEffect(() => {
    const map = mapRef.current
    const popup = latest.current?.popup
    if (!map || !styleLoaded || !popup || typeof maplibregl.Popup !== 'function') return
    const instance = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '320px', offset: 16, className: 'atlas-popup' })
      .setLngLat(popup.lngLat)
      .setDOMContent(popup.node)
      .addTo(map)
    return () => {
      instance.remove()
    }
  }, [mapRef, styleLoaded, popupNode, popupAt])

  const focusNonce = config?.focus?.nonce
  useEffect(() => {
    const map = mapRef.current
    const focus = latest.current?.focus
    if (!map || !styleLoaded || !focus) return
    const [w, s, e, n] = focus.bounds
    map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: focus.maxZoom ?? 11, duration: reducedMotion() ? 0 : 900 })
  }, [mapRef, styleLoaded, focusNonce])
}
