import { totalOf, type ChartPoint, type ChartSeries, type ChartValue } from './model'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export interface MonthCell extends ChartValue {
  key: string
  year: string
  month: number
  fullMonth: boolean
}

/** Only use month-resolution API buckets. Never apportion a weekly count across months. */
export function monthlyCells(series: readonly ChartSeries[]): MonthCell[] {
  const periods = new Map<string, ChartPoint[]>()
  for (const source of series) for (const point of source.points) {
    const key = point.start.slice(0, 7)
    const rows = periods.get(key) ?? []
    rows.push(point)
    periods.set(key, rows)
  }
  return [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, points]) => {
    const month = Number(key.slice(5)) - 1
    const next = new Date(Date.UTC(Number(key.slice(0, 4)), month + 1, 1)).toISOString()
    const fullMonth = points.every((p) => Date.parse(p.start) === Date.parse(`${key}-01T00:00:00Z`) && Date.parse(p.endExclusive) === Date.parse(next))
    return { key, year: key.slice(0, 4), month, fullMonth, ...totalOf(points) }
  })
}

export function monthLabel(key: string) {
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
}
