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
  total: number | null
  bySensor: Partial<Record<SensorKey, number | null>>
}

export interface MonthBucket {
  month: string // YYYY-MM
  total: number | null
  bySensor: Partial<Record<SensorKey, number | null>>
}

export interface Insights {
  total: number | null
  lowerBound: boolean
  sensors: SensorTotal[]
  modis: number | null
  viirs: number | null
  ratio: number | null
  resolution: string
  periods: DayCell[]
  months: MonthBucket[]
  activePeriods: number
  knownPeriods: number
  peakPeriod: DayCell | null
  peakMonth: (MonthBucket & { total: number }) | null
  bothInstrumentPeriods: number
  topMonthsShare: number | null
}

const toNumber = (value: string | null | undefined) =>
  value != null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
const add = (left: number | null, right: number | null): number | null =>
  left !== null && right !== null && Number.isSafeInteger(left + right) ? left + right : null

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
    entry.count = add(entry.count, count)
    sensorMap.set(key, entry)
    total = add(total, count)
  }
  if (!summary?.native_detections_by_source.length) total = null

  const order: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat', 'other']
  const sensors = [...sensorMap.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  const instrumentTotal = (name: string) => {
    const rows = sensors.filter((s) => s.instrument === name)
    return rows.length ? rows.reduce<number | null>((sum, s) => add(sum, s.count), 0) : null
  }
  const modis = instrumentTotal('MODIS')
  const viirs = instrumentTotal('VIIRS')

  const periods: DayCell[] = (calendar?.periods ?? []).map((period) => {
    const bySensor: Partial<Record<SensorKey, number | null>> = {}
    let periodTotal: number | null = 0
    // Missing source rows and lower bounds are not exact zero-valued observations.
    const rows = [...period.counts_by_source]
    for (const id of sourceSensor.keys()) {
      if (!rows.some((row) => row.source_id === id))
        rows.push({ source_id: id, count: null, count_status: 'unknown' })
    }
    for (const source of rows) {
      const count = source.count_status === 'complete' ? toNumber(source.count) : null
      const key = sourceSensor.get(source.source_id) ?? sensorKeyOf(source.source_id)
      bySensor[key] = add(bySensor[key] === undefined ? 0 : bySensor[key], count)
      periodTotal = add(periodTotal, count)
    }
    if (!period.counts_by_source.length) periodTotal = null
    return { date: period.start.slice(0, 10), start: period.start, endExclusive: period.end_exclusive, total: periodTotal, bySensor }
  })

  const monthMap = new Map<string, MonthBucket>()
  // Weekly/auto buckets can cross a month boundary; they cannot be reassigned to one month.
  for (const cell of ['day', 'month'].includes(calendar?.resolution ?? '') ? periods : []) {
    const month = cell.date.slice(0, 7)
    const bucket = monthMap.get(month) ?? { month, total: 0, bySensor: {} }
    bucket.total = add(bucket.total, cell.total)
    for (const [key, value] of Object.entries(cell.bySensor) as [SensorKey, number | null][])
      bucket.bySensor[key] = add(bucket.bySensor[key] === undefined ? 0 : bucket.bySensor[key], value)
    monthMap.set(month, bucket)
  }
  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month))

  const known = periods.filter((cell) => cell.total !== null)
  const peakPeriod = known.reduce<DayCell | null>((best, cell) => (cell.total! > (best?.total ?? 0) ? cell : best), null)
  const exactMonths = months.filter((bucket): bucket is MonthBucket & { total: number } => bucket.total !== null)
  const peakMonth = exactMonths.length === months.length
    ? exactMonths.reduce<(MonthBucket & { total: number }) | null>((best, bucket) => bucket.total > (best?.total ?? 0) ? bucket : best, null)
    : null
  const bothInstrumentPeriods = periods.filter((cell) => {
    const entries = Object.entries(cell.bySensor) as [SensorKey, number | null][]
    return entries.some(([key, value]) => SENSORS[key].instrument === 'MODIS' && value !== null && value > 0) && entries.some(([key, value]) => SENSORS[key].instrument === 'VIIRS' && value !== null && value > 0)
  }).length
  const monthTotal = exactMonths.reduce<number | null>((sum, bucket) => add(sum, bucket.total), 0)
  const topMonthsShare = !lowerBound && exactMonths.length === months.length && months.length > 3 && monthTotal !== null && monthTotal > 0
    ? [...exactMonths].sort((a, b) => b.total - a.total).slice(0, 3).reduce((sum, bucket) => sum + bucket.total, 0) / monthTotal
    : null

  return {
    total,
    lowerBound,
    sensors,
    modis,
    viirs,
    ratio: !lowerBound && modis !== null && viirs !== null && modis > 0 && viirs > 0 ? viirs / modis : null,
    resolution: calendar?.resolution ?? 'day',
    periods,
    months,
    activePeriods: known.filter((cell) => (cell.total ?? 0) > 0).length,
    knownPeriods: known.length,
    peakPeriod: known.length === periods.length && peakPeriod && (peakPeriod.total ?? 0) > 0 ? peakPeriod : null,
    peakMonth: peakMonth && peakMonth.total > 0 ? peakMonth : null,
    bothInstrumentPeriods,
    topMonthsShare,
  }
}

export const formatMonth = (month: string, style: 'long' | 'short' = 'long') =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' })

export const formatDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
