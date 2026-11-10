import type { SensorKey } from '../../../lib/sensors.ts'
import type { MonthState } from './availability.ts'
import { maxFrp, type CellDay, type CellDayIndex } from './celldays.ts'
import { fitGlm, linear, type GlmFit } from './glm.ts'
import type { Observation } from './prepare.ts'
import { mean, pearson, quantile, seededRandom } from './stats.ts'

export type ModelId = 'B0' | 'B1' | 'B2'

export const MODELS: Record<ModelId, { name: string; summary: string }> = {
  B0: { name: 'Detection-count ratio', summary: 'One factor: Aqua cell-days per platform detection in the training months.' },
  B1: { name: 'Grid-cell ratio', summary: 'One factor: Aqua cell-days per platform cell-day on the common 5 km grid.' },
  B2: {
    name: 'FRP-aware cell model',
    summary: 'Poisson model of Aqua cell-days around each platform cell-day from its pixel count, peak and summed FRP, high-confidence share and neighbouring activity.',
  },
}

export const B2_FEATURES = ['intercept', 'log(1+pixels)', 'log(1+peak FRP)', 'log(1+summed FRP)', 'high-confidence share', 'log(1+active neighbours)']

export type Support = 'supported' | 'limited' | 'insufficient'

export interface ModelScore {
  model: ModelId
  mae: number
  bias: number
  r: number | null
  predictedTotal: number
  actualTotal: number
}

export interface ReplayMonth {
  month: string
  block: string
  actual: number
  platformDetections: number
  platformCellDays: number
  predicted: Record<ModelId, number>
}

export interface Decision {
  model: ModelId
  baseline: ModelId
  /** Paired block-bootstrap 90% interval of MAE(B2) − MAE(best baseline). */
  delta: { estimate: number; low: number; high: number } | null
  reason: 'improves' | 'not-distinguishable' | 'no-improvement' | 'insufficient'
}

export interface PlatformReplay {
  platform: SensorKey
  support: Support
  supportReasons: string[]
  blockKind: 'year' | 'month'
  blocks: number
  pairedMonths: number
  aquaCellDays: number
  platformCellDays: number
  months: ReplayMonth[]
  scores: ModelScore[]
  decision: Decision
  /** Final model fitted on every paired month, used for the bridge estimate. */
  final: Fitted
  /** Half-width multiplier k: band = estimate ± k·√(estimate+1), the 90th percentile of the
   *  chosen model's standardised out-of-fold errors. An empirical error range, not a guarantee. */
  bandK: number
  largestMiss: ReplayMonth | null
}

interface PlatformRow {
  cell: CellDay
  x: number[]
  y: number
}

interface MonthData {
  month: string
  aquaCells: number
  unattributed: number
  platformDetections: number
  rows: PlatformRow[]
}

function features(cell: CellDay, platform: SensorKey, neighbours: number): number[] {
  const list = cell.bySensor[platform]!
  let sum = 0
  let high = 0
  for (const o of list) {
    sum += o.frp ?? 0
    if (o.confidence === 'high') high++
  }
  return [1, Math.log1p(list.length), Math.log1p(maxFrp(list)), Math.log1p(sum), high / list.length, Math.log1p(neighbours)]
}

/** Build per-month training data for one platform: one row per platform cell-day, with the
 *  number of Aqua cell-days attributed to it (nearest platform cell within ±1 cell that day,
 *  ties to the highest FRP). Aqua cell-days with no nearby platform activity are counted as
 *  unattributed. */
function monthData(index: CellDayIndex, observations: readonly Observation[], platform: SensorKey, months: Set<string>) {
  const data = new Map<string, MonthData>()
  for (const month of months) data.set(month, { month, aquaCells: 0, unattributed: 0, platformDetections: 0, rows: [] })
  for (const o of observations) if (o.day && o.sensor === platform && months.has(o.month)) data.get(o.month)!.platformDetections++
  const rowByCell = new Map<string, PlatformRow>()
  for (const cell of index.cells.values()) {
    if (!months.has(cell.month) || !cell.bySensor[platform]) continue
    let neighbours = 0
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) if ((dx || dy) && index.get(cell.cx + dx, cell.cy + dy, cell.date)?.bySensor[platform]) neighbours++
    const row = { cell, x: features(cell, platform, neighbours), y: 0 }
    rowByCell.set(cell.key, row)
    data.get(cell.month)!.rows.push(row)
  }
  for (const cell of index.cells.values()) {
    if (!months.has(cell.month) || !cell.bySensor.aqua) continue
    const month = data.get(cell.month)!
    month.aquaCells++
    let best: PlatformRow | undefined = rowByCell.get(cell.key)
    if (!best) {
      let bestFrp = -1
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const neighbour = index.get(cell.cx + dx, cell.cy + dy, cell.date)
          const row = neighbour && rowByCell.get(neighbour.key)
          if (row) {
            const value = maxFrp(neighbour.bySensor[platform]!)
            if (value > bestFrp) {
              bestFrp = value
              best = row
            }
          }
        }
    }
    if (best) best.y++
    else month.unattributed++
  }
  return data
}

export interface Fitted {
  ratioB0: number
  ratioB1: number
  b2: GlmFit | null
  /** Per-feature [min, max] seen in training. Inputs are clamped to this support so the
   *  exponential model never extrapolates beyond the conditions it was fitted on. */
  support: [number, number][]
  residualRate: number
}

function fit(training: MonthData[], init?: readonly number[]): Fitted {
  let aqua = 0
  let detections = 0
  let cells = 0
  let unattributed = 0
  const x: number[][] = []
  const y: number[] = []
  for (const month of training) {
    aqua += month.aquaCells
    detections += month.platformDetections
    cells += month.rows.length
    unattributed += month.unattributed
    for (const row of month.rows) {
      x.push(row.x)
      y.push(row.y)
    }
  }
  const support = (x[0] ?? []).map((_, j) => x.reduce<[number, number]>(([lo, hi], row) => [Math.min(lo, row[j]), Math.max(hi, row[j])], [Infinity, -Infinity]))
  return {
    ratioB0: detections ? aqua / detections : 0,
    ratioB1: cells ? aqua / cells : 0,
    b2: x.length >= 8 ? fitGlm(x, y, 'poisson', { l2: 1, init }) : null,
    support,
    residualRate: cells ? unattributed / cells : 0,
  }
}

function cellResponse(model: Fitted, x: readonly number[]) {
  const clamped = x.map((value, j) => (model.support[j] ? Math.min(model.support[j][1], Math.max(model.support[j][0], value)) : value))
  return Math.exp(linear(model.b2!.weights, clamped))
}

function predictMonth(model: Fitted, month: MonthData): Record<ModelId, number> {
  let b2 = 0
  if (model.b2) for (const row of month.rows) b2 += cellResponse(model, row.x)
  b2 += model.residualRate * month.rows.length
  return { B0: model.ratioB0 * month.platformDetections, B1: model.ratioB1 * month.rows.length, B2: model.b2 ? b2 : model.ratioB1 * month.rows.length }
}

function score(model: ModelId, months: ReplayMonth[]): ModelScore {
  const predicted = months.map((m) => m.predicted[model])
  const actual = months.map((m) => m.actual)
  return {
    model,
    mae: mean(predicted.map((p, i) => Math.abs(p - actual[i]))),
    bias: mean(predicted.map((p, i) => p - actual[i])),
    r: pearson(predicted, actual),
    predictedTotal: predicted.reduce((a, b) => a + b, 0),
    actualTotal: actual.reduce((a, b) => a + b, 0),
  }
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1

/** Paired block bootstrap of the MAE difference between two models. */
function bootstrapDelta(months: ReplayMonth[], a: ModelId, b: ModelId, draws = 2000, seed = 20261109) {
  const blocks = new Map<string, number[]>()
  for (const m of months) {
    const delta = Math.abs(m.predicted[a] - m.actual) - Math.abs(m.predicted[b] - m.actual)
    let list = blocks.get(m.block)
    if (!list) blocks.set(m.block, (list = []))
    list.push(delta)
  }
  const groups = [...blocks.values()]
  const random = seededRandom(seed)
  const estimates: number[] = []
  for (let i = 0; i < draws; i++) {
    let sum = 0
    let n = 0
    for (let j = 0; j < groups.length; j++) {
      const group = groups[Math.floor(random() * groups.length)]
      for (const value of group) sum += value
      n += group.length
    }
    estimates.push(n ? sum / n : 0)
  }
  const all = months.map((m) => Math.abs(m.predicted[a] - m.actual) - Math.abs(m.predicted[b] - m.actual))
  return { estimate: mean(all), low: quantile(estimates, 0.05), high: quantile(estimates, 0.95) }
}

export interface ReplayOptions {
  /** Months where both Aqua and the platform have complete inventory. */
  pairedMonths: Set<string>
}

/**
 * Withheld-satellite replay. For each temporal block, Aqua is hidden: every model is fitted
 * on the other blocks only and predicts Aqua-active cell-days for the hidden block from the
 * platform's record. Predictions are then compared with the revealed Aqua record.
 * Blocks are calendar years when at least three years are paired (independent fire seasons);
 * otherwise calendar months, with the adjacent months also removed from training (a buffer
 * against multi-week fire episodes leaking across the split).
 */
export function replayPlatform(index: CellDayIndex, observations: readonly Observation[], platform: SensorKey, options: ReplayOptions): PlatformReplay {
  const paired = [...options.pairedMonths].sort()
  const data = monthData(index, observations, platform, options.pairedMonths)
  const all = paired.map((month) => data.get(month)!)
  const years = new Set(paired.map((month) => month.slice(0, 4)))
  const blockKind: 'year' | 'month' = years.size >= 3 ? 'year' : 'month'
  const blockOf = (month: string) => (blockKind === 'year' ? month.slice(0, 4) : month)
  const blocks = [...new Set(paired.map(blockOf))]
  const aquaCellDays = all.reduce((sum, m) => sum + m.aquaCells, 0)
  const platformCellDays = all.reduce((sum, m) => sum + m.rows.length, 0)
  const reasons: string[] = []
  if (paired.length < 4) reasons.push(`Only ${paired.length} month(s) have both records inventoried; at least 4 are needed.`)
  if (aquaCellDays < 10) reasons.push(`Only ${aquaCellDays} Aqua cell-days in the paired months; at least 10 are needed.`)
  if (platformCellDays < 20) reasons.push(`Only ${platformCellDays} platform cell-days in the paired months; at least 20 are needed.`)
  if (blocks.length < 2) reasons.push('At least two independent blocks are needed to withhold one.')
  let support: Support = reasons.length ? 'insufficient' : 'supported'
  if (support === 'supported') {
    if (aquaCellDays < 40) reasons.push(`${aquaCellDays} Aqua cell-days: estimates are noisy below about 40.`)
    if (blockKind === 'month') reasons.push('Fewer than three paired years: months are withheld within the same year(s), a weaker test than withholding whole fire seasons.')
    else if (blocks.length < 4) reasons.push(`${blocks.length} year blocks: few independent tests.`)
    if (reasons.length) support = 'limited'
  }
  const final = fit(all)
  const empty: PlatformReplay = {
    platform,
    support,
    supportReasons: reasons,
    blockKind,
    blocks: blocks.length,
    pairedMonths: paired.length,
    aquaCellDays,
    platformCellDays,
    months: [],
    scores: [],
    decision: { model: 'B1', baseline: 'B1', delta: null, reason: 'insufficient' },
    final,
    bandK: 0,
    largestMiss: null,
  }
  if (support === 'insufficient') return empty

  const months: ReplayMonth[] = []
  for (const block of blocks) {
    const test = all.filter((m) => blockOf(m.month) === block)
    const excluded = new Set(test.map((m) => m.month))
    if (blockKind === 'month') for (const m of test) for (const delta of [-1, 1]) excluded.add(paired.find((p) => monthIndex(p) === monthIndex(m.month) + delta) ?? '')
    const training = all.filter((m) => !excluded.has(m.month))
    const model = fit(training, final.b2?.weights)
    for (const m of test)
      months.push({ month: m.month, block, actual: m.aquaCells, platformDetections: m.platformDetections, platformCellDays: m.rows.length, predicted: predictMonth(model, m) })
  }
  months.sort((a, b) => a.month.localeCompare(b.month))
  const scores = (['B0', 'B1', 'B2'] as ModelId[]).map((model) => score(model, months))
  const byId = Object.fromEntries(scores.map((s) => [s.model, s])) as Record<ModelId, ModelScore>
  const baseline: ModelId = byId.B0.mae <= byId.B1.mae ? 'B0' : 'B1'
  let decision: Decision
  if (!final.b2) decision = { model: baseline, baseline, delta: null, reason: 'no-improvement' }
  else {
    const delta = bootstrapDelta(months, 'B2', baseline)
    if (byId.B2.mae < byId[baseline].mae && delta.high < 0) decision = { model: 'B2', baseline, delta, reason: 'improves' }
    else if (byId.B2.mae < byId[baseline].mae) decision = { model: baseline, baseline, delta, reason: 'not-distinguishable' }
    else decision = { model: baseline, baseline, delta, reason: 'no-improvement' }
  }
  const chosen = decision.model
  const standardised = months.map((m) => Math.abs(m.predicted[chosen] - m.actual) / Math.sqrt(m.predicted[chosen] + 1))
  const largestMiss = months.reduce<ReplayMonth | null>((worst, m) => (!worst || Math.abs(m.predicted[chosen] - m.actual) > Math.abs(worst.predicted[chosen] - worst.actual) ? m : worst), null)
  return { ...empty, months, scores, decision, bandK: quantile(standardised, 0.9), largestMiss }
}

/** Aqua-equivalent estimate for one month of platform data using the final chosen model. */
export function estimateMonth(replay: PlatformReplay, month: { rows: { x: number[] }[]; platformDetections: number }) {
  const { final, decision } = replay
  const cells = month.rows.length
  let value: number
  if (decision.model === 'B0') value = final.ratioB0 * month.platformDetections
  else if (decision.model === 'B1' || !final.b2) value = final.ratioB1 * cells
  else value = month.rows.reduce((sum, row) => sum + cellResponse(final, row.x), 0) + final.residualRate * cells
  const half = replay.bandK * Math.sqrt(value + 1)
  return { value, low: Math.max(0, value - half), high: value + half }
}

/** Platform rows for any set of months (paired or not), for applying the final model. */
export function platformMonths(index: CellDayIndex, observations: readonly Observation[], platform: SensorKey, months: Set<string>) {
  return monthData(index, observations, platform, months)
}

export const isComplete = (state: MonthState | undefined) => state === 'complete'
