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
    map.addLayer({
      id: 'firebridge-detections-points',
      type: 'circle',
      source: 'firebridge-detections',
      'source-layer': 'detections',
      paint: {
        'circle-color': '#f0a767',
        'circle-opacity': 0.9,
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 3, 100, 10],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff2de',
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
      if (map.getSource('firebridge-detections')) map.removeSource('firebridge-detections')
    }
  }, [mapRef, analysisId, visible, styleLoaded, styleRevision])
  return state
}
