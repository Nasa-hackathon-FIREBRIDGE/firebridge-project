import { useEffect, useState, type RefObject } from 'react'
import type { ErrorEvent, Map as MapLibreMap } from 'maplibre-gl'
import { registerTileProtocol } from './tileProtocol'

export function useAnalysisTiles(
  mapRef: RefObject<MapLibreMap | null>,
  styleLoaded: boolean,
  analysisId: string | undefined,
  visible: boolean,
  styleRevision = 0,
) {
  const [state, setState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map || !analysisId || !visible) return
    registerTileProtocol()
    setState('loading')
    map.addSource('firebridge-detections', {
      type: 'vector',
      tiles: [`firebridge://tiles/${analysisId}/detections/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 18,
    })
    // Soft heat halo beneath each aggregated cell, then a crisp core coloured by count.
    map.addLayer({
      id: 'firebridge-detections-glow',
      type: 'circle',
      source: 'firebridge-detections',
      'source-layer': 'detections',
      paint: {
        'circle-color': ['interpolate', ['linear'], ['get', 'count'], 1, '#ff9f40', 40, '#ff5f1f', 200, '#d62d0a'],
        'circle-opacity': 0.32,
        'circle-blur': 1,
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 8, 20, 16, 200, 30],
      },
    })
    map.addLayer({
      id: 'firebridge-detections-points',
      type: 'circle',
      source: 'firebridge-detections',
      'source-layer': 'detections',
      paint: {
        'circle-color': ['interpolate', ['linear'], ['get', 'count'], 1, '#ffd28a', 8, '#ffa040', 40, '#ff5f1f', 200, '#d62d0a'],
        'circle-opacity': 0.95,
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 3, 20, 6.5, 200, 12],
        'circle-stroke-width': 0.8,
        'circle-stroke-color': 'rgba(255, 245, 238, 0.85)',
      },
    })
    let failed = false
    let removed = false
    const onRemove = () => {
      removed = true
    }
    const onError = (event: ErrorEvent) => {
      if ((event as { sourceId?: string }).sourceId === 'firebridge-detections') {
        failed = true
        setState('error')
      }
    }
    const onIdle = () => {
      if (
        !failed &&
        map.getSource('firebridge-detections') &&
        map.isSourceLoaded('firebridge-detections')
      )
        setState(
          map.querySourceFeatures('firebridge-detections', { sourceLayer: 'detections' }).length
            ? 'ready'
            : 'empty',
        )
    }
    map.on('error', onError)
    map.on('idle', onIdle)
    map.on('remove', onRemove)
    return () => {
      map.off('error', onError)
      map.off('idle', onIdle)
      map.off('remove', onRemove)
      if (removed) return
      if (map.getLayer('firebridge-detections-points'))
        map.removeLayer('firebridge-detections-points')
      if (map.getLayer('firebridge-detections-glow'))
        map.removeLayer('firebridge-detections-glow')
      if (map.getSource('firebridge-detections')) map.removeSource('firebridge-detections')
    }
  }, [mapRef, analysisId, visible, styleLoaded, styleRevision])
  return state
}
