import { SENSORS, sensorKeyOf, type SensorKey } from '../../lib/sensors'
import { confidenceClass, type ConfidenceClass } from '../bridge/engine/prepare'
import type { DetectionFeature } from '../observations/types'

/** Fixed satellite order: index = the `s` property on every map feature. */
export const ATLAS_SENSORS: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat', 'other']
export const DAY = 86_400_000

export type Instrument = 'all' | 'modis' | 'viirs'
const MODIS = new Set([0, 1])
const VIIRS = new Set([2, 3, 4])
export const isModis = (sensor: number) => MODIS.has(sensor)
export const isViirs = (sensor: number) => VIIRS.has(sensor)
export const sensorsOf = (instrument: Instrument, present: readonly number[]) =>
  instrument === 'modis' ? present.filter(isModis) : instrument === 'viirs' ? present.filter(isViirs) : [...present]

export interface AtlasPoint {
  type: 'Feature'
  id: number
  geometry: { type: 'Point'; coordinates: [number, number] }
  /** i: index · s: satellite · t: time (ms) · f: FRP (MW, −1 when not measured) · m: 1 for MODIS · v: 1 for VIIRS */
  properties: { i: number; s: number; t: number; f: number; m: number; v: number }
}

/** Every native detection of an analysis, sorted by time, in flat arrays. */
export interface AtlasData {
  n: number
  ids: string[]
  t: Float64Array
  lon: Float64Array
  lat: Float64Array
  sensor: Uint8Array
  /** Fire radiative power in MW; NaN when not measured. */
  frp: Float32Array
  confidence: ConfidenceClass[]
  dayNight: (string | null)[]
  sourceIndex: Uint16Array
  sources: string[]
  /** First and exclusive last UTC day of the timeline. */
  firstDay: number
  endDay: number
  /** Detections per UTC day per satellite: daily[sensor][day - firstDay]. */
  daily: Uint32Array[]
  sensorsPresent: number[]
  points: AtlasPoint[]
}

const dayOf = (ms: number) => Math.floor(ms / DAY)
export const isoDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)
export const dayIndex = (iso: string) => dayOf(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`))

export function buildAtlas(features: readonly DetectionFeature[], window?: { start?: string; endExclusive?: string }): AtlasData {
  const rows: { f: DetectionFeature; t: number }[] = []
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates
    const t = Date.parse(f.properties.acquired_at)
    if (Number.isFinite(t) && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) rows.push({ f, t })
  }
  rows.sort((a, b) => a.t - b.t)
  const n = rows.length
  const t = new Float64Array(n)
  const lon = new Float64Array(n)
  const lat = new Float64Array(n)
  const sensor = new Uint8Array(n)
  const frp = new Float32Array(n)
  const sourceIndex = new Uint16Array(n)
  const ids: string[] = new Array(n)
  const confidence: ConfidenceClass[] = new Array(n)
  const dayNight: (string | null)[] = new Array(n)
  const sources: string[] = []
  const lookup = new Map<string, number>()
  const present = new Set<number>()
  const points: AtlasPoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const { f, t: time } = rows[i]
    const p = f.properties
    const [x, y] = f.geometry.coordinates
    t[i] = time
    lon[i] = x
    lat[i] = y
    const s = ATLAS_SENSORS.indexOf(sensorKeyOf(p.platform, p.source_id))
    sensor[i] = s
    present.add(s)
    frp[i] = p.frp_mw === null || !Number.isFinite(p.frp_mw) ? NaN : p.frp_mw
    ids[i] = String(p.detection_id)
    confidence[i] = confidenceClass(p.confidence_raw, p.confidence_scheme)
    dayNight[i] = p.day_night
    let src = lookup.get(p.source_id)
    if (src === undefined) {
      src = sources.push(p.source_id) - 1
      lookup.set(p.source_id, src)
    }
    sourceIndex[i] = src
    points[i] = {
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [x, y] },
      properties: { i, s, t: time, f: Number.isNaN(frp[i]) ? -1 : frp[i], m: isModis(s) ? 1 : 0, v: isViirs(s) ? 1 : 0 },
    }
  }
  const firstDay = window?.start ? dayIndex(window.start) : n ? dayOf(t[0]) : dayOf(Date.now())
  const lastDetectionDay = n ? dayOf(t[n - 1]) + 1 : firstDay + 1
  const endDay = Math.max(firstDay + 1, window?.endExclusive ? dayIndex(window.endExclusive) : lastDetectionDay, lastDetectionDay)
  const span = endDay - firstDay
  const daily = ATLAS_SENSORS.map(() => new Uint32Array(span))
  for (let i = 0; i < n; i++) {
    const d = dayOf(t[i]) - firstDay
    if (d >= 0 && d < span) daily[sensor[i]][d]++
  }
  return { n, ids, t, lon, lat, sensor, frp, confidence, dayNight, sourceIndex, sources, firstDay, endDay, daily, sensorsPresent: [...present].sort((a, b) => a - b), points }
}

/** First index whose time is at or after `ms` (the arrays are sorted by time). */
export function lowerBound(t: Float64Array, ms: number) {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (t[mid] < ms) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface AtlasFilter {
  startDay: number
  endDay: number
  sensors: readonly number[]
  /** One source stream (index into `sources`), or null for all. */
  source: number | null
}

/** Indices of the detections a filter keeps, in time order. */
export function selectIndices(data: AtlasData, filter: AtlasFilter): number[] {
  const active = new Uint8Array(ATLAS_SENSORS.length)
  for (const s of filter.sensors) active[s] = 1
  const out: number[] = []
  const hi = lowerBound(data.t, filter.endDay * DAY)
  for (let i = lowerBound(data.t, filter.startDay * DAY); i < hi; i++)
    if (active[data.sensor[i]] && (filter.source === null || data.sourceIndex[i] === filter.source)) out.push(i)
  return out
}

export interface Summary {
  count: number
  bySensor: number[]
  modis: number
  viirs: number
  fireDays: number
  first: number | null
  last: number | null
  maxFrp: number | null
  /** Detections per calendar year, oldest first. */
  years: { year: number; count: number }[]
  bounds: [number, number, number, number] | null
}

/** What a set of detections amounts to, in terms a reader can check. */
export function summarize(data: AtlasData, indices: readonly number[]): Summary {
  const bySensor = ATLAS_SENSORS.map(() => 0)
  const years = new Map<number, number>()
  let fireDays = 0
  let lastDay = -1
  let maxFrp: number | null = null
  let bounds: [number, number, number, number] | null = null
  let first: number | null = null
  let last: number | null = null
  const sorted = [...indices].sort((a, b) => a - b)
  for (const i of sorted) {
    bySensor[data.sensor[i]]++
    const day = dayOf(data.t[i])
    if (day !== lastDay) {
      fireDays++
      lastDay = day
    }
    const year = new Date(data.t[i]).getUTCFullYear()
    years.set(year, (years.get(year) ?? 0) + 1)
    const f = data.frp[i]
    if (!Number.isNaN(f)) maxFrp = Math.max(maxFrp ?? 0, f)
    const x = data.lon[i]
    const y = data.lat[i]
    bounds = bounds ? [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)] : [x, y, x, y]
    first ??= data.t[i]
    last = data.t[i]
  }
  const yearList = [...years.keys()].sort((a, b) => a - b)
  const span = yearList.length ? Array.from({ length: yearList[yearList.length - 1] - yearList[0] + 1 }, (_, k) => yearList[0] + k) : []
  return {
    count: sorted.length,
    bySensor,
    modis: bySensor.reduce((sum, n, s) => sum + (isModis(s) ? n : 0), 0),
    viirs: bySensor.reduce((sum, n, s) => sum + (isViirs(s) ? n : 0), 0),
    fireDays,
    first,
    last,
    maxFrp,
    years: span.map((year) => ({ year, count: years.get(year) ?? 0 })),
    bounds,
  }
}

export const sensorLabelOf = (index: number) => SENSORS[ATLAS_SENSORS[index]].label
export const sensorColorOf = (index: number) => SENSORS[ATLAS_SENSORS[index]].color

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const fmtDay = (day: number) => dayFormat.format(day * DAY)

/** "12–18 Jul 2022", "July 2022", "1 Jan 2018 – 8 Nov 2026". */
export function fmtSpan(startDay: number, endDay: number) {
  const last = endDay - 1
  if (last <= startDay) return fmtDay(startDay)
  const a = new Date(startDay * DAY)
  const b = new Date(last * DAY)
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth()
  if (sameMonth && a.getUTCDate() === 1 && new Date(endDay * DAY).getUTCDate() === 1) return monthFormat.format(a)
  if (sameMonth) return `${a.getUTCDate()}–${dayFormat.format(b)}`
  return `${dayFormat.format(a)} – ${dayFormat.format(b)}`
}

export function fmtCoord(lon: number, lat: number) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
}
