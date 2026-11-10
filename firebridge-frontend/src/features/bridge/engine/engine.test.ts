import { describe, expect, it } from 'vitest'
import { availabilityFromCalendar } from './availability'
import { detectEpisodes } from './episodes'
import { toEase2 } from './geo'
import { fitGlm } from './glm'
import { compareYears, runBridge } from './index'
import { confidenceClass, prepareDetections } from './prepare'
import { circularClock, quantile, seededRandom, wilson } from './stats'
import { detection, syntheticSeasons } from '../test-fixtures'

describe('equal-area grid', () => {
  it('reproduces the published EASE-Grid 2.0 global extent', () => {
    const [x, y] = toEase2(180, 85.0445664)
    expect(x).toBeCloseTo(17_367_530.45, 1)
    expect(y).toBeCloseTo(7_314_540.83, 1)
    expect(toEase2(0, 0)).toEqual([0, 0])
  })
})

describe('statistics', () => {
  it('interpolates quantiles and bounds proportions', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5)
    expect(wilson(0, 10)![0]).toBe(0)
    const [low, high] = wilson(5, 10)!
    expect(low).toBeLessThan(0.5)
    expect(high).toBeGreaterThan(0.5)
    expect(wilson(0, 0)).toBeNull()
  })
  it('takes clock medians across midnight', () => {
    const clock = circularClock([23.5, 23.75, 0.25, 0.5, 0.0])!
    expect(Math.min(clock.median, 24 - clock.median)).toBeLessThan(0.3)
  })
  it('is reproducible with a fixed seed', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('generalised linear models', () => {
  it('recovers Poisson coefficients', () => {
    const random = seededRandom(1)
    const x: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 4000; i++) {
      const value = random() * 2
      const mu = Math.exp(-0.5 + 1.2 * value)
      // Poisson draw by inversion
      let k = 0
      let p = Math.exp(-mu)
      let cumulative = p
      const u = random()
      while (u > cumulative && k < 60) {
        k++
        p *= mu / k
        cumulative += p
      }
      x.push([1, value])
      y.push(k)
    }
    const fit = fitGlm(x, y, 'poisson', { l2: 0 })
    expect(fit.converged).toBe(true)
    expect(fit.weights[0]).toBeCloseTo(-0.5, 1)
    expect(fit.weights[1]).toBeCloseTo(1.2, 1)
  })
  it('fits a logistic slope with the right sign', () => {
    const x = Array.from({ length: 200 }, (_, i) => [1, i / 100 - 1])
    const y = x.map(([, value], i) => (value > 0 === (i % 7 !== 0) ? 1 : 0))
    expect(fitGlm(x, y, 'logistic').weights[1]).toBeGreaterThan(0)
  })
})

describe('detection preparation', () => {
  it('maps native confidence to documented classes', () => {
    expect(confidenceClass('85', 'MODIS_0_100')).toBe('high')
    expect(confidenceClass('30', 'MODIS_0_100')).toBe('nominal')
    expect(confidenceClass('29', 'MODIS_0_100')).toBe('low')
    expect(confidenceClass('h', 'VIIRS_l_n_h')).toBe('high')
    expect(confidenceClass(null, null)).toBe('unknown')
  })
  it('uses local solar time and keeps static sources out of the fire analysis', () => {
    const prepared = prepareDetections(
      [
        detection({ sourceId: 'viirs-snpp-c2-standard', acquiredAt: '2020-01-01T16:00:00Z', lon: 150, lat: -30 }),
        detection({ sourceId: 'viirs-snpp-c2-standard', acquiredAt: '2020-01-01T12:00:00Z', type: '2' }),
        detection({ sourceId: 'viirs-snpp-c2-standard', acquiredAt: 'not a date' }),
      ],
      5000,
    )
    expect(prepared.invalid).toBe(1)
    expect(prepared.all).toHaveLength(2)
    expect(prepared.observations).toHaveLength(1)
    expect(prepared.excludedNonVegetation.snpp).toBe(1)
    const east = prepared.observations[0]
    expect(east.localDate).toBe('2020-01-02')
    expect(east.lst).toBeCloseTo(2, 5)
  })
})

describe('record availability', () => {
  const day = (date: string, sources: [string, string][]) => ({
    start: `${date}T00:00:00.000Z`,
    end_exclusive: new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString(),
    counts_by_source: sources.map(([source_id, count_status]) => ({ source_id, count: count_status === 'complete' ? '0' : null, count_status })),
  })
  it('detects collection changes, joins and the processing horizon without inventing zeros', () => {
    const periods = []
    for (let t = Date.parse('2022-12-01T00:00:00Z'); t < Date.parse('2023-04-01T00:00:00Z'); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10)
      periods.push(
        day(date, [
          ['modis-aqua-c6-standard', date <= '2023-01-02' ? 'complete' : 'unknown'],
          ['modis-aqua-c61-standard', date >= '2022-12-31' && date < '2023-03-20' ? 'complete' : 'unknown'],
          ['viirs-noaa21-c2-standard', date >= '2023-02-01' && date < '2023-03-25' ? 'complete' : 'unknown'],
          ['viirs-snpp-c2-standard', date < '2023-03-25' ? 'complete' : 'unknown'],
        ]),
      )
    }
    const availability = availabilityFromCalendar(periods, '2022-12-01', '2023-04-01')
    expect(availability.events.map((e) => e.kind)).toEqual(['collection', 'joins', 'horizon'])
    expect(availability.events[0].label).toBe('Aqua MODIS C6 → C6.1')
    expect(availability.bySensor.noaa21?.['2023-01']).toBe('unknown')
    expect(availability.bySensor.noaa21?.['2023-02']).toBe('complete')
    expect(availability.bySensor.snpp?.['2023-03']).toBe('partial')
  })
})

describe('detection clusters', () => {
  it('chains detections within 2 km and 24 h and splits longer gaps', () => {
    const prepared = prepareDetections(
      [
        detection({ sourceId: 'viirs-snpp-c2-standard', acquiredAt: '2021-08-01T13:00:00Z' }),
        detection({ sourceId: 'modis-aqua-c61-standard', acquiredAt: '2021-08-01T13:20:00Z', lon: -5.51 }),
        detection({ sourceId: 'viirs-noaa20-c2-standard', acquiredAt: '2021-08-02T12:30:00Z', lon: -5.52 }),
        detection({ sourceId: 'viirs-noaa20-c2-standard', acquiredAt: '2021-08-05T12:30:00Z' }),
        detection({ sourceId: 'viirs-noaa20-c2-standard', acquiredAt: '2021-08-01T13:00:00Z', lon: -4.5 }),
      ],
      5000,
    )
    const summary = detectEpisodes(prepared.observations)
    expect(summary.count).toBe(3)
    expect(summary.top[0].detections).toBe(3)
    expect(summary.top[0].modis && summary.top[0].viirs).toBe(true)
    expect(summary.top[0].durationHours).toBeCloseTo(23.5, 5)
    expect(summary.viirsOnly).toBe(2)
    expect(summary.singletons).toBe(2)
  })
})

describe('bridge engine', () => {
  const report = runBridge({ detections: syntheticSeasons(), start: '2019-01-01', endExclusive: '2022-01-01' })

  it('describes the run reproducibly', () => {
    expect(report.meta.engine).toMatch(/^fb-bridge\//)
    expect(report.meta.grid).toBe('EPSG:6933')
    expect(report.meta.availabilitySource).toBe('detections')
    expect(report.months).toHaveLength(36)
    expect(report.sensitivity.floor).toBeGreaterThan(15)
  })

  it('decomposes the VIIRS–MODIS gap with small fires as the main factor', () => {
    const gap = report.sensitivity.gaps.find((g) => g.platform === 'snpp')!
    expect(gap.ratioDetections!).toBeGreaterThan(gap.ratioCells! - 1e-9)
    expect(gap.shares!.smallFires).toBeGreaterThan(0.5)
    const curve = report.sensitivity.curves.find((c) => c.platform === 'snpp')!
    expect(curve.bins[0].rate).toBe(0)
    expect(curve.bins.at(-1)!.rate).toBeGreaterThan(0.8)
  })

  it('withholds each year and scores every model on the revealed reference', () => {
    const replay = report.replays.find((r) => r.platform === 'snpp')!
    // Three independent seasons can be tested, but fewer than four blocks is flagged as limited.
    expect(replay.support).toBe('limited')
    expect(replay.supportReasons.join(' ')).toMatch(/3 year blocks/)
    expect(replay.blockKind).toBe('year')
    expect(replay.blocks).toBe(3)
    expect(replay.months).toHaveLength(36)
    expect(replay.scores.map((s) => s.model)).toEqual(['B0', 'B1', 'B2'])
    const b2 = replay.scores.find((s) => s.model === 'B2')!
    const b1 = replay.scores.find((s) => s.model === 'B1')!
    expect(b2.mae).toBeLessThan(b1.mae)
    expect(['B0', 'B1', 'B2']).toContain(replay.decision.model)
    expect(replay.bandK).toBeGreaterThanOrEqual(0)
  })

  it('falls back to buffered month blocks when a platform overlaps for under three years', () => {
    const replay = report.replays.find((r) => r.platform === 'noaa21')!
    expect(replay.pairedMonths).toBe(12)
    expect(replay.blockKind).toBe('month')
    expect(replay.blocks).toBe(12)
    expect(replay.support).toBe('limited')
    expect(replay.supportReasons.join(' ')).toMatch(/weaker test than withholding whole fire seasons/)
  })

  it('refuses to model a platform without enough paired support', () => {
    const tiny = runBridge({
      detections: [
        detection({ sourceId: 'viirs-snpp-c2-standard', acquiredAt: '2020-07-01T13:00:00Z' }),
        detection({ sourceId: 'modis-aqua-c61-standard', acquiredAt: '2020-07-01T13:20:00Z', confidence: '70', confidenceScheme: 'MODIS_0_100' }),
      ],
      start: '2020-07-01',
      endExclusive: '2020-08-01',
    })
    const replay = tiny.replays[0]
    expect(replay.support).toBe('insufficient')
    expect(replay.supportReasons.length).toBeGreaterThan(0)
    expect(replay.months).toEqual([])
    expect(tiny.months[0].bridge).toEqual({ value: 1, low: 1, high: 1, source: 'aqua' })
  })

  it('compares years on raw, constant-sensor and Aqua-equivalent scales', () => {
    const comparison = compareYears(report, '2019', '2021')
    expect(comparison.months).toHaveLength(12)
    expect(comparison.constantSensor).toBe('snpp')
    // NOAA-21 joins in 2021 and inflates the raw total beyond the constant-sensor change.
    expect(comparison.raw.change!).toBeGreaterThan(comparison.constant!.change!)
    expect(comparison.bridge?.observed).toBe(true)
  })
})
