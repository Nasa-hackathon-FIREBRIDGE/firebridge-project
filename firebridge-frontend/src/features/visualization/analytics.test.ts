import { describe, expect, it } from 'vitest'
import { monthlyCells } from './analytics'
import { chartValue, totalOf, type ChartPoint, type ChartSeries } from './model'

function series(id: string, rows: [string, string, string | null, string][]): ChartSeries {
  const points: ChartPoint[] = rows.map(([start, endExclusive, n, status]) => ({ start, endExclusive, time: Date.parse(start), ...chartValue(n, status) }))
  return { id, points, total: totalOf(points) }
}

describe('monthly visualization buckets', () => {
  it('keeps missing and partial inventory distinct when combining streams', () => {
    const a = series('aqua', [['2024-01-01', '2024-02-01', '4', 'complete'], ['2024-02-01', '2024-03-01', null, 'unknown']])
    const b = series('terra', [['2024-01-01', '2024-02-01', null, 'unknown'], ['2024-02-01', '2024-03-01', null, 'unknown']])
    expect(monthlyCells([a, b])).toMatchObject([
      { key: '2024-01', exact: '4', state: 'lower_bound', fullMonth: true },
      { key: '2024-02', exact: null, state: 'unknown', fullMonth: true },
    ])
  })
  it('distinguishes clipped months from a full leap-year February', () => {
    const s = series('aqua', [['2024-01-17', '2024-02-01', '99', 'complete'], ['2024-02-01', '2024-03-01', '4', 'complete']])
    expect(monthlyCells([s]).map((m) => m.fullMonth)).toEqual([false, true])
  })
  it('retains exact integers beyond chart precision without plotting them', () => {
    const s = series('aqua', [['2024-01-01', '2024-02-01', '9007199254740993', 'complete']])
    expect(monthlyCells([s])[0]).toMatchObject({ exact: '9007199254740993', plot: null, state: 'complete' })
  })
  it('has no fabricated month for an empty selection', () => {
    expect(monthlyCells([])).toEqual([])
  })
})
