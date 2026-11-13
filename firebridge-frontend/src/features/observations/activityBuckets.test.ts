import { describe, expect, it } from 'vitest'
import { axisTicks, bucketize, labelEvery, resolutionFor, type DayCount } from './activityBuckets'
import { summarizeKnownCounts } from '../../lib/nativeCounts'

const days = (count: number, from = '2024-01-01', value: (i: number) => bigint | null = () => 1n): DayCount[] =>
  Array.from({ length: count }, (_, i) => ({
    start: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString(),
    value: value(i),
    lowerBound: false,
  }))

describe('activity buckets', () => {
  it('chooses a resolution that keeps the bar count readable', () => {
    expect(resolutionFor(30)).toBe('day')
    expect(resolutionFor(200)).toBe('week')
    expect(resolutionFor(1_000)).toBe('month')
    expect(resolutionFor(10_980)).toBe('year')
    // A full 30-year analysis becomes 30 bars, not 10,980.
    expect(bucketize(days(10_980, '1996-01-01')).buckets).toHaveLength(31)
  })

  it('keeps one bar per day for short periods', () => {
    const { resolution, buckets } = bucketize(days(3, '2024-06-19'))
    expect(resolution).toBe('day')
    expect(buckets.map((b) => b.label)).toEqual(['06-19', '06-20', '06-21'])
    expect(buckets[0].title).toBe('2024-06-19: 1 records')
  })

  it('sums known days and keeps the result honest when some days are unknown', () => {
    const rows = days(70, '2024-01-01', (i) => (i === 3 ? null : 2n))
    const { resolution, buckets } = bucketize(rows)
    expect(resolution).toBe('week')
    expect(buckets[0]).toMatchObject({ value: 12n, lowerBound: true, days: 7 })
    expect(buckets[0].title).toBe('2024-01-01 to 2024-01-07: at least 12 records')
    expect(buckets[1]).toMatchObject({ value: 14n, lowerBound: false })
  })

  it('never turns a fully unknown group into zero', () => {
    const { buckets } = bucketize(days(400, '2024-01-01', (i) => (i < 31 ? null : 0n)))
    expect(buckets[0]).toMatchObject({ label: 'Jan 2024', value: null })
    expect(buckets[0].title).toBe('2024-01-01 to 2024-01-31: unknown records')
    expect(buckets[1]).toMatchObject({ label: 'Feb 2024', value: 0n, lowerBound: false })
  })

  it('carries a source lower bound into its group', () => {
    const rows = days(10).map((row, i) => ({ ...row, lowerBound: i === 5 }))
    expect(bucketize(rows).buckets[5].lowerBound).toBe(true)
  })

  it('thins axis labels to a handful', () => {
    expect(labelEvery(6, 6)).toBe(1)
    expect(labelEvery(36, 6)).toBe(6)
    expect(labelEvery(0)).toBe(1)
  })
})

describe('chart counts across satellites', () => {
  it('sums known satellites, flags a lower bound, and keeps an all-unknown day unknown', () => {
    const known = { count: '4', count_status: 'complete' }
    const unknown = { count: null, count_status: 'unknown' }
    expect(summarizeKnownCounts([known, { count: '3', count_status: 'complete' }])).toEqual({ value: 7n, lowerBound: false })
    // One satellite outside its record span no longer blanks the whole day.
    expect(summarizeKnownCounts([known, unknown])).toEqual({ value: 4n, lowerBound: true })
    expect(summarizeKnownCounts([unknown, unknown])).toEqual({ value: null, lowerBound: true })
    expect(summarizeKnownCounts([{ count: '0', count_status: 'complete' }])).toEqual({ value: 0n, lowerBound: false })
  })
})

describe('axis ticks', () => {
  it('labels each January with its year for monthly bars, at most seven', () => {
    const { resolution, buckets } = bucketize(days(2_506, '2020-01-01'))
    expect(resolution).toBe('month')
    const ticks = axisTicks(buckets, resolution)
    expect([...ticks.values()]).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026'])
    expect(buckets[[...ticks.keys()][1]].start.slice(0, 7)).toBe('2021-01')
  })

  it('labels the first week of each month for weekly bars', () => {
    const { resolution, buckets } = bucketize(days(90, '2024-06-19'))
    expect(resolution).toBe('week')
    expect([...axisTicks(buckets, resolution).values()]).toEqual(['Jun', 'Jul', 'Aug', 'Sept'])
  })
})
