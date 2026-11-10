import { describe, expect, it } from 'vitest'
import { satelliteJury, scoreAgainstHistory, scoreSeries } from './anomaly'
import { runBridge } from './index'
import { nominalOverpass } from './regime'
import { driftingSeasons, syntheticSeasons } from '../test-fixtures'

const monthsOf = (years: number[]) => years.flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`))
const minutes = (hours: number) => Math.round(hours * 60)

describe('reference regime', () => {
  it('computes design-orbit overpass times that shift with latitude', () => {
    expect(minutes(nominalOverpass('aqua', 0)!)).toBe(13 * 60 + 30)
    expect(minutes(nominalOverpass('terra', 0)!)).toBe(10 * 60 + 30)
    // At 35°N the ascending Aqua pass comes earlier and the descending Terra pass later.
    expect(Math.abs(minutes(nominalOverpass('aqua', 35)!) - (13 * 60 + 7))).toBeLessThanOrEqual(1)
    expect(Math.abs(minutes(nominalOverpass('terra', 35)!) - (10 * 60 + 53))).toBeLessThanOrEqual(1)
    expect(nominalOverpass('snpp', 35)).toBeNull()
  })

  const report = runBridge({ detections: driftingSeasons(), start: '2019-01-01', endExclusive: '2025-01-01' })

  it('dates the drift onset from timestamps and keeps drifted years out of calibration', () => {
    const aqua = report.regime.orbits.find((o) => o.sensor === 'aqua')!
    expect(aqua.baselineFrom).toBe('maintained-orbit')
    expect(aqua.onset).toBe('2023')
    expect(report.regime.driftYears).toEqual(['2023', '2024'])
    const snpp = report.replays.find((r) => r.platform === 'snpp')!
    expect(snpp.pairedMonths).toBe(48)
    expect(snpp.months.every((m) => m.month < '2023')).toBe(true)
  })

  it('estimates drifted months from VIIRS and keeps the drifted observation for comparison', () => {
    const drifted = report.months.filter((m) => m.month >= '2023')
    expect(drifted.every((m) => m.referenceDrift && m.aqua !== null && m.bridge && m.bridge.source !== 'aqua')).toBe(true)
    expect(report.months.filter((m) => m.month < '2023').every((m) => m.bridge?.source === 'aqua')).toBe(true)
    // The drifted Aqua records extra afternoon fires its original pass would not have seen.
    expect(report.driftEffect!.ratio!).toBeGreaterThan(1)
  })

  it('shows the drift fingerprint: more Aqua fires that no VIIRS pass saw that day', () => {
    const { inRegime, drifted, distinguishable } = report.regime.fingerprint
    expect(drifted.share!).toBeGreaterThan(inRegime.share!)
    expect(distinguishable).toBe(true)
  })
})

describe('drift-blocked successors', () => {
  it('never calibrates a platform that only overlaps a drifted Aqua', () => {
    const late = driftingSeasons().flatMap((d) => (d.sourceId === 'viirs-snpp-c2-standard' && d.acquiredAt >= '2023' ? [d, { ...d, sourceId: 'viirs-noaa21-c2-standard' }] : [d]))
    const report = runBridge({ detections: late, start: '2019-01-01', endExclusive: '2025-01-01' })
    const noaa21 = report.replays.find((r) => r.platform === 'noaa21')!
    expect(noaa21).toMatchObject({ support: 'insufficient', driftBlocked: true, pairedMonths: 0 })
    expect(noaa21.supportReasons[0]).toMatch(/only from 2023, after Aqua's overpass drifted/)
    expect(report.handovers.some((h) => h.platform === 'noaa21')).toBe(false)
  })
})

describe('handover rehearsal', () => {
  const report = runBridge({ detections: driftingSeasons(), start: '2019-01-01', endExclusive: '2025-01-01' })
  const rehearsals = report.handovers.filter((h) => h.platform === 'snpp')

  it('fits only on months before the switch and scores only the original-regime reference', () => {
    expect(rehearsals.map((h) => h.switchMonth)).toEqual(['2021-01', '2022-01'])
    for (const h of rehearsals) {
      expect(h.training.months).toBe(h.months.filter((m) => !m.after && !m.drifted).length)
      expect(h.months.filter((m) => m.after && !m.drifted).every((m) => m.month >= h.switchMonth && m.month < '2023')).toBe(true)
      expect(h.scored.months).toBe(h.months.filter((m) => m.after && !m.drifted).length)
    }
  })

  it('shows the artificial jump of an un-harmonized switch and the bridge removing it', () => {
    for (const h of rehearsals) {
      expect(h.scored.naive / h.scored.actual).toBeGreaterThan(2)
      expect(Math.abs(Math.log(h.scored.estimate / h.scored.actual))).toBeLessThan(Math.log(1.5))
      expect(h.alarms.naive.filter((m) => !h.alarms.truth.includes(m)).length).toBeGreaterThan(h.alarms.bridged.filter((m) => !h.alarms.truth.includes(m)).length)
    }
  })

  it('needs two years of training before it rehearses', () => {
    const short = runBridge({ detections: syntheticSeasons(), start: '2019-01-01', endExclusive: '2022-01-01' })
    expect(short.handovers.every((h) => h.switchMonth === '2021-01' && h.training.months === 24)).toBe(true)
  })
})

describe('satellite jury', () => {
  const months = monthsOf([2019, 2020, 2021, 2022, 2023, 2024])
  const seasonal = (month: string) => (['07', '08', '09'].includes(month.slice(5)) ? 20 : 3)
  const series = (scale: number, tweak: Record<string, number> = {}) => new Map(months.map((m) => [m, m in tweak ? tweak[m] : Math.round(seasonal(m) * scale * (1 + 0.2 * Math.sin(Number(m.slice(0, 4)) * 7 + Number(m.slice(5)))))]))
  const allButEnd = (map: Map<string, number>) => new Map([...map].filter(([m]) => m < '2024-10'))
  const jury = satelliteJury({
    months,
    harmonized: allButEnd(series(1, { '2022-07': 140, '2020-08': 0 })),
    raw: series(12, { '2022-07': 2000, '2024-10': 0, '2024-11': 0, '2024-12': 0 }),
    witnesses: [
      { sensor: 'aqua', values: allButEnd(series(1, { '2022-07': 140, '2020-08': 0 })), drifted: new Set() },
      { sensor: 'snpp', values: allButEnd(series(5, { '2022-07': 500 })), drifted: new Set() },
      { sensor: 'noaa20', values: allButEnd(series(5, { '2022-07': 480 })), drifted: new Set() },
    ],
  })
  const at = (month: string) => jury.months.find((m) => m.month === month)!

  it('confirms an extreme month every satellite sees against its own past', () => {
    expect(at('2022-07').kind).toBe('unusual-high')
    expect(at('2022-07').consensus).toMatchObject({ n: 3, agreeing: 3 })
  })

  it('disputes a month in which only the reference is extreme, and names it', () => {
    expect(at('2020-08').kind).toBe('disputed')
    expect(at('2020-08').reason).toBe('outlier')
    expect(at('2020-08').outlier).toBe('aqua')
  })

  it('calls an empty archive an artifact, never an unusually quiet month', () => {
    expect(at('2024-11')).toMatchObject({ kind: 'artifact', reason: 'no-record', harmonized: null })
    expect(at('2024-11').witnesses.every((w) => w.state === 'no-record')).toBe(true)
    expect(jury.months.filter((m) => m.kind === 'unusual-low')).toHaveLength(0)
  })

  it('needs four other years before scoring and never uses drifted years as a baseline', () => {
    const short = scoreSeries(new Map(monthsOf([2021, 2022, 2023, 2024]).map((m) => [m, 5])))
    expect(short.scores.size).toBe(0)
    const values = new Map(monthsOf([2018, 2019, 2020, 2021, 2022, 2023]).map((m) => [m, m.startsWith('2023') ? 50 : 5]))
    const withDrift = scoreSeries(values, 4, new Set(['2023']))
    expect(withDrift.scores.get('2021-07')!.usual).toBeCloseTo(5, 5)
    // The drifted year is still shown against the original-regime years, and does not widen the spread.
    expect(withDrift.scores.get('2023-07')).toMatchObject({ value: 50, years: 5 })
    expect(withDrift.scores.get('2023-07')!.usual).toBeCloseTo(5, 5)
    expect(withDrift.sigma).toBe(0)
  })

  it('scores new months against a fixed history', () => {
    const history = new Map(monthsOf([2019, 2020]).map((m) => [m, seasonal(m) * (m.startsWith('2020') ? 1.4 : 1)]))
    const scores = scoreAgainstHistory(history, new Map([['2021-07', 60], ['2021-02', 3]]))
    expect(scores.get('2021-07')!.z).toBeGreaterThan(scores.get('2021-02')!.z)
  })
})
