import type { SensorKey } from '../../../lib/sensors.ts'
import { median } from './stats.ts'

export interface SeriesScore {
  value: number
  /** Typical value for this calendar month in the other years: back-transformed mean of log(1 + x). */
  usual: number
  /** Deviation of log(1 + value) from that mean, in units of the series' pooled spread. */
  z: number
  /** Other years compared. */
  years: number
}

export type WitnessState = 'scored' | 'drifted' | 'no-record' | 'too-new'

export interface Witness {
  sensor: SensorKey
  state: WitnessState
  score: SeriesScore | null
}

export type AnomalyKind = 'unusual-high' | 'unusual-low' | 'disputed' | 'artifact'

export interface MonthAnomaly {
  month: string
  /** The harmonized (Aqua-equivalent) record against its own other years. */
  harmonized: SeriesScore | null
  /** All native detections of every satellite, as a naive total would be read. */
  raw: SeriesScore | null
  witnesses: Witness[]
  /** Median z of the satellites that testify (scored, original overpass regime): with three or
   *  more witnesses, one contradicting satellite cannot carry the verdict on its own. */
  consensus: { z: number; n: number; agreeing: number } | null
  kind: AnomalyKind | null
  /** disputed: 'outlier' when one satellite contradicts the others, 'unconfirmed' when fewer than
   *  two can testify. artifact: 'no-record' when no satellite has a record, else 'fleet-change'. */
  reason: 'outlier' | 'unconfirmed' | 'no-record' | 'fleet-change' | null
  /** The testifying satellite furthest from the rest, when it stands at least 2 apart. */
  outlier: SensorKey | null
}

export interface AnomalyReport {
  threshold: number
  minimumYears: number
  sigma: { harmonized: number | null; raw: number | null; witnesses: Partial<Record<SensorKey, number>> }
  months: MonthAnomaly[]
}

export interface WitnessInput {
  sensor: SensorKey
  /** Daytime active cell-days in months the sensor is fully inventoried. */
  values: ReadonlyMap<string, number>
  /** Years outside the sensor's original overpass regime: shown, never used as a baseline or counted. */
  drifted: ReadonlySet<string>
}

export const ANOMALY_THRESHOLD = 2
export const ANOMALY_MINIMUM_YEARS = 4

/**
 * Score each month against the same calendar month in the other years of one series, on a
 * log(1 + x) scale. The spread is pooled across all scored months of the series, because a
 * handful of years cannot estimate a per-month spread. Years in `exclude` are scored for
 * display but never serve as a baseline or inform the spread.
 */
export function scoreSeries(values: ReadonlyMap<string, number>, minimumYears = ANOMALY_MINIMUM_YEARS, exclude: ReadonlySet<string> = new Set()) {
  const byCalendar = new Map<string, [string, number][]>()
  for (const [month, value] of values) {
    if (exclude.has(month.slice(0, 4))) continue
    const key = month.slice(5, 7)
    const list = byCalendar.get(key) ?? []
    list.push([month.slice(0, 4), Math.log1p(value)])
    byCalendar.set(key, list)
  }
  const rows: { month: string; value: number; mean: number; years: number; baseline: boolean }[] = []
  for (const [month, value] of values) {
    const others = (byCalendar.get(month.slice(5, 7)) ?? []).filter(([year]) => year !== month.slice(0, 4))
    if (others.length < minimumYears) continue
    rows.push({ month, value, mean: others.reduce((sum, [, v]) => sum + v, 0) / others.length, years: others.length, baseline: !exclude.has(month.slice(0, 4)) })
  }
  const pooled = rows.filter((r) => r.baseline)
  const sigma = pooled.length ? Math.sqrt(pooled.reduce((sum, r) => sum + (Math.log1p(r.value) - r.mean) ** 2, 0) / pooled.length) : null
  const scores = new Map<string, SeriesScore>()
  for (const r of rows) scores.set(r.month, { value: r.value, usual: Math.expm1(r.mean), z: sigma ? (Math.log1p(r.value) - r.mean) / sigma : 0, years: r.years })
  return { scores, sigma }
}

const sameSide = (a: number, b: number) => Math.sign(a) === Math.sign(b)

/**
 * The satellite jury. Each satellite judges a month only against its own past, so differences
 * in sensitivity between satellites cancel out; agreement between independent instruments is
 * the evidence. A month is unusual when the median testifying satellite places it beyond the
 * threshold, or when the harmonized record does and the satellites lean the same way. It is
 * disputed when the harmonized record is extreme but the satellites do not back it, and an
 * artifact when only the raw all-satellite total is extreme.
 */
export function satelliteJury(input: { months: readonly string[]; harmonized: ReadonlyMap<string, number>; raw: ReadonlyMap<string, number>; witnesses: readonly WitnessInput[] }, threshold = ANOMALY_THRESHOLD, minimumYears = ANOMALY_MINIMUM_YEARS): AnomalyReport {
  const harmonized = scoreSeries(input.harmonized, minimumYears)
  const raw = scoreSeries(input.raw, minimumYears)
  const witnesses = input.witnesses.map((w) => ({ ...w, ...scoreSeries(w.values, minimumYears, w.drifted) }))
  const months = input.months.map((month): MonthAnomaly => {
    const year = month.slice(0, 4)
    const testimony: Witness[] = witnesses.map((w) => {
      if (!w.values.has(month)) return { sensor: w.sensor, state: 'no-record', score: null }
      const score = w.scores.get(month) ?? null
      if (!score) return { sensor: w.sensor, state: 'too-new', score: null }
      return { sensor: w.sensor, state: w.drifted.has(year) ? 'drifted' : 'scored', score }
    })
    const counted = testimony.filter((w) => w.state === 'scored').map((w) => ({ sensor: w.sensor, z: w.score!.z }))
    const middle = counted.length ? median(counted.map((w) => w.z)) : null
    const consensus = middle === null ? null : { z: middle, n: counted.length, agreeing: counted.filter((w) => Math.abs(w.z) >= 1 && sameSide(w.z, middle)).length }
    let outlier: SensorKey | null = null
    if (counted.length >= 3) {
      let worst = 0
      for (const w of counted) {
        const rest = counted.filter((o) => o !== w)
        const distance = Math.abs(w.z - rest.reduce((sum, o) => sum + o.z, 0) / rest.length)
        if (distance >= 2 && distance > worst) {
          worst = distance
          outlier = w.sensor
        }
      }
    }
    const H = harmonized.scores.get(month)?.z ?? null
    const C = consensus && consensus.n >= 2 ? consensus.z : null
    const R = raw.scores.get(month)?.z ?? null
    let kind: AnomalyKind | null = null
    let reason: MonthAnomaly['reason'] = null
    if (C !== null && Math.abs(C) >= threshold && (H === null || sameSide(H, C) || Math.abs(H) < 1)) kind = C > 0 ? 'unusual-high' : 'unusual-low'
    else if (H !== null && Math.abs(H) >= threshold && C !== null && Math.abs(C) >= 1 && sameSide(H, C)) kind = H > 0 ? 'unusual-high' : 'unusual-low'
    else if (H !== null && Math.abs(H) >= threshold) {
      kind = 'disputed'
      reason = C === null ? 'unconfirmed' : 'outlier'
    } else if (R !== null && Math.abs(R) >= threshold && (C === null || Math.abs(C) < 1 || !sameSide(R, C))) {
      kind = 'artifact'
      reason = testimony.every((w) => w.state === 'no-record') ? 'no-record' : 'fleet-change'
    }
    return { month, harmonized: harmonized.scores.get(month) ?? null, raw: raw.scores.get(month) ?? null, witnesses: testimony, consensus, kind, reason, outlier: kind === 'disputed' ? outlier : null }
  })
  return {
    threshold,
    minimumYears,
    sigma: { harmonized: harmonized.sigma, raw: raw.sigma, witnesses: Object.fromEntries(witnesses.map((w) => [w.sensor, w.sigma ?? undefined])) },
    months,
  }
}

/**
 * Score new months against a fixed history, as an analyst would after a change: each candidate is
 * compared with the same calendar month in the history years, on the log(1 + x) scale, using the
 * history's own pooled leave-one-year-out spread. Months whose calendar month has fewer than
 * `minimumYears` history years are not scored.
 */
export function scoreAgainstHistory(history: ReadonlyMap<string, number>, candidates: ReadonlyMap<string, number>, minimumYears = 2) {
  const byCalendar = new Map<string, [string, number][]>()
  for (const [month, value] of history) {
    const list = byCalendar.get(month.slice(5, 7)) ?? []
    list.push([month.slice(0, 4), Math.log1p(value)])
    byCalendar.set(month.slice(5, 7), list)
  }
  const deviations: number[] = []
  for (const [month, value] of history) {
    const others = (byCalendar.get(month.slice(5, 7)) ?? []).filter(([year]) => year !== month.slice(0, 4))
    if (others.length) deviations.push(Math.log1p(value) - others.reduce((sum, [, v]) => sum + v, 0) / others.length)
  }
  const sigma = deviations.length ? Math.sqrt(deviations.reduce((sum, d) => sum + d * d, 0) / deviations.length) : 0
  const scores = new Map<string, SeriesScore>()
  for (const [month, value] of candidates) {
    const years = byCalendar.get(month.slice(5, 7)) ?? []
    if (years.length < minimumYears || !sigma) continue
    const mean = years.reduce((sum, [, v]) => sum + v, 0) / years.length
    scores.set(month, { value, usual: Math.expm1(mean), z: (Math.log1p(value) - mean) / sigma, years: years.length })
  }
  return scores
}
