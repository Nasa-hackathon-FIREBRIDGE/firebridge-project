import { describe, expect, it } from 'vitest'
import { circularMonths, mannKendall, normalCdf, rayleighP } from './evidence'
import { runBridge } from './index'
import { detection, driftingSeasons, syntheticSeasons } from '../test-fixtures'

describe('trend and circular statistics', () => {
  it('computes the exact Mann–Kendall test and Sen’s slope', () => {
    const test = mannKendall(['2019', '2020', '2021', '2022', '2023'], [10, 20, 30, 40, 50])!
    expect(test.s).toBe(10)
    expect(test.tau).toBe(1)
    expect(test.exact).toBe(true)
    // Only 1 of the 120 orderings is perfectly increasing (and 1 decreasing): p = 2/120.
    expect(test.p).toBeCloseTo(2 / 120, 6)
    expect(test.slope).toBe(10)
    expect(test.relativeSlope).toBeCloseTo(10 / 30, 6)
    expect(mannKendall(['2019', '2020', '2021'], [1, 2, 3])).toBeNull()
  })

  it('finds no trend in a flat series and falls back to the normal approximation with ties', () => {
    const flat = mannKendall(['2019', '2020', '2021', '2022', '2023', '2024'], [5, 5, 6, 5, 5, 6])!
    expect(flat.exact).toBe(false)
    expect(flat.p).toBeGreaterThan(0.3)
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4)
  })

  it('measures how concentrated activity is in the calendar year', () => {
    const july = circularMonths([0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0])!
    expect(july.r).toBeCloseTo(1, 6)
    expect(july.mean).toBeCloseTo(6, 6)
    expect(circularMonths(new Array(12).fill(1))!.r).toBeCloseTo(0, 6)
    expect(rayleighP(8, 1)!).toBeLessThan(0.001)
    expect(rayleighP(8, 0.05)!).toBeGreaterThan(0.9)
  })
})

describe('evidence report', () => {
  const report = runBridge({ detections: driftingSeasons(), start: '2019-01-01', endExclusive: '2025-01-01' })
  const { evidence } = report

  it('finds the summer fire season, replicated year after year', () => {
    const season = evidence.seasonality!
    expect(season.series).toBe('harmonized')
    expect([6, 7, 8]).toContain(season.peak)
    // July–September hold most of the activity, and every full year peaks inside that core.
    expect(season.core.length).toBeLessThanOrEqual(9)
    expect(season.years).toHaveLength(6)
    expect(season.years.every((y) => y.inCore)).toBe(true)
    expect(season.peakTiming!.p!).toBeLessThan(0.05)
  })

  it('confirms the unusual July 2022 on radiated energy and extent, not only on counts', () => {
    const july = evidence.months.find((m) => m.month === '2022-07')!
    expect(july.energy!.z).toBeGreaterThan(1)
    expect(july.extent!.z).toBeGreaterThan(1)
    expect(july.detections).toBeGreaterThan(0)
    expect(july.highConfidence).not.toBeNull()
  })

  it('tests the annual trend on the same full years for every series', () => {
    expect(evidence.trends.years).toEqual(['2019', '2020', '2021', '2022', '2023', '2024'])
    expect(evidence.trends.raw).not.toBeNull()
    expect(evidence.trends.harmonized).not.toBeNull()
    expect(evidence.trends.constant?.sensor).toBe('snpp')
  })

  it('shows the heavy tail of fire intensity and cluster size', () => {
    const viirs = evidence.intensity.groups.find((g) => g.instrument === 'VIIRS')!
    expect(viirs.topTenthShare).toBeGreaterThan(0.1)
    expect(evidence.intensity.clusters!.topTenthShare).toBeGreaterThanOrEqual(0.1)
    expect(evidence.centroid!.lat).toBeGreaterThan(34)
  })

  it('compares the morning and afternoon MODIS passes when both are on record', () => {
    const detections = [
      ...syntheticSeasons(),
      ...syntheticSeasons()
        .filter((d) => d.sourceId.startsWith('modis-aqua') && (d.frp ?? 0) >= 30)
        .map((d) => detection({ ...d, sourceId: 'modis-terra-c61-standard', acquiredAt: d.acquiredAt.replace('T13:30', 'T10:30') })),
    ]
    const withTerra = runBridge({ detections, start: '2019-01-01', endExclusive: '2022-01-01' })
    const afternoon = withTerra.evidence.timeOfDay.afternoon!
    expect(afternoon.ratio).toBeGreaterThan(1)
    expect(afternoon.terraClock!).toBeLessThan(afternoon.aquaClock!)
    expect(withTerra.evidence.timeOfDay.daytime.find((d) => d.instrument === 'MODIS')!.share).toBe(1)
  })
})

describe('robustness, places and weekly rhythm', () => {
  const report = runBridge({ detections: driftingSeasons(), start: '2019-01-01', endExclusive: '2025-01-01' })

  it('re-runs each flagged verdict under other thresholds with the same rule', () => {
    const july = report.evidence.robustness.find((r) => r.month === '2022-07')!
    expect(july.kind).toBe('unusual-high')
    expect(july.thresholds.find((t) => t.threshold === 2)!.kind).toBe('unusual-high')
    expect(july.thresholds.find((t) => t.threshold === 1.5)!.kind).toBe('unusual-high')
    // Only two satellites testify, so withholding one leaves no consensus to re-run.
    expect(july.dropOne.tried).toBe(2)
  })

  it('maps where it burns, in and out of the fire season', () => {
    const places = report.evidence.places!
    expect(places.cells.length).toBeGreaterThan(10)
    expect([5, 6]).toContain(places.seasonStart)
    expect(places.years).toBe(6)
    const total = places.cells.reduce((sum, c) => sum + c.cellDays, 0)
    expect(places.cells.reduce((sum, c) => sum + c.season + c.offSeason, 0)).toBe(total)
    expect(places.recurrent!.minimumYears).toBe(3)
  })

  it('tests the weekly rhythm of new fires', () => {
    const weekly = report.evidence.weekly!
    expect(weekly.counts).toHaveLength(7)
    expect(weekly.counts.reduce((a, b) => a + b, 0)).toBe(report.episodes.count)
    expect(weekly.p).toBeGreaterThan(0)
    expect(weekly.p).toBeLessThanOrEqual(1)
  })
})
