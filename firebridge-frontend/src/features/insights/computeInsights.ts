import { SENSORS, sensorKeyOf, type SensorKey } from '../../lib/sensors'
import type { NativeCalendar, NativeSummary } from '../observations/types'

export interface SensorTotal {
  key: SensorKey
  label: string
  instrument: string
  color: string
  pixel: string
  count: number | null
  sourceIds: string[]
}

export interface DayCell {
  date: string // YYYY-MM-DD
  start: string
  endExclusive: string
  /** Detections of every satellite with a known count that day; null when none is known. */
  total: number | null
  bySensor: Partial<Record<SensorKey, number>>
  /** Satellites expected that day (inside their own inventoried span) whose count is unknown:
   *  the total is then a lower bound. */
  missing: SensorKey[]
}

export interface MonthBucket {
  month: string // YYYY-MM
  total: number
  bySensor: Partial<Record<SensorKey, number>>
}

export interface Insights {
  total: number | null
  lowerBound: boolean
  sensors: SensorTotal[]
  modis: number
  viirs: number
  ratio: number | null
  resolution: string
  periods: DayCell[]
  months: MonthBucket[]
  activePeriods: number
  knownPeriods: number
  peakPeriod: DayCell | null
  peakMonth: MonthBucket | null
  bothInstrumentPeriods: number
  topMonthsShare: number | null
}

const toNumber = (value: string | null | undefined) => (value != null && /^\d+$/.test(value) ? Number(value) : null)

export function computeInsights(summary?: NativeSummary, calendar?: NativeCalendar): Insights {
  const sourceSensor = new Map<string, SensorKey>()
  const sensorMap = new Map<SensorKey, SensorTotal>()
  let total: number | null = 0
  let lowerBound = false

  for (const source of summary?.native_detections_by_source ?? []) {
    const key = sensorKeyOf(source.platform, source.product, source.source_id)
    sourceSensor.set(source.source_id, key)
    const count = source.count_status === 'unknown' ? null : toNumber(source.count)
    if (source.count_status === 'lower_bound') lowerBound = true
    const meta = SENSORS[key]
    const entry = sensorMap.get(key) ?? { key, label: meta.label, instrument: meta.instrument, color: meta.color, pixel: meta.pixel, count: 0, sourceIds: [] }
    entry.sourceIds.push(source.source_id)
    entry.count = entry.count === null || count === null ? null : entry.count + count
    sensorMap.set(key, entry)
    total = total === null || count === null ? null : total + count
  }
  if (!summary) total = null

  const order: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat', 'other']
  const sensors = [...sensorMap.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  const modis = sensors.filter((s) => s.instrument === 'MODIS').reduce((sum, s) => sum + (s.count ?? 0), 0)
  const viirs = sensors.filter((s) => s.instrument === 'VIIRS').reduce((sum, s) => sum + (s.count ?? 0), 0)

  // Availability is judged per satellite, not per product collection: a collection that was
  // superseded (MODIS C6 → C6.1) or a satellite outside its own record span (NOAA-21 before
  // launch) is not missing data. Inside a satellite's span, an unknown count is.
  const sensorOf = (sourceId: string) => sourceSensor.get(sourceId) ?? sensorKeyOf(sourceId)
  const countOf = (source: { count: string | null; count_status: string }) => (source.count_status === 'unknown' ? null : toNumber(source.count))
  const spans = new Map<SensorKey, [string, string]>()
  for (const period of calendar?.periods ?? []) {
    const date = period.start.slice(0, 10)
    for (const source of period.counts_by_source) {
      if (countOf(source) === null) continue
      const key = sensorOf(source.source_id)
      const span = spans.get(key)
      spans.set(key, span ? [span[0] < date ? span[0] : date, span[1] > date ? span[1] : date] : [date, date])
    }
  }
  const periods: DayCell[] = (calendar?.periods ?? []).map((period) => {
    const date = period.start.slice(0, 10)
    const bySensor: Partial<Record<SensorKey, number>> = {}
    const expected = new Set<SensorKey>()
    for (const source of period.counts_by_source) {
      const key = sensorOf(source.source_id)
      const span = spans.get(key)
      // A satellite with no known count anywhere cannot be placed in time, so it stays expected.
      if (!span || (date >= span[0] && date <= span[1])) expected.add(key)
      const count = countOf(source)
      if (count !== null) bySensor[key] = (bySensor[key] ?? 0) + count
    }
    const known = Object.values(bySensor) as number[]
    return {
      date,
      start: period.start,
      endExclusive: period.end_exclusive,
      total: known.length ? known.reduce((a, b) => a + b, 0) : null,
      bySensor,
      missing: [...expected].filter((key) => bySensor[key] === undefined),
    }
  })

  const monthMap = new Map<string, MonthBucket>()
  for (const cell of periods) {
    const month = cell.date.slice(0, 7)
    const bucket = monthMap.get(month) ?? { month, total: 0, bySensor: {} }
    bucket.total += cell.total ?? Object.values(cell.bySensor).reduce((a, b) => a + (b ?? 0), 0)
    for (const [key, value] of Object.entries(cell.bySensor) as [SensorKey, number][]) bucket.bySensor[key] = (bucket.bySensor[key] ?? 0) + value
    monthMap.set(month, bucket)
  }
  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month))

  const known = periods.filter((cell) => cell.total !== null)
  const peakPeriod = known.reduce<DayCell | null>((best, cell) => (cell.total! > (best?.total ?? 0) ? cell : best), null)
  const peakMonth = months.reduce<MonthBucket | null>((best, bucket) => (bucket.total > (best?.total ?? 0) ? bucket : best), null)
  const bothInstrumentPeriods = periods.filter((cell) => {
    const entries = Object.entries(cell.bySensor) as [SensorKey, number][]
    return entries.some(([key, value]) => SENSORS[key].instrument === 'MODIS' && value > 0) && entries.some(([key, value]) => SENSORS[key].instrument === 'VIIRS' && value > 0)
  }).length
  const monthTotal = months.reduce((sum, bucket) => sum + bucket.total, 0)
  const topMonthsShare = months.length > 3 && monthTotal > 0
    ? [...months].sort((a, b) => b.total - a.total).slice(0, 3).reduce((sum, bucket) => sum + bucket.total, 0) / monthTotal
    : null

  return {
    total,
    lowerBound,
    sensors,
    modis,
    viirs,
    ratio: modis > 0 && viirs > 0 ? viirs / modis : null,
    resolution: calendar?.resolution ?? 'day',
    periods,
    months,
    activePeriods: known.filter((cell) => (cell.total ?? 0) > 0).length,
    knownPeriods: known.length,
    peakPeriod: peakPeriod && (peakPeriod.total ?? 0) > 0 ? peakPeriod : null,
    peakMonth: peakMonth && peakMonth.total > 0 ? peakMonth : null,
    bothInstrumentPeriods,
    topMonthsShare,
  }
}

export const formatMonth = (month: string, style: 'long' | 'short' = 'long') =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' })

export const formatDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
