/** Plain-language descriptions of catalogue entries. Pure functions: no fetching, no React. */
import { SENSORS, sensorKeyOf, type SensorKey } from '../../lib/sensors'
import type { CatalogSource } from '../../services/catalog.service'
import type { Detail } from '../../services/data.types'

/** What each published release alias selects, as defined by the data pipeline's publication policy. */
export const ALIAS_INFO: Record<string, { title: string; text: string }> = {
  standard_only: {
    title: 'Standard quality',
    text: 'Only standard-quality records. Provisional near-real-time records are never mixed in.',
  },
  best_available: {
    title: 'Best available',
    text: 'Standard records wherever they exist; otherwise the provisional near-real-time ones, decided per satellite and day.',
  },
  historical_archive: {
    title: 'Historical archive',
    text: 'The catalogue of the audited worldwide FIRMS archive. Each analysis is cut from it on demand, for its own area and period.',
  },
}

export function releaseTitle(name: string, alias?: string): string {
  return (alias && ALIAS_INFO[alias]?.title) || name
}

const ORDER: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat', 'other']

export interface SatelliteGroup {
  key: SensorKey
  label: string
  instrument: string
  color: string
  pixel: string
  streams: CatalogSource[]
}

/** Group source streams by satellite, in launch order. Raw provider files are matched by product name. */
export function groupSources(sources: CatalogSource[]): SatelliteGroup[] {
  const groups = new Map<SensorKey, CatalogSource[]>()
  for (const source of sources) {
    const key = sensorKeyOf(source.platform, source.product, source.source_id)
    groups.set(key, [...(groups.get(key) ?? []), source])
  }
  return ORDER.filter((key) => groups.has(key)).map((key) => {
    const meta = SENSORS[key]
    const streams = groups.get(key)!.sort((a, b) => Number(isRaw(a)) - Number(isRaw(b)) || b.collection.localeCompare(a.collection))
    return { key, label: meta.label, instrument: streams.find((s) => s.instrument)?.instrument ?? meta.instrument, color: meta.color, pixel: meta.pixel, streams }
  })
}

export const isRaw = (source: CatalogSource) => source.source_id.startsWith('raw-') || source.collection === 'provider-native'

/** "61" → "Collection 6.1"; raw provider files are named as such. */
export function streamTitle(source: CatalogSource): string {
  if (isRaw(source)) return 'Raw FIRMS files'
  const collection = /^\d\d$/.test(source.collection) ? `${source.collection[0]}.${source.collection[1]}` : source.collection
  return `Collection ${collection}`
}

export function streamDetail(source: CatalogSource): string {
  const processing = source.processing_stream === 'standard' ? 'standard processing' : source.processing_stream === 'nrt' ? 'near-real-time' : source.processing_stream
  return isRaw(source) ? `${source.product} files from FIRMS` : processing
}

export function availabilityLabel(status: string | null | undefined): string {
  if (!status || status === 'unknown') return 'Availability not yet reported'
  return status.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.valueOf()) ? '—' : DATE.format(date)
}

/** Release cutoffs and interval ends are exclusive: the last day covered is the day before. */
export function lastDayBefore(iso: string | null | undefined): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '—' : DATE.format(new Date(time - 86_400_000))
}

export function formatCount(value: unknown): string {
  const number = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—'
}

export function formatBytes(value: unknown): string {
  const bytes = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(bytes)) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} kB`
  return `${bytes} B`
}

/** "detections:viirs-noaa20-c2-standard:global" → "viirs-noaa20-c2-standard". */
export function seriesSource(seriesKey: unknown): string {
  return typeof seriesKey === 'string' ? seriesKey.split(':')[1] ?? seriesKey : ''
}

/** One sentence per release revision record. */
export function describeChange(change: Detail): string {
  const reason = typeof change.reason === 'string' ? change.reason.replaceAll('_', ' ') : 'change'
  const count = typeof change.revision_records === 'number' ? change.revision_records : null
  const interval = change.affected_interval as { start?: string; end_exclusive?: string } | undefined
  const span = interval?.start ? ` covering ${formatDate(interval.start)} to ${lastDayBefore(interval.end_exclusive)}` : ''
  const records = count === null ? '' : `, ${count} revision record${count === 1 ? '' : 's'}`
  return `${reason.replace(/^\w/, (c) => c.toUpperCase())}${records}${span}.`
}
