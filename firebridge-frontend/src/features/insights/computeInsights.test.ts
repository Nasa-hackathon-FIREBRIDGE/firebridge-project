import { describe, expect, it } from 'vitest'
import { computeInsights } from './computeInsights'
import type { NativeCalendar, NativeSummary } from '../observations/types'

const source = (source_id: string, platform: string, product: string, count: string | null, count_status = 'complete') => ({
  source_id, platform, product, collection: '1', processing_stream: 'standard', count, observed_count: count, inventory_status: 'complete', count_status,
})
const period = (day: string, counts: [string, string | null][]) => ({
  start: `${day}T00:00:00.000Z`,
  end_exclusive: `${day}T00:00:00.000Z`,
  counts_by_source: counts.map(([source_id, count]) => ({ source_id, count, count_status: count === null ? 'unknown' : 'complete' })),
})

const summary = {
  status: 'ready',
  inventory_status: 'complete',
  coverage: { fraction: null, status: 'unknown', reasons: [] },
  native_detections_by_source: [
    source('modis-aqua-c6-standard', 'Aqua', 'modis-aqua', '4'),
    source('viirs-noaa20-c2-standard', 'N20', 'viirs-noaa20', '30'),
    source('viirs-snpp-c2-standard', 'SNPP', 'viirs-snpp', '10'),
  ],
} as unknown as NativeSummary

const calendar = {
  status: 'ready',
  resolution: 'day',
  periods: [
    period('2020-07-31', [['modis-aqua-c6-standard', '1'], ['viirs-noaa20-c2-standard', '0'], ['viirs-snpp-c2-standard', '0']]),
    period('2020-08-01', [['modis-aqua-c6-standard', '3'], ['viirs-noaa20-c2-standard', '25'], ['viirs-snpp-c2-standard', '8']]),
    period('2020-08-02', [['modis-aqua-c6-standard', '0'], ['viirs-noaa20-c2-standard', '5'], ['viirs-snpp-c2-standard', '2']]),
    period('2020-08-03', [['modis-aqua-c6-standard', '0'], ['viirs-noaa20-c2-standard', '0'], ['viirs-snpp-c2-standard', '0']]),
  ],
} as unknown as NativeCalendar

describe('computeInsights', () => {
  it('derives totals, sensor identity and the VIIRS:MODIS ratio from the saved summary', () => {
    const insights = computeInsights(summary, calendar)
    expect(insights.total).toBe(44)
    expect(insights.sensors.map((sensor) => [sensor.key, sensor.count])).toEqual([['aqua', 4], ['snpp', 10], ['noaa20', 30]])
    expect(insights.modis).toBe(4)
    expect(insights.viirs).toBe(40)
    expect(insights.ratio).toBe(10)
  })

  it('finds the peak day and month, active days and same-day instrument overlap', () => {
    const insights = computeInsights(summary, calendar)
    expect(insights.peakPeriod?.date).toBe('2020-08-01')
    expect(insights.peakPeriod?.total).toBe(36)
    expect(insights.peakMonth?.month).toBe('2020-08')
    expect(insights.peakMonth?.total).toBe(43)
    expect(insights.activePeriods).toBe(3)
    expect(insights.knownPeriods).toBe(4)
    expect(insights.bothInstrumentPeriods).toBe(1)
  })

  it('never turns an unknown count into zero', () => {
    const unknown = {
      ...summary,
      native_detections_by_source: [source('modis-aqua-c6-standard', 'Aqua', 'modis-aqua', null, 'unknown'), source('viirs-noaa20-c2-standard', 'N20', 'viirs-noaa20', '30')],
    } as unknown as NativeSummary
    const gap = { ...calendar, periods: [period('2020-08-01', [['modis-aqua-c6-standard', null], ['viirs-noaa20-c2-standard', '5']])] } as unknown as NativeCalendar
    const insights = computeInsights(unknown, gap)
    expect(insights.total).toBeNull()
    expect(insights.sensors[0].count).toBeNull()
    expect(insights.periods[0].total).toBeNull()
    expect(insights.knownPeriods).toBe(0)
    expect(insights.ratio).toBeNull()
  })

  it('returns an empty, honest result before data loads', () => {
    const insights = computeInsights(undefined, undefined)
    expect(insights.total).toBeNull()
    expect(insights.sensors).toEqual([])
    expect(insights.peakPeriod).toBeNull()
  })
})
