import type { SensorKey } from '../../../lib/sensors.ts'
import { ANOMALY_THRESHOLD, scoreAgainstHistory } from './anomaly.ts'
import type { CellDayIndex } from './celldays.ts'
import type { Observation } from './prepare.ts'
import { evaluate, fit, platformMonths, predictMonth, type Decision, type ModelId } from './replay.ts'

export interface HandoverMonth {
  month: string
  /** Observed Aqua-active cell-days. Months with a drifted reference are shown, never scored. */
  actual: number
  /** The same counting rule applied to the successor platform, without calibration. */
  naive: number
  estimate: number
  low: number
  high: number
  after: boolean
  drifted: boolean
}

export interface HandoverWindow {
  months: number
  actual: number
  naive: number
  estimate: number
  low: number
  high: number
  /** Months whose observed value fell inside the estimate's empirical range. */
  covered: number
}

export interface Handover {
  platform: SensorKey
  /** First month treated as having no reference record. */
  switchMonth: string
  training: { months: number; years: number; aquaCellDays: number }
  model: ModelId
  reason: Decision['reason']
  bandK: number
  months: HandoverMonth[]
  /** The first twelve scored months after the switch (fewer at the end of the overlap). */
  firstYear: HandoverWindow
  /** Every month after the switch in which Aqua still flew in its original regime. */
  scored: HandoverWindow
  /** Months after the switch flagged as unusually high against the pre-switch history, as an
   *  analyst would read each record: the true reference, the un-harmonized successor, the bridge. */
  alarms: { truth: string[]; naive: string[]; bridged: string[] }
}

export const HANDOVER_MIN_TRAINING_MONTHS = 24
export const HANDOVER_MIN_SCORED_MONTHS = 6

function windowOf(months: readonly HandoverMonth[]): HandoverWindow {
  const sum = (pick: (m: HandoverMonth) => number) => months.reduce((total, m) => total + pick(m), 0)
  return {
    months: months.length,
    actual: sum((m) => m.actual),
    naive: sum((m) => m.naive),
    estimate: sum((m) => m.estimate),
    low: sum((m) => m.low),
    high: sum((m) => m.high),
    covered: months.filter((m) => m.actual >= m.low && m.actual <= m.high).length,
  }
}

/**
 * Handover rehearsal (the blueprint's synthetic instrument switch). The reference is switched
 * off on 1 January of a year inside the overlap. The model ladder is evaluated, chosen and
 * fitted on the months before the switch only, exactly as it would be on the real day, then
 * continues the record from the successor platform. Months after the switch in which Aqua
 * actually kept flying in its original regime are the answer key. Unlike the withheld-satellite
 * replay, nothing from the future informs the model.
 */
export function rehearseHandovers(index: CellDayIndex, observations: readonly Observation[], platform: SensorKey, inRegime: readonly string[], drifted: readonly string[]): Handover[] {
  const months = [...new Set([...inRegime, ...drifted])].sort()
  const regime = new Set(inRegime)
  const data = platformMonths(index, observations, platform, new Set(months))
  const all = months.map((month) => data.get(month)!)
  const out: Handover[] = []
  for (const year of [...new Set(inRegime.map((m) => m.slice(0, 4)))].sort().slice(1)) {
    const switchMonth = `${year}-01`
    const training = all.filter((m) => regime.has(m.month) && m.month < switchMonth)
    const scoredCount = all.filter((m) => regime.has(m.month) && m.month >= switchMonth).length
    const trainingYears = new Set(training.map((m) => m.month.slice(0, 4))).size
    const aquaCellDays = training.reduce((sum, m) => sum + m.aquaCells, 0)
    if (training.length < HANDOVER_MIN_TRAINING_MONTHS || trainingYears < 2 || aquaCellDays < 10 || scoredCount < HANDOVER_MIN_SCORED_MONTHS) continue
    const model = fit(training)
    const evaluation = evaluate(training, model.b2?.weights)
    const chosen = evaluation.decision.model
    const series: HandoverMonth[] = all.map((m) => {
      const isDrifted = !regime.has(m.month)
      if (m.month < switchMonth) return { month: m.month, actual: m.aquaCells, naive: m.aquaCells, estimate: m.aquaCells, low: m.aquaCells, high: m.aquaCells, after: false, drifted: isDrifted }
      const estimate = predictMonth(model, m)[chosen]
      const half = evaluation.bandK * Math.sqrt(estimate + 1)
      return { month: m.month, actual: m.aquaCells, naive: m.rows.length, estimate, low: Math.max(0, estimate - half), high: estimate + half, after: true, drifted: isDrifted }
    })
    const scored = series.filter((m) => m.after && !m.drifted)
    const history = new Map(series.filter((m) => !m.after && !m.drifted).map((m) => [m.month, m.actual]))
    const flagged = (pick: (m: HandoverMonth) => number) =>
      [...scoreAgainstHistory(history, new Map(scored.map((m) => [m.month, pick(m)])))].filter(([, score]) => score.z >= ANOMALY_THRESHOLD).map(([month]) => month)
    out.push({
      platform,
      switchMonth,
      training: { months: training.length, years: trainingYears, aquaCellDays },
      model: chosen,
      reason: evaluation.decision.reason,
      bandK: evaluation.bandK,
      months: series,
      firstYear: windowOf(scored.slice(0, 12)),
      scored: windowOf(scored),
      alarms: { truth: flagged((m) => m.actual), naive: flagged((m) => m.naive), bridged: flagged((m) => m.estimate) },
    })
  }
  return out
}
