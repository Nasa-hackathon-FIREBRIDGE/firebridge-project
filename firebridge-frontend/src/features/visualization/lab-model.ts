import { quantileSorted } from 'd3-array'
import { monthlyCells, type MonthCell } from './analytics'
import type { ChartSource } from './model'

export interface ExactMonth extends MonthCell { plot: number; exact: string }
export const eligibleMonths = (source?: ChartSource): ExactMonth[] => source
  ? monthlyCells([source]).filter((m): m is ExactMonth => m.fullMonth && m.state === 'complete' && m.plot !== null && m.exact !== null)
  : []

export function distribution(source: ChartSource) {
  const months = eligibleMonths(source).sort((a, b) => a.plot - b.plot)
  const values = months.map((m) => m.plot)
  if (values.length < 4) return { months, box: null }
  const q1 = quantileSorted(values, .25)!, median = quantileSorted(values, .5)!, q3 = quantileSorted(values, .75)!
  const spread = q3 - q1
  const inside = values.filter((v) => v >= q1 - 1.5 * spread && v <= q3 + 1.5 * spread)
  return { months, box: { q1, median, q3, low: inside[0], high: inside.at(-1)! } }
}

export function percent(part: bigint, total: bigint): number {
  return total > 0n ? Number(part * 1_000_000n / total) / 10_000 : 0
}

export function concentration(source?: ChartSource) {
  const months = eligibleMonths(source).sort((a, b) => b.plot - a.plot || a.key.localeCompare(b.key))
  const total = months.reduce((n, m) => n + BigInt(m.exact), 0n)
  let sum = 0n
  const points = [{ x: 0, y: 0, key: '', exact: '0' }, ...months.map((m, i) => {
    sum += BigInt(m.exact)
    return { x: (i + 1) * 100 / months.length, y: percent(sum, total), key: m.key, exact: m.exact }
  })]
  const top = Math.ceil(months.length / 5)
  return { months, total, points, top, topShare: points[top]?.y ?? 0 }
}

export function monthPairs(a?: ChartSource, b?: ChartSource) {
  const right = new Map(eligibleMonths(b).map((m) => [m.key, m]))
  return eligibleMonths(a).flatMap((m) => {
    const other = right.get(m.key)
    return other ? [{ key: m.key, x: m.plot, y: other.plot }] : []
  })
}

export function yearDifferences(source: ChartSource | undefined, reference: string, target: string) {
  const months = eligibleMonths(source)
  return Array.from({ length: 12 }, (_, month) => {
    const before = months.find((m) => m.year === reference && m.month === month)
    const after = months.find((m) => m.year === target && m.month === month)
    const delta = before && after ? BigInt(after.exact) - BigInt(before.exact) : null
    return { month, before, after, delta, plot: delta === null ? null : Number(delta) }
  })
}

/** Descriptive Pearson r on paired, exact full months. Constant or short samples have no score. */
export function correlation(values: { x: number; y: number }[]) {
  if (values.length < 4) return null
  const centred = values.map((v) => ({ x: v.x - values[0].x, y: v.y - values[0].y }))
  const mx = centred.reduce((sum, v) => sum + v.x, 0) / values.length
  const my = centred.reduce((sum, v) => sum + v.y, 0) / values.length
  const xx = centred.reduce((sum, v) => sum + (v.x - mx) ** 2, 0)
  const yy = centred.reduce((sum, v) => sum + (v.y - my) ** 2, 0)
  if (!xx || !yy) return null
  const xy = centred.reduce((sum, v) => sum + (v.x - mx) * (v.y - my), 0)
  return Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)))
}

export function yearSimilarities(source?: ChartSource) {
  const all = source ? monthlyCells([source]) : []
  const years = [...new Set(all.map((m) => m.year))].sort()
  const months = eligibleMonths(source)
  return { years, cells: years.flatMap((a) => years.map((b) => {
    const pairs = months.filter((m) => m.year === a).flatMap((m) => {
      const other = months.find((n) => n.year === b && n.month === m.month)
      return other ? [{ x: m.plot, y: other.plot }] : []
    })
    return { a, b, n: pairs.length, r: correlation(pairs) }
  })) }
}
