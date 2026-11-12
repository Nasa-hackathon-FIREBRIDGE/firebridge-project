import { describe, expect, it } from 'vitest'
import type { CalendarView } from '../../services/data.types'
import { calendarCsv, calendarSeries, chartValue, countLabel, nextDay, totalOf, validateWindow } from './model'

describe('visualization data contract', () => {
  it('keeps a verified zero separate from unknown and unsupported counts', () => {
    expect(chartValue('0', 'complete')).toEqual({ exact: '0', plot: 0, state: 'complete' })
    expect(chartValue(null, 'unknown').plot).toBeNull()
    expect(chartValue('0', 'unknown').exact).toBeNull()
    expect(chartValue('-1', 'complete').exact).toBeNull()
  })
  it('keeps large integer precision in text and omits unsafe chart coordinates', () => {
    const count = chartValue('9007199254740993', 'complete')
    expect(count.exact).toBe('9007199254740993')
    expect(count.plot).toBeNull()
    expect(countLabel(count)).toBe('9,007,199,254,740,993')
  })
  it('labels partial sums as lower bounds and all-unknown sums as unknown', () => {
    expect(totalOf([chartValue('4', 'complete'), chartValue(null, 'unknown')])).toMatchObject({ exact: '4', state: 'lower_bound' })
    expect(totalOf([chartValue(null, 'unknown')]).exact).toBeNull()
    expect(totalOf([chartValue('2', 'lower_bound'), chartValue('3', 'complete')])).toMatchObject({ exact: '5', state: 'lower_bound' })
  })
  it('preserves missing periods in each source series instead of drawing a zero', () => {
    const calendar = { periods: [
      { start: '2026-01-02T00:00:00Z', end_exclusive: '2026-01-03T00:00:00Z', counts_by_source: [{ source_id: 'aqua', count: '0', count_status: 'complete' }] },
      { start: '2026-01-01T00:00:00Z', end_exclusive: '2026-01-02T00:00:00Z', counts_by_source: [{ source_id: 'terra', count: '3', count_status: 'complete' }] },
    ] } as CalendarView
    const series = calendarSeries(calendar)
    expect(series.map((s) => s.id)).toEqual(['aqua', 'terra'])
    expect(series[0].points.map((p) => p.plot)).toEqual([null, 0])
    expect(series[1].points.map((p) => p.plot)).toEqual([3, null])
    expect(series[1].total.state).toBe('lower_bound')
  })
  it('uses inclusive date inputs and exclusive UTC requests, including leap days', () => {
    expect(nextDay('2024-02-29')).toBe('2024-03-01')
    expect(validateWindow('2024-02-29', '2024-02-29', '2024-02-01', '2024-03-01')).toBeNull()
    expect(validateWindow('2024-02-30', '2024-03-01', '2024-02-01', '2024-04-01')).toBeTruthy()
    expect(validateWindow('2024-03-02', '2024-03-01', '2024-01-01', '2025-01-01')).toBeTruthy()
    expect(validateWindow('2024-01-01', '2024-03-01', '2024-02-01', '2024-04-01')).toBeTruthy()
  })
  it('exports exact counts and explicit unknown state in CSV', () => {
    const csv = calendarCsv([{ id: 'aqua', total: chartValue(null, 'unknown'), points: [{ time: 0, start: '2026-01-01', endExclusive: '2026-01-02', ...chartValue(null, 'unknown') }] }])
    expect(csv).toContain('"aqua","2026-01-01","2026-01-02","","unknown"')
  })
})
