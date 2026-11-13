import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { boundsOf, type AreaGeometry } from './geo'
import { BOUNDARY_ATTRIBUTION, COUNTRY_ATTRIBUTION, loadCountries, loadPlaces, type CountryFeature, type CountryProps, type PlaceFeature, type PlaceLevel } from './places'

/** 'unprepared': forests exist only for countries the preparation script has run for. */
export type PlacesStatus = 'idle' | 'loading' | 'ready' | 'none' | 'unprepared' | 'error'

export interface PlaceHover {
  name: string
  area?: number
  country: boolean
  x: number
  y: number
}

export interface PlacePicker {
  countries: CountryFeature[]
  countriesStatus: PlacesStatus
  country: CountryFeature | null
  level: PlaceLevel | 'country'
  places: PlaceFeature[]
  status: PlacesStatus
  selected: PlaceFeature | null
  hover: PlaceHover | null
  chooseCountry: (country: CountryFeature | null) => void
  chooseLevel: (level: PlaceLevel | 'country') => void
  select: (place: PlaceFeature, fly?: boolean) => void
  retry: () => void
}

const COUNTRIES = 'places-countries'
const UNITS = 'places-units'
const LAYERS = ['places-country-fill', 'places-country-line', 'places-unit-fill', 'places-unit-glow', 'places-unit-line'] as const
const hover: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const NO_COUNTRIES: CountryFeature[] = []
const NO_PLACES: PlaceFeature[] = []
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Natural first level to show for a country: its regions, else its provinces, else its forests. */
const firstLevel = (country: CountryProps): PlaceLevel => (country.regions ? 'region' : country.provinces ? 'province' : 'forest')

/**
 * Choosing a zone by clicking the map: countries glow faintly; a click opens one and shows its
 * regions, provinces or forests; a click on one of them selects it.
 */
export function usePlacePicker(mapRef: RefObject<MapLibreMap | null>, styleLoaded: boolean, styleRevision: number, active: boolean): PlacePicker {
  const [countryList, setCountryList] = useState<{ attempt: number; list: CountryFeature[]; failed: boolean } | null>(null)
  const [country, setCountry] = useState<CountryFeature | null>(null)
  const [level, setLevel] = useState<PlaceLevel | 'country'>('region')
  // Each answer remembers the request it answers; any other request is still loading.
  const [result, setResult] = useState<{ key: string; places: PlaceFeature[]; status: PlacesStatus } | null>(null)
  const [selectedPlace, setSelected] = useState<PlaceFeature | null>(null)
  const [hoverState, setHover] = useState<PlaceHover | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Frames a place above the picker bar, which covers the lower part of the map.
  const fly = useCallback((geometry: AreaGeometry, padding = 48) => {
    const map = mapRef.current
    if (!map) return
    const [w, s, e, n] = boundsOf(geometry)
    const height = map.getContainer?.().clientHeight || 600
    map.fitBounds([[w, s], [e, n]], { padding: { top: padding + 16, right: padding + 24, left: padding, bottom: Math.round(Math.min(280, height * 0.48)) }, maxZoom: 11, duration: reducedMotion() ? 0 : 900 })
  }, [mapRef])

  // At world level the countries must be visible: the map steps back to a continental view.
  const zoomOut = useCallback(() => {
    const map = mapRef.current
    if (map && map.getZoom() > 3) map.easeTo({ zoom: 2.6, duration: reducedMotion() ? 0 : 800 })
  }, [mapRef])

  const chooseCountry = useCallback((next: CountryFeature | null) => {
    setCountry(next)
    setSelected(null)
    if (next) {
      setLevel(firstLevel(next.properties))
      fly(next.geometry)
    } else zoomOut()
  }, [fly, zoomOut])

  const select = useCallback((place: PlaceFeature, flyTo = true) => {
    setSelected(place)
    if (flyTo) fly(place.geometry, 64)
  }, [fly])

  // Each level is seen across the whole country, whatever was zoomed into before.
  const chooseLevel = useCallback((next: PlaceLevel | 'country') => {
    setLevel(next)
    setSelected(null)
    if (country) fly(country.geometry)
  }, [country, fly])

  // Countries are loaded the first time the picker opens, and again on "Try again" after a failure.
  const countriesLoaded = !!countryList && !countryList.failed
  const countriesFailedNow = countryList?.failed && countryList.attempt === attempt
  useEffect(() => {
    if (!active || countriesLoaded || countriesFailedNow) return
    let cancelled = false
    loadCountries()
      .then((list) => !cancelled && setCountryList({ attempt, list: list.filter((c) => c.properties.iso3), failed: false }))
      .catch(() => !cancelled && setCountryList({ attempt, list: [], failed: true }))
    return () => {
      cancelled = true
    }
  }, [active, attempt, countriesLoaded, countriesFailedNow])
  const countries = countryList?.list ?? NO_COUNTRIES
  const countriesStatus: PlacesStatus = countriesLoaded ? 'ready' : countriesFailedNow ? 'error' : active || countryList ? 'loading' : 'idle'

  const iso3 = country?.properties.iso3
  const key = active && iso3 ? `${iso3}|${level}|${attempt}` : null
  useEffect(() => {
    if (!key || !iso3) return
    let cancelled = false
    loadPlaces(iso3, level)
      .then((list) => {
        if (cancelled) return
        setResult({ key, places: list ?? [], status: list?.length ? 'ready' : list === null && level === 'forest' ? 'unprepared' : 'none' })
        // The whole country is a single place: it is selected as soon as it arrives.
        if (level === 'country' && list?.length) setSelected(list[0])
      })
      .catch(() => !cancelled && setResult({ key, places: [], status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [key, iso3, level])
  const current = result && result.key === key ? result : null
  const places = current?.places ?? NO_PLACES
  const status: PlacesStatus = !key ? 'idle' : current ? current.status : 'loading'

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  const opened = active && styleLoaded
  const wasOpen = useRef(false)
  useEffect(() => {
    if (opened && !wasOpen.current && !country) zoomOut()
    wasOpen.current = opened
  }, [opened, country, zoomOut])

  // ── map layers ────────────────────────────────────────────────────────────
  const latest = useRef({ countries, country, places, chooseCountry, select })
  useEffect(() => {
    latest.current = { countries, country, places, chooseCountry, select }
  })
  const hovered = useRef<{ source: string; id: string } | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoaded || !active) return
    const before = ['astra-study-area-fill', 'atlas-glow'].find((id) => map.getLayer(id))
    // Outlines read best on darker imagery; the atlas dims it the same way.
    const rasters = (map.getStyle?.()?.layers ?? []).filter((layer) => layer.type === 'raster').map((layer) => layer.id)
    for (const id of rasters) {
      map.setPaintProperty(id, 'raster-brightness-max', 0.62)
      map.setPaintProperty(id, 'raster-saturation', -0.35)
    }
    // Credits appear in the map's attribution corner while the picker is open.
    map.addSource(COUNTRIES, { type: 'geojson', data: empty, promoteId: 'id', attribution: COUNTRY_ATTRIBUTION })
    map.addSource(UNITS, { type: 'geojson', data: empty, promoteId: 'id', attribution: BOUNDARY_ATTRIBUTION })
    map.addLayer({ id: 'places-country-fill', type: 'fill', source: COUNTRIES, paint: { 'fill-color': '#ff7c40', 'fill-opacity': ['case', hover, 0.08, 0.001] } }, before)
    map.addLayer({
      id: 'places-country-line', type: 'line', source: COUNTRIES,
      paint: { 'line-color': ['case', hover, '#ffb27a', 'rgba(255, 236, 222, 0.42)'], 'line-width': ['case', hover, 1.6, 0.7] },
    }, before)
    map.addLayer({ id: 'places-unit-fill', type: 'fill', source: UNITS, paint: { 'fill-color': '#ff7c40', 'fill-opacity': ['case', selected, 0.26, hover, 0.16, 0.04] } }, before)
    map.addLayer({ id: 'places-unit-glow', type: 'line', source: UNITS, paint: { 'line-color': '#ff7c40', 'line-width': 9, 'line-blur': 7, 'line-opacity': ['case', selected, 0.6, 0] } }, before)
    map.addLayer({
      id: 'places-unit-line', type: 'line', source: UNITS,
      paint: { 'line-color': ['case', selected, '#ffe2b8', hover, '#ffb27a', 'rgba(255, 214, 170, 0.6)'], 'line-width': ['case', selected, 2.2, hover, 1.6, 0.9] },
    }, before)

    const setHovered = (next: { source: string; id: string } | null) => {
      const previous = hovered.current
      if (previous && (previous.id !== next?.id || previous.source !== next.source) && map.getSource(previous.source)) map.setFeatureState(previous, { hover: false })
      if (next) map.setFeatureState(next, { hover: true })
      hovered.current = next
    }
    const hit = (event: MapMouseEvent) => {
      const layers = ['places-unit-fill', 'places-country-fill'].filter((id) => map.getLayer(id))
      return typeof map.queryRenderedFeatures === 'function' ? map.queryRenderedFeatures(event.point, { layers })[0] : undefined
    }
    let frame = 0
    let pending: MapMouseEvent | null = null
    const flush = () => {
      frame = 0
      if (!pending) return
      const event = pending
      pending = null
      const feature = hit(event)
      const id = feature?.id === undefined ? null : String(feature.id)
      const unit = feature?.source === UNITS
      setHovered(id ? { source: unit ? UNITS : COUNTRIES, id } : null)
      map.getCanvas().style.cursor = id ? 'pointer' : ''
      if (!id || !feature) return setHover(null)
      const { places: list, countries: all } = latest.current
      const place = unit ? list.find((p) => p.properties.id === id) : all.find((c) => c.properties.id === id)
      setHover(place ? { name: place.properties.name, area: unit ? place.properties.area_km2 : undefined, country: !unit, x: event.point.x, y: event.point.y } : null)
    }
    const move = (event: MapMouseEvent) => {
      pending = event
      if (!frame) frame = requestAnimationFrame(flush)
    }
    const out = () => {
      pending = null
      setHovered(null)
      setHover(null)
    }
    const click = (event: MapMouseEvent) => {
      const feature = hit(event)
      if (!feature || feature.id === undefined) return
      const id = String(feature.id)
      const { places: list, countries: all, country: current } = latest.current
      if (feature.source === UNITS) {
        const place = list.find((p) => p.properties.id === id)
        if (place) latest.current.select(place, false)
        return
      }
      const next = all.find((c) => c.properties.id === id)
      if (next && next.properties.id !== current?.properties.id) latest.current.chooseCountry(next)
    }
    let removed = false
    const onRemove = () => {
      removed = true
    }
    map.on('mousemove', move)
    map.on('mouseout', out)
    map.on('click', click)
    map.on('remove', onRemove)
    // A double click would zoom while choosing.
    const doubleClick = map.doubleClickZoom
    doubleClick?.disable?.()
    return () => {
      cancelAnimationFrame(frame)
      map.off('mousemove', move)
      map.off('mouseout', out)
      map.off('click', click)
      map.off('remove', onRemove)
      hovered.current = null
      setHover(null)
      if (removed) return
      doubleClick?.enable?.()
      map.getCanvas().style.cursor = ''
      for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of [UNITS, COUNTRIES]) if (map.getSource(id)) map.removeSource(id)
      // The atlas keeps the imagery dimmed while it is on.
      if (!map.getLayer('atlas-core')) for (const id of rasters) {
        if (!map.getLayer(id)) continue
        map.setPaintProperty(id, 'raster-brightness-max', 1)
        map.setPaintProperty(id, 'raster-saturation', 0)
      }
    }
  }, [mapRef, styleLoaded, styleRevision, active])

  useEffect(() => {
    const source = mapRef.current?.getSource(COUNTRIES) as GeoJSONSource | undefined
    source?.setData({ type: 'FeatureCollection', features: countries })
  }, [mapRef, styleLoaded, styleRevision, active, countries])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource(UNITS) as GeoJSONSource | undefined
    // A whole country is drawn as the selection itself.
    source?.setData({ type: 'FeatureCollection', features: level === 'country' ? (selectedPlace ? [selectedPlace] : []) : places })
    if (!map?.getLayer('places-unit-fill')) return
    // Forests read as forests: a sage tint, with the same ember highlight when chosen.
    const forest = level === 'forest'
    map.setPaintProperty('places-unit-fill', 'fill-color', ['case', selected, '#ff7c40', forest ? '#8fd08f' : '#ff7c40'])
    map.setPaintProperty('places-unit-line', 'line-color', ['case', selected, '#ffe2b8', hover, '#ffb27a', forest ? 'rgba(170, 225, 170, 0.8)' : 'rgba(255, 214, 170, 0.6)'])
  }, [mapRef, styleLoaded, styleRevision, active, places, level, selectedPlace])

  // The open country steps back: its neighbours stay clickable but quiet.
  const countryId = country?.properties.id
  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer('places-country-line')) return
    map.setPaintProperty('places-country-line', 'line-opacity', countryId ? 0.4 : 1)
    map.setFilter('places-country-fill', countryId ? ['!=', ['get', 'id'], countryId] : null)
  }, [mapRef, styleLoaded, styleRevision, active, countryId, countries])

  const selectedId = selectedPlace?.properties.id
  useEffect(() => {
    const map = mapRef.current
    if (!selectedId || !map?.getSource(UNITS)) return
    map.setFeatureState({ source: UNITS, id: selectedId }, { selected: true })
    return () => {
      if (map.getSource(UNITS)) map.setFeatureState({ source: UNITS, id: selectedId }, { selected: false })
    }
  }, [mapRef, styleLoaded, styleRevision, active, selectedId])

  return {
    countries, countriesStatus, country, level, places, status, selected: selectedPlace, hover: hoverState,
    chooseCountry, chooseLevel, select, retry,
  }
}
