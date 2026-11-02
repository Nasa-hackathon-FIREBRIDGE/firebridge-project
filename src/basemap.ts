import type { StyleSpecification } from 'maplibre-gl'

export const ESRI_PROVIDER_ID = 'esri-world-imagery'
export const ESRI_SOURCE_ID = 'astra-esri-world-imagery'
export const ESRI_ATTRIBUTION = 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'
const ESRI_TILE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export const NO_BASEMAP_REASON = 'No basemap style is configured (VITE_MAP_STYLE_URL is not set).'

export type BasemapSelection =
  | { kind: 'schematic'; key: string; reason: string }
  | { kind: 'style-url'; key: string; url: string }
  | { kind: 'esri'; key: string; style: StyleSpecification }

export function esriStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { [ESRI_SOURCE_ID]: { type: 'raster', tiles: [ESRI_TILE_URL], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTRIBUTION } },
    layers: [
      { id: 'astra-basemap-background', type: 'background', paint: { 'background-color': '#101b26' } },
      { id: 'astra-esri-world-imagery', type: 'raster', source: ESRI_SOURCE_ID },
    ],
  }
}

/**
 * Precedence: an explicit VITE_MAP_STYLE_URL wins; otherwise VITE_BASEMAP_PROVIDER selects a built-in
 * provider; otherwise the offline schematic is used and no external request is made.
 */
export function resolveBasemap(styleUrl: string | undefined, provider: string | undefined): BasemapSelection {
  const url = (styleUrl ?? '').trim()
  if (url) return { kind: 'style-url', key: `style:${url}`, url }
  const id = (provider ?? '').trim().toLowerCase()
  if (id === ESRI_PROVIDER_ID) return { kind: 'esri', key: `provider:${id}`, style: esriStyle() }
  if (id) return { kind: 'schematic', key: `invalid:${id}`, reason: `VITE_BASEMAP_PROVIDER "${id}" is not supported (supported: ${ESRI_PROVIDER_ID}), and VITE_MAP_STYLE_URL is not set.` }
  return { kind: 'schematic', key: 'none', reason: NO_BASEMAP_REASON }
}

export function envBasemapConfig(): { styleUrl: string; provider: string } {
  const env = import.meta.env as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return { styleUrl: text(env.VITE_MAP_STYLE_URL), provider: text(env.VITE_BASEMAP_PROVIDER) }
}
