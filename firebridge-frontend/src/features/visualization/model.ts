import type { CalendarView } from '../../services/data.types'

export type CountState = 'complete' | 'lower_bound' | 'unknown'
export interface ChartValue {
  exact: string | null
  plot: number | null
  state: CountState
}
export interface ChartPoint extends ChartValue {
  start: string
  endExclusive: string
  time: number
}
export interface ChartSeries {
  id: string
  points: ChartPoint[]
  total: ChartValue
}
export interface ChartSource extends ChartSeries { label: string; color: string }

/** Keep exact wire counts for the table. Unsafe integers never enter a floating-point chart. */
export function chartValue(count: string | null, status: string): ChartValue {
  if (count === null || !/^\d+$/.test(count) || !['complete', 'lower_bound'].includes(status))
    return { exact: null, plot: null, state: 'unknown' }
  const exact = BigInt(count).toString()
  return {
    exact,
    plot: BigInt(exact) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null,
    state: status as CountState,
  }
}

/** An unknown period prevents claiming an exact source total, even when other days have records. */
export function totalOf(values: readonly ChartValue[]): ChartValue {
  const known = values.filter((v) => v.exact !== null)
  if (!known.length) return chartValue(null, 'unknown')
  const total = known.reduce((sum, v) => sum + BigInt(v.exact!), 0n)
  const state = known.length === values.length && known.every((v) => v.state === 'complete') ? 'complete' : 'lower_bound'
  return chartValue(total.toString(), state)
}

export function calendarSeries(calendar: CalendarView): ChartSeries[] {
  const periods = [...calendar.periods].sort((a, b) => a.start.localeCompare(b.start))
  const ids = [...new Set(periods.flatMap((p) => p.counts_by_source.map((s) => s.source_id)))].sort()
  return ids.map((id) => {
    const points = periods.map((period) => {
      const source = period.counts_by_source.find((s) => s.source_id === id)
      return {
        start: period.start,
        endExclusive: period.end_exclusive,
        time: Date.parse(period.start),
        ...chartValue(source?.count ?? null, source?.count_status ?? 'unknown'),
      }
    })
    return { id, points, total: totalOf(points) }
  })
}

export function countLabel(value: ChartValue): string {
  return value.exact === null ? 'Unknown' : `${value.state === 'lower_bound' ? '≥ ' : ''}${BigInt(value.exact).toLocaleString('en-GB')}`
}

export function isUtcDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function nextDay(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}
export function previousDay(value: string): string {
  return new Date(Date.parse(value) - 86_400_000).toISOString().slice(0, 10)
}

/** The UI uses an inclusive last day; the API always receives an exclusive UTC boundary. */
export function validateWindow(start: string, endInclusive: string, savedStart: string, savedEndExclusive: string): string | null {
  if (!isUtcDay(start) || !isUtcDay(endInclusive)) return 'Choose two valid dates.'
  if (start > endInclusive) return 'The start date must be on or before the end date.'
  if (start < savedStart.slice(0, 10) || nextDay(endInclusive) > savedEndExclusive.slice(0, 10))
    return 'Choose dates inside the saved analysis. Create a new analysis for another interval.'
  return null
}

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`
export function calendarCsv(series: readonly ChartSeries[]): string {
  const rows = [['source_id', 'start_utc', 'end_exclusive_utc', 'native_detections', 'count_status']]
  for (const source of series)
    for (const point of source.points)
      rows.push([source.id, point.start, point.endExclusive, point.exact ?? '', point.state])
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
