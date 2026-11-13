import { areaKm2, boundsOf, centreOf, type AreaGeometry } from './geo'

/** Levels a country can be divided into, as the picker names them. */
export type PlaceLevel = 'region' | 'province' | 'forest'

export interface PlaceProps {
  id: string
  name: string
  level: PlaceLevel | 'country'
  kind?: string
  iso3: string
  area_km2: number
  source: string
  source_id: string
}
export type PlaceFeature = GeoJSON.Feature<AreaGeometry, PlaceProps>

export interface CountryProps {
  id: string
  iso3: string | null
  name: string
  name_fr?: string
  name_ar?: string
  area_km2: number
  regions: number
  provinces: number
  /** IANA zones with their reference point: [zone, latitude, longitude]. */
  zones: [string, number, number][]
}
export type CountryFeature = GeoJSON.Feature<AreaGeometry, CountryProps>

export interface PlacesIndex {
  countries: Record<string, { regions?: number; provinces?: number; forests?: number; prepared: string }>
  geoboundaries: string
}

const BASE = `${import.meta.env.BASE_URL}places`
const GB_COMMIT = '9469f09592ced973a3448cf66b6100b741b64c0d'
const ADM = { country: 'ADM0', region: 'ADM1', province: 'ADM2' } as const
const FILE = { country: 'country', region: 'regions', province: 'provinces', forest: 'forests' } as const

/** geoBoundaries gbOpen, pinned to one release so a boundary never changes under a saved area. */
export const geoBoundariesUrl = (iso3: string, adm: string) =>
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${GB_COMMIT}/releaseData/gbOpen/${iso3}/${adm}/geoBoundaries-${iso3}-${adm}_simplified.geojson`

export const COUNTRY_ATTRIBUTION = '<a href="https://www.naturalearthdata.com/">Natural Earth</a>'
export const BOUNDARY_ATTRIBUTION =
  '<a href="https://www.geoboundaries.org/">geoBoundaries</a> (ODbL) · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'

const cache = new Map<string, Promise<unknown>>()

/** JSON from a URL, once per session; null when the file does not exist. */
function load<T>(url: string): Promise<T | null> {
  let pending = cache.get(url) as Promise<T | null> | undefined
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Boundaries could not be loaded (${response.status}).`)
      return (await response.json()) as T
    })
    pending.catch(() => cache.delete(url))
    cache.set(url, pending)
  }
  return pending
}

export const loadCountries = async () => (await load<GeoJSON.FeatureCollection<AreaGeometry, CountryProps>>(`${BASE}/countries.json`))?.features ?? []

const isArea = (geometry: GeoJSON.Geometry | null): geometry is AreaGeometry => geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'

/**
 * The places of one level in a country: the prepared file when the country is prepared, otherwise
 * regions and provinces straight from geoBoundaries. Null when the country has none at that level
 * (or, for forests, has not been prepared yet).
 */
export async function loadPlaces(iso3: string, level: PlaceLevel | 'country'): Promise<PlaceFeature[] | null> {
  const index = await load<PlacesIndex>(`${BASE}/index.json`)
  if (index?.countries[iso3]) {
    const prepared = await load<GeoJSON.FeatureCollection<AreaGeometry, PlaceProps>>(`${BASE}/${iso3}/${FILE[level]}.json`)
    if (prepared) return prepared.features
  }
  if (level === 'forest') return null
  const adm = ADM[level]
  const published = await load<GeoJSON.FeatureCollection>(geoBoundariesUrl(iso3, adm))
  if (!published) return null
  return published.features.flatMap((feature) => {
    if (!isArea(feature.geometry)) return []
    const id = String(feature.properties?.shapeID ?? '')
    return [{
      type: 'Feature' as const,
      geometry: feature.geometry,
      properties: {
        id: `gb-${id}`,
        name: String(feature.properties?.shapeName ?? 'Unnamed'),
        level,
        iso3,
        area_km2: Math.round(areaKm2(feature.geometry)),
        source: `geoBoundaries gbOpen ${iso3} ${adm} (ODbL 1.0)`,
        source_id: id,
      },
    }]
  })
}

/** The country's time zone nearest to a place, for displaying its dates. */
export function zoneFor(country: CountryProps, geometry: AreaGeometry): string {
  if (!country.zones.length) return 'UTC'
  const [lon, lat] = centreOf(boundsOf(geometry))
  let best = country.zones[0]
  for (const zone of country.zones) if (Math.hypot(zone[1] - lat, zone[2] - lon) < Math.hypot(best[1] - lat, best[2] - lon)) best = zone
  return best[0]
}

const KIND_LABELS: Record<string, string> = { 'national park': 'National park', 'nature reserve': 'Nature reserve', forest: 'Forest', wood: 'Woodland', 'protected area': 'Protected area' }

/** "Region of Morocco", "National park · Morocco". */
export function describe(place: PlaceProps, country: string): string {
  if (place.level === 'country') return 'The whole country'
  if (place.level === 'forest') return `${KIND_LABELS[place.kind ?? ''] ?? 'Forest'} · ${country}`
  return `${place.level === 'region' ? 'Region' : 'Province'} of ${country}`
}

export const fmtKm2 = (value: number) => `${Math.round(value).toLocaleString('en-US')} km²`

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Names that contain the query, ignoring case and accents; names that start with it come first. */
export function search<T>(items: T[], query: string, names: (item: T) => (string | null | undefined)[], limit = 6): T[] {
  const q = fold(query.trim())
  if (!q) return []
  const scored: [T, number][] = []
  for (const item of items) {
    const best = Math.min(...names(item).map((name) => {
      if (!name) return Infinity
      const at = fold(name).indexOf(q)
      return at < 0 ? Infinity : at === 0 ? 0 : 1
    }))
    if (best < Infinity) scored.push([item, best])
  }
  return scored.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([item]) => item)
}
