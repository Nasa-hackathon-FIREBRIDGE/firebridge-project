import { describe, expect, it } from 'vitest'
import { chartValue, totalOf, type ChartSource } from './model'
import { concentration, correlation, distribution, eligibleMonths, monthPairs, percent, yearDifferences, yearSimilarities } from './lab-model'

function source(id: string, values: [string, string | null, string, string?][]): ChartSource {
  const points = values.map(([month, value, state, clipped]) => {
    const start = `${month}-${clipped ?? '01'}`, endExclusive = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString()
    return { start, endExclusive, time: Date.parse(start), ...chartValue(value, state) }
  })
  return { id, label: id, color: '#ff914d', points, total: totalOf(points) }
}

describe('visual analytics lab calculations', () => {
  it('excludes unknown, lower-bound, clipped and unsafe months while preserving exact zeros', () => {
    const s = source('a', [['2024-01', '0', 'complete'], ['2024-02', null, 'unknown'], ['2024-03', '9', 'lower_bound'], ['2024-04', '8', 'complete', '17'], ['2024-05', '9007199254740993', 'complete']])
    expect(eligibleMonths(s).map((m) => [m.key, m.plot])).toEqual([['2024-01', 0]])
  })
  it('requires four observations for a box but retains individual observations for shorter samples', () => {
    const s = source('a', [['2024-01', '1', 'complete'], ['2024-02', '2', 'complete'], ['2024-03', '3', 'complete']])
    expect(distribution(s)).toMatchObject({ box: null, months: [{ plot: 1 }, { plot: 2 }, { plot: 3 }] })
    s.points.push({ start: '2024-04-01', endExclusive: '2024-05-01', time: 0, ...chartValue('4', 'complete') })
    expect(distribution(s).box).toEqual({ q1: 1.75, median: 2.5, q3: 3.25, low: 1, high: 4 })
  })
  it('ranks concentration by count, preserving a precise bigint denominator', () => {
    const s = source('a', [['2024-01', '1', 'complete'], ['2024-02', '6', 'complete'], ['2024-03', '3', 'complete']])
    const c = concentration(s)
    expect(c.months.map((m) => m.key)).toEqual(['2024-02', '2024-03', '2024-01'])
    expect(c.points.map((p) => p.y)).toEqual([0, 60, 90, 100])
    expect(c.top).toBe(1)
    expect(percent(9007199254740993n, 18014398509481986n)).toBe(50)
  })
  it('does not invent shares for a zero-count inventory or an empty selection', () => {
    expect(concentration(source('a', [['2024-01', '0', 'complete']])).total).toBe(0n)
    expect(concentration().months).toEqual([])
    expect(percent(0n, 0n)).toBe(0)
  })
  it('pairs only exact, full UTC months in the two chosen streams', () => {
    const a = source('a', [['2024-01', '0', 'complete'], ['2024-02', '4', 'complete'], ['2024-03', '8', 'complete']])
    const b = source('b', [['2024-01', '2', 'complete'], ['2024-02', '5', 'lower_bound'], ['2024-03', '6', 'complete', '02']])
    expect(monthPairs(a, b)).toEqual([{ key: '2024-01', x: 0, y: 2 }])
    expect(monthPairs(a, undefined)).toEqual([])
  })
  it('calculates target minus reference and leaves missing year-pairs absent', () => {
    const s = source('a', [['2024-01', '8', 'complete'], ['2025-01', '2', 'complete'], ['2024-02', '9', 'complete'], ['2025-02', '4', 'lower_bound']])
    const rows = yearDifferences(s, '2024', '2025')
    expect(rows[0]).toMatchObject({ delta: -6n, plot: -6 })
    expect(rows[1]).toMatchObject({ delta: null, plot: null })
    expect(rows).toHaveLength(12)
  })
  it('rejects correlation for short or constant samples and reports inverse shape correctly', () => {
    expect(correlation([{ x: 1, y: 2 }])).toBeNull()
    expect(correlation([1, 2, 3, 4].map((v) => ({ x: 0, y: v })))).toBeNull()
    expect(correlation([1, 2, 3, 4].map((v) => ({ x: v, y: 5 - v })))).toBeCloseTo(-1)
    expect(correlation([1, 2, 3, 4].map((v) => ({ x: Number.MAX_SAFE_INTEGER - v, y: v })))).toBeCloseTo(-1)
  })
  it('compares matching calendar months only and reports each cell sample size', () => {
    const a = source('a', [
      ['2024-01', '1', 'complete'], ['2024-02', '2', 'complete'], ['2024-03', '3', 'complete'], ['2024-04', '4', 'complete'],
      ['2025-01', '8', 'complete'], ['2025-02', '6', 'complete'], ['2025-03', '4', 'complete'], ['2025-04', '2', 'complete'],
      ['2026-01', '5', 'complete'],
    ])
    const matrix = yearSimilarities(a)
    expect(matrix.years).toEqual(['2024', '2025', '2026'])
    expect(matrix.cells.find((c) => c.a === '2024' && c.b === '2025')).toMatchObject({ n: 4, r: -1 })
    expect(matrix.cells.find((c) => c.a === '2024' && c.b === '2026')).toMatchObject({ n: 1, r: null })
  })
})
