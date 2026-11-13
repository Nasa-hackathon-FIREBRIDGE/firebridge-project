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
    const gap = { ...calendar, periods: [period('2020-08-01', [['modis-aqua-c6-standard', null], ['viirs-noaa20-c2-standard', '5']]), period('2020-08-02', [['modis-aqua-c6-standard', null], ['viirs-noaa20-c2-standard', null]])] } as unknown as NativeCalendar
    const insights = computeInsights(unknown, gap)
    expect(insights.total).toBe(30)
    expect(insights.lowerBound).toBe(true)
    expect(insights.sensors[0].count).toBeNull()
    // The known satellite's count is a lower bound, flagged with the satellite that is missing.
    expect(insights.periods[0]).toMatchObject({ total: 5, missing: ['aqua'] })
    // No satellite known that day: no total at all (NOAA-20's record span ended the day before).
    expect(insights.periods[1]).toMatchObject({ total: null, missing: ['aqua'] })
    expect(insights.knownPeriods).toBe(1)
    expect(insights.ratio).toBeNull()
  })

  it.each([false, true])('retains known satellite counts when an unknown collection is listed first: %s', (unknownFirst) => {
    const sources = [
      source('modis-aqua-c61-standard', 'Aqua', 'modis-aqua', '540', 'lower_bound'),
      source('modis-aqua-c6-standard', 'Aqua', 'modis-aqua', null, 'unknown'),
      source('modis-terra-c61-standard', 'Terra', 'modis-terra', '425', 'lower_bound'),
      source('modis-terra-c6-standard', 'Terra', 'modis-terra', null, 'unknown'),
      source('viirs-snpp-c2-standard', 'SNPP', 'viirs-snpp', '8210', 'lower_bound'),
      source('viirs-noaa20-c2-standard', 'N20', 'viirs-noaa20', '8474', 'lower_bound'),
      source('viirs-noaa21-c2-standard', 'N21', 'viirs-noaa21', '7521', 'lower_bound'),
    ]
    const insights = computeInsights({ ...summary, native_detections_by_source: unknownFirst ? sources.reverse() : sources })
    expect(insights.total).toBe(25170)
    expect(insights.lowerBound).toBe(true)
    expect(insights.sensors.map(({ key, count, lowerBound }) => ({ key, count, lowerBound }))).toEqual([
      { key: 'terra', count: 425, lowerBound: true },
      { key: 'aqua', count: 540, lowerBound: true },
      { key: 'snpp', count: 8210, lowerBound: true },
      { key: 'noaa20', count: 8474, lowerBound: true },
      { key: 'noaa21', count: 7521, lowerBound: true },
    ])
    expect(insights.modis).toBe(965)
    expect(insights.viirs).toBe(24205)
    expect(insights.ratio).toBeCloseTo(25.0829)
  })

  it('sums known collections and marks an unknown companion collection as a lower bound', () => {
    const insights = computeInsights({ ...summary, native_detections_by_source: [
      source('modis-aqua-c6-standard', 'Aqua', 'modis-aqua', '2'),
      source('modis-aqua-c61-standard', 'Aqua', 'modis-aqua', '3'),
      source('modis-aqua-other', 'Aqua', 'modis-aqua', null, 'unknown'),
    ] })
    expect(insights.total).toBe(5)
    expect(insights.lowerBound).toBe(true)
    expect(insights.sensors[0]).toMatchObject({ count: 5, lowerBound: true })
  })

  it('keeps an entirely unknown inventory distinct from a confirmed zero', () => {
    const unknown = computeInsights({ ...summary, native_detections_by_source: [source('modis-aqua-c6-standard', 'Aqua', 'modis-aqua', null, 'unknown')] })
    expect(unknown.total).toBeNull()
    expect(unknown.sensors[0].count).toBeNull()
    const zero = computeInsights({ ...summary, native_detections_by_source: [source('modis-aqua-c6-standard', 'Aqua', 'modis-aqua', '0')] })
    expect(zero.total).toBe(0)
    expect(zero.lowerBound).toBe(false)
    expect(zero.sensors[0]).toMatchObject({ count: 0, lowerBound: false })
    expect(computeInsights({ ...summary, native_detections_by_source: [] }).total).toBeNull()
  })

  it('judges availability per satellite across collection changes and record spans', () => {
    const spanning = {
      ...calendar,
      periods: [
        // Aqua C6 superseded by C6.1, NOAA-21 joins on the second day: neither is missing data.
        period('2022-12-30', [['modis-aqua-c6-standard', '2'], ['modis-aqua-c61-standard', null], ['viirs-noaa21-c2-standard', null]]),
        period('2023-01-02', [['modis-aqua-c6-standard', null], ['modis-aqua-c61-standard', '1'], ['viirs-noaa21-c2-standard', '4']]),
        period('2023-01-03', [['modis-aqua-c6-standard', null], ['modis-aqua-c61-standard', null], ['viirs-noaa21-c2-standard', '3']]),
        period('2023-01-04', [['modis-aqua-c6-standard', null], ['modis-aqua-c61-standard', '0'], ['viirs-noaa21-c2-standard', '0']]),
      ],
    } as unknown as NativeCalendar
    const insights = computeInsights(summary, spanning)
    expect(insights.periods.map((p) => [p.total, p.missing])).toEqual([[2, []], [5, []], [3, ['aqua']], [0, []]])
    expect(insights.knownPeriods).toBe(4)
    expect(insights.activePeriods).toBe(3)
  })

  it('returns an empty, honest result before data loads', () => {
    const insights = computeInsights(undefined, undefined)
    expect(insights.total).toBeNull()
    expect(insights.sensors).toEqual([])
    expect(insights.peakPeriod).toBeNull()
  })
})
