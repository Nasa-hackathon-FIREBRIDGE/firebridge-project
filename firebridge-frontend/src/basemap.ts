import type { StyleSpecification } from 'maplibre-gl'
import { cachedImagery } from './features/maps/imageryCache'

export const NO_BASEMAP_REASON = 'Offline coordinate grid selected. No background imagery is requested.'
export const NASA_SOURCE_ID = 'firebridge-nasa-imagery'
export const NASA_ATTRIBUTION = '<a href="https://earthobservatory.nasa.gov/features/BlueMarble">NASA Blue Marble</a> / <a href="https://nasa-gibs.github.io/gibs-api-docs/">NASA GIBS</a>'
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
const gibs = (layer: string, level: number, extension: string) => cachedImagery(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${extension}`)

export type BasemapSelection = { label: string; description: string; sourceId?: string } & (
  | { kind: 'schematic'; key: string; reason: string }
  | { kind: 'style-url'; key: string; url: string }
  | { kind: 'raster'; key: string; style: StyleSpecification }
)
export type BasemapChoice = 'satellite' | 'hybrid' | 'streets' | 'relief' | 'configured' | 'schematic'

export function nasaStyle(hybrid = false, relief = false): StyleSpecification {
  const style: StyleSpecification = { version: 8, sources: { [NASA_SOURCE_ID]: {
    type: 'raster', tiles: [gibs(relief ? 'BlueMarble_ShadedRelief_Bathymetry' : 'BlueMarble_NextGeneration', 8, 'jpeg')],
    tileSize: 256, maxzoom: 8, attribution: NASA_ATTRIBUTION,
  } }, layers: [{ id: 'firebridge-background', type: 'background', paint: { 'background-color': '#060c19' } }, { id: 'firebridge-satellite', type: 'raster', source: NASA_SOURCE_ID }] }
  if (hybrid) {
    for (const [id, product] of [['reference-features', 'Reference_Features_15m'], ['reference-labels', 'Reference_Labels_15m']]) {
      style.sources[id] = { type: 'raster', tiles: [gibs(product, 13, 'png')], tileSize: 256, maxzoom: 13, attribution: OSM_ATTRIBUTION }
      style.layers.push({ id, type: 'raster', source: id })
    }
  }
  return style
}

/** Configured styles win; otherwise use NASA's public archival satellite composite. Only open imagery
 *  is offered (NASA GIBS, OpenStreetMap): proprietary providers such as Esri were removed on purpose. */
export function resolveBasemap(styleUrl: string | undefined, provider: string | undefined): BasemapSelection {
  const url = (styleUrl ?? '').trim()
  if (url) return { kind: 'style-url', key: `style:${url}`, url, label: 'Configured basemap', description: 'Provider-configured style. Imagery acquisition dates are not supplied by FIREBRIDGE.' }
  const id = (provider ?? '').trim().toLowerCase()
  if (id === 'schematic') return { kind: 'schematic', key: 'none', reason: NO_BASEMAP_REASON, label: 'Offline grid', description: 'Coordinate reference only; not satellite imagery.' }
  if (id && id !== 'nasa-gibs') return { kind: 'schematic', key: `invalid:${id}`, reason: 'The configured map provider is not supported. Choose an available basemap below.', label: 'Provider unavailable', description: 'Correct the provider configuration or select NASA satellite imagery.' }
  return { kind: 'raster', key: 'nasa-satellite', style: nasaStyle(), sourceId: NASA_SOURCE_ID, label: 'NASA satellite', description: 'Blue Marble archival composite · native zoom 8 · dates vary; independent of detection timestamps.' }
}

export function selectBasemap(choice: BasemapChoice, configured: BasemapSelection): BasemapSelection {
  if (choice === 'configured') return configured
  if (choice === 'schematic') return resolveBasemap('', 'schematic')
  if (choice === 'satellite') return resolveBasemap('', 'nasa-gibs')
  if (choice === 'streets') return { kind: 'raster', key: 'osm-streets', label: 'OpenStreetMap streets', description: 'Street map · © OpenStreetMap contributors · best-effort public service.', sourceId: 'firebridge-streets', style: { version: 8, sources: { 'firebridge-streets': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIBUTION } }, layers: [{ id: 'firebridge-streets', type: 'raster', source: 'firebridge-streets' }] } }
  return { kind: 'raster', key: `nasa-${choice}`, style: nasaStyle(choice === 'hybrid', choice === 'relief'), sourceId: NASA_SOURCE_ID, label: choice === 'hybrid' ? 'Satellite + labels' : 'NASA shaded relief', description: choice === 'hybrid' ? 'NASA archival satellite composite + OSM reference labels. Independent of detection dates.' : 'NASA shaded relief and bathymetry · contextual raster, not a 3D elevation model.' }
}

export function envBasemapConfig(): { styleUrl: string; provider: string } {
  const env = import.meta.env as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return { styleUrl: text(env.VITE_MAP_STYLE_URL), provider: text(env.VITE_BASEMAP_PROVIDER) }
}
