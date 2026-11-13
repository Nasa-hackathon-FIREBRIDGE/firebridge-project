import type { SensorKey } from '../../../lib/sensors.ts'
import { classifyMonth, scoreSeries, type AnomalyKind, type AnomalyReport } from './anomaly.ts'
import type { EpisodeSummary } from './episodes.ts'
import type { Observation } from './prepare.ts'
import { circularClock, median } from './stats.ts'

/**
 * Independent scientific checks on a finished analysis. Each check asks a question whose answer
 * is known from the literature (fires burn in a season, peak in the afternoon, follow heavy-tailed
 * size distributions; more radiated energy means more vegetation burning) and answers it from this
 * analysis's own detections, so the results can be confirmed or contradicted by physics the
 * harmonization never used.
 */

// ── Statistics ─────────────────────────────────────────────────────────────────────────────────

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Distribution of the number of inversions in a random permutation of n (Mahonian numbers),
 *  as probabilities. Exact null distribution of Kendall's S without ties: S = N − 2I. */
function inversionDistribution(n: number) {
  let counts = [1]
  for (let m = 2; m <= n; m++) {
    const next = new Array<number>(counts.length + m - 1).fill(0)
    for (let k = 0; k < next.length; k++) for (let j = 0; j < m && j <= k; j++) next[k] += counts[k - j] ?? 0
    counts = next
  }
  const total = counts.reduce((a, b) => a + b, 0)
  return counts.map((c) => c / total)
}

export interface TrendTest {
  years: string[]
  values: number[]
  /** Kendall's S: concordant minus discordant pairs. */
  s: number
  tau: number
  /** Two-sided p-value: exact permutation distribution without ties (n ≤ 12), otherwise the
   *  normal approximation with tie and continuity corrections. */
  p: number
  exact: boolean
  /** Sen's slope, units per year. */
  slope: number
  /** Sen's slope relative to the median annual value. */
  relativeSlope: number | null
}

/** Mann–Kendall trend test with Sen's slope (Mann 1945; Kendall 1975; Sen 1968). */
export function mannKendall(years: readonly string[], values: readonly number[]): TrendTest | null {
  const n = values.length
  if (n < 4 || years.length !== n) return null
  let s = 0
  const slopes: number[] = []
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(values[j] - values[i])
      slopes.push((values[j] - values[i]) / (Number(years[j]) - Number(years[i])))
    }
  const pairs = (n * (n - 1)) / 2
  const groups = new Map<number, number>()
  for (const value of values) groups.set(value, (groups.get(value) ?? 0) + 1)
  const ties = [...groups.values()].filter((t) => t > 1)
  let p: number
  let exact = false
  if (!ties.length && n <= 12) {
    exact = true
    const dist = inversionDistribution(n)
    p = dist.reduce((sum, probability, inversions) => (Math.abs(pairs - 2 * inversions) >= Math.abs(s) ? sum + probability : sum), 0)
  } else {
    const variance = (n * (n - 1) * (2 * n + 5) - ties.reduce((sum, t) => sum + t * (t - 1) * (2 * t + 5), 0)) / 18
    const z = s === 0 || variance <= 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance)
    p = 2 * (1 - normalCdf(Math.abs(z)))
  }
  const slope = median(slopes)
  const middle = median(values)
  return { years: [...years], values: [...values], s, tau: s / pairs, p: Math.min(1, p), exact, slope, relativeSlope: middle > 0 ? slope / middle : null }
}

/** Rayleigh test of circular uniformity for n angles with mean resultant length r (Zar 2010, eq. 27.4). */
export function rayleighP(n: number, r: number) {
  if (n < 2) return null
  const rn = n * r
  const p = Math.exp(Math.sqrt(1 + 4 * n + 4 * (n * n - rn * rn)) - (1 + 2 * n))
  return Math.min(1, Math.max(0, p))
}

const monthAngle = (index: number) => ((index + 0.5) / 12) * 2 * Math.PI

/** Mean resultant length and mean direction (as a fractional month index) of weighted months. */
export function circularMonths(weights: readonly number[]) {
  let x = 0
  let y = 0
  let total = 0
  weights.forEach((w, i) => {
    x += w * Math.cos(monthAngle(i))
    y += w * Math.sin(monthAngle(i))
    total += w
  })
  if (total <= 0) return null
  const angle = Math.atan2(y, x)
  return { r: Math.hypot(x, y) / total, mean: (((angle / (2 * Math.PI)) * 12 - 0.5) % 12 + 12) % 12 }
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────────

export interface Seasonality {
  series: 'harmonized' | 'raw'
  /** Mean value of each calendar month over the years that have it. */
  profile: number[]
  peak: number
  /** Concentration of activity in the year: 0 spread evenly, 1 all in one month. */
  concentration: number
  /** Shortest run of consecutive calendar months holding at least 80% of the mean profile. */
  core: { start: number; length: number; share: number }
  /** Peak month of every full year (12 months on record). */
  years: { year: string; peak: number; inCore: boolean }[]
  /** Rayleigh test on the yearly peak months: is the peak's timing consistent from year to year? */
  peakTiming: { r: number; p: number | null } | null
}

export interface TimeOfDay {
  /** Aqua (early afternoon) against Terra (morning): the same MODIS instrument and pixel at a
   *  different hour, over months both fly in their original regime. */
  afternoon: { aqua: number; terra: number; ratio: number; months: number; aquaClock: number | null; terraClock: number | null } | null
  /** Detections from daytime passes, per instrument. */
  daytime: { instrument: 'MODIS' | 'VIIRS'; day: number; night: number; share: number }[]
}

export interface Intensity {
  /** Daytime detections with FRP, per instrument: how much of the radiated power the strongest
   *  tenth carries. */
  groups: { instrument: 'MODIS' | 'VIIRS'; n: number; medianFrp: number; topTenthShare: number }[]
  /** Share of detections held by the largest tenth of detection clusters. */
  clusters: { count: number; topTenthShare: number } | null
}

export interface Trends {
  /** Full calendar years shared by every series below. */
  years: string[]
  raw: TrendTest | null
  constant: (TrendTest & { sensor: SensorKey }) | null
  harmonized: TrendTest | null
}

export interface Consensus {
  z: number
  n: number
  agreeing: number
}

export interface MonthEvidence {
  month: string
  /** Daytime presumed-vegetation detections, all satellites. */
  detections: number
  /** Their summed fire radiative power, MW. */
  frp: number
  /** Distinct 5 km cells with at least one such detection. */
  cells: number
  /** Share of high-confidence detections among those with a known class. */
  highConfidence: number | null
  /** Median satellite, each against its own past same months: summed FRP (radiated energy). */
  energy: Consensus | null
  /** Median satellite, each against its own past same months: distinct cells (spatial extent). */
  extent: Consensus | null
}

export interface Robustness {
  month: string
  kind: AnomalyKind
  /** The verdict re-run with each testifying satellite withheld in turn. */
  dropOne: { tried: number; held: number; breakers: SensorKey[] }
  /** The verdict re-run at stricter and looser thresholds (spreads). */
  thresholds: { threshold: number; kind: AnomalyKind | null }[]
}

export interface FirePlace {
  cx: number
  cy: number
  lon: number
  lat: number
  /** Daytime fire cell-days in this 5 km cell. */
  cellDays: number
  /** Distinct calendar years with fire in the cell. */
  years: number
  /** Cell-days inside / outside the fire season (the four busiest calendar months). */
  season: number
  offSeason: number
}

export interface Places {
  cells: FirePlace[]
  /** The four consecutive calendar months with the most activity (0 = January). */
  seasonStart: number
  /** Years with any fire on record. */
  years: number
  /** Cells that burned in at least half of those years (and at least 3). */
  recurrent: { cells: number; cellDayShare: number; minimumYears: number } | null
  /** Off-season fire cell-days in cells that never burn in the fire season. */
  offSeasonElsewhere: { share: number; offSeasonCellDays: number } | null
}

export interface WeeklyRhythm {
  /** Detection clusters by local weekday of their first detection, Monday first. */
  counts: number[]
  chi2: number
  p: number
  quietest: number
  busiest: number
}

export interface EvidenceReport {
  centroid: { lat: number; lon: number } | null
  robustness: Robustness[]
  places: Places | null
  weekly: WeeklyRhythm | null
  seasonality: Seasonality | null
  timeOfDay: TimeOfDay
  intensity: Intensity
  trends: Trends
  months: MonthEvidence[]
}

export interface EvidenceInput {
  observations: readonly Observation[]
  months: readonly { month: string; raw: number; rawBySensor: Partial<Record<SensorKey, number>>; bridge: { value: number } | null }[]
  /** Satellites that testify, the months each is fully inventoried, and its drifted years. */
  witnesses: readonly { sensor: SensorKey; months: ReadonlySet<string>; drifted: ReadonlySet<string> }[]
  episodes: EpisodeSummary
  minimumYears: number
  anomalies?: AnomalyReport
}

const CORE_SHARE = 0.8

function seasonality(input: EvidenceInput): Seasonality | null {
  const bridged = input.months.filter((m) => m.bridge)
  const series: Seasonality['series'] = bridged.length >= 12 ? 'harmonized' : 'raw'
  const value = (m: EvidenceInput['months'][number]) => (series === 'harmonized' ? m.bridge?.value ?? null : m.raw)
  const sums = new Array<number>(12).fill(0)
  const counts = new Array<number>(12).fill(0)
  const byYear = new Map<string, (number | null)[]>()
  for (const m of input.months) {
    const v = value(m)
    const i = Number(m.month.slice(5, 7)) - 1
    const row = byYear.get(m.month.slice(0, 4)) ?? new Array<number | null>(12).fill(null)
    row[i] = v
    byYear.set(m.month.slice(0, 4), row)
    if (v === null) continue
    sums[i] += v
    counts[i]++
  }
  if (counts.filter(Boolean).length < 12) return null
  const profile = sums.map((s, i) => s / counts[i])
  const total = profile.reduce((a, b) => a + b, 0)
  const circle = circularMonths(profile)
  if (!circle || total <= 0) return null
  let core = { start: 0, length: 12, share: 1 }
  search: for (let length = 1; length <= 12; length++)
    for (let start = 0; start < 12; start++) {
      let share = 0
      for (let k = 0; k < length; k++) share += profile[(start + k) % 12] / total
      if (share >= CORE_SHARE) {
        core = { start, length, share }
        break search
      }
    }
  const inCore = (month: number) => (month - core.start + 12) % 12 < core.length
  const years = [...byYear.entries()]
    .filter(([, row]) => row.every((v) => v !== null) && row.some((v) => v! > 0))
    .map(([year, row]) => {
      const peak = row.reduce<number>((best, v, i) => (v! > row[best]! ? i : best), 0)
      return { year, peak, inCore: inCore(peak) }
    })
  const peaks = new Array<number>(12).fill(0)
  for (const y of years) peaks[y.peak]++
  const timing = years.length >= 4 ? circularMonths(peaks) : null
  return {
    series,
    profile,
    peak: profile.reduce((best, v, i) => (v > profile[best] ? i : best), 0),
    concentration: circle.r,
    core,
    years,
    peakTiming: timing ? { r: timing.r, p: rayleighP(years.length, timing.r) } : null,
  }
}

function timeOfDay(input: EvidenceInput): TimeOfDay {
  const witness = (sensor: SensorKey) => input.witnesses.find((w) => w.sensor === sensor)
  const aqua = witness('aqua')
  const terra = witness('terra')
  let afternoon: TimeOfDay['afternoon'] = null
  if (aqua && terra) {
    const months = new Set([...aqua.months].filter((m) => terra.months.has(m) && !aqua.drifted.has(m.slice(0, 4)) && !terra.drifted.has(m.slice(0, 4))))
    const pick = (sensor: SensorKey) => input.observations.filter((o) => o.sensor === sensor && o.day && months.has(o.month))
    const a = pick('aqua')
    const t = pick('terra')
    if (months.size && a.length + t.length >= 20 && t.length > 0)
      afternoon = { aqua: a.length, terra: t.length, ratio: a.length / t.length, months: months.size, aquaClock: circularClock(a.map((o) => o.lst))?.median ?? null, terraClock: circularClock(t.map((o) => o.lst))?.median ?? null }
  }
  const daytime = (['MODIS', 'VIIRS'] as const).flatMap((instrument) => {
    const list = input.observations.filter((o) => o.instrument === instrument)
    const day = list.filter((o) => o.day).length
    return list.length ? [{ instrument, day, night: list.length - day, share: day / list.length }] : []
  })
  return { afternoon, daytime }
}

/** Share of the total held by the largest tenth of the values. */
function topTenth(values: number[]) {
  const sorted = [...values].sort((a, b) => b - a)
  const total = sorted.reduce((a, b) => a + b, 0)
  if (!sorted.length || total <= 0) return null
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 10))).reduce((a, b) => a + b, 0) / total
}

function intensity(input: EvidenceInput): Intensity {
  const groups = (['MODIS', 'VIIRS'] as const).flatMap((instrument) => {
    const values = input.observations.filter((o) => o.instrument === instrument && o.day && o.frp !== null).map((o) => o.frp!)
    const share = values.length >= 20 ? topTenth(values) : null
    return share === null ? [] : [{ instrument, n: values.length, medianFrp: median(values), topTenthShare: share }]
  })
  const sizes = input.episodes.all.map((e) => e.detections)
  const share = sizes.length >= 20 ? topTenth(sizes) : null
  return { groups, clusters: share === null ? null : { count: sizes.length, topTenthShare: share } }
}

function trends(input: EvidenceInput): Trends {
  const byYear = new Map<string, EvidenceInput['months'][number][]>()
  for (const m of input.months) byYear.set(m.month.slice(0, 4), [...(byYear.get(m.month.slice(0, 4)) ?? []), m])
  const full = [...byYear.entries()].filter(([, list]) => list.length === 12)
  const harmonizedYears = full.filter(([, list]) => list.every((m) => m.bridge)).map(([year]) => year)
  const years = harmonizedYears.length >= 4 ? harmonizedYears : full.map(([year]) => year)
  const sum = (year: string, pick: (m: EvidenceInput['months'][number]) => number) => byYear.get(year)!.reduce((total, m) => total + pick(m), 0)
  const raw = mannKendall(years, years.map((year) => sum(year, (m) => m.raw)))
  const harmonized = harmonizedYears.length >= 4 && years === harmonizedYears ? mannKendall(years, years.map((year) => sum(year, (m) => m.bridge!.value))) : null
  // One satellite throughout, original orbit: the fleet cannot change under it.
  const steady = (['snpp', 'noaa20', 'aqua', 'terra'] as SensorKey[]).find((sensor) => {
    const w = input.witnesses.find((x) => x.sensor === sensor)
    return !!w && years.length > 0 && years.every((year) => !w.drifted.has(year) && byYear.get(year)!.every((m) => w.months.has(m.month)))
  })
  const constantTest = steady ? mannKendall(years, years.map((year) => sum(year, (m) => m.rawBySensor[steady] ?? 0))) : null
  return { years, raw, constant: constantTest && steady ? { ...constantTest, sensor: steady } : null, harmonized }
}

function consensus(zs: number[]): Consensus | null {
  if (zs.length < 2) return null
  const z = median(zs)
  return { z, n: zs.length, agreeing: zs.filter((x) => Math.abs(x) >= 1 && Math.sign(x) === Math.sign(z)).length }
}

function monthEvidence(input: EvidenceInput): MonthEvidence[] {
  const day = input.observations.filter((o) => o.day)
  const perMonth = new Map<string, { detections: number; frp: number; cells: Set<string>; high: number; classed: number }>()
  const perSensor = new Map<string, { frp: number; cells: Set<string> }>()
  for (const o of day) {
    const cell = `${o.cx}:${o.cy}`
    const m = perMonth.get(o.month) ?? { detections: 0, frp: 0, cells: new Set<string>(), high: 0, classed: 0 }
    m.detections++
    m.frp += o.frp ?? 0
    m.cells.add(cell)
    if (o.confidence !== 'unknown') {
      m.classed++
      if (o.confidence === 'high') m.high++
    }
    perMonth.set(o.month, m)
    const key = `${o.sensor}|${o.month}`
    const s = perSensor.get(key) ?? { frp: 0, cells: new Set<string>() }
    s.frp += o.frp ?? 0
    s.cells.add(cell)
    perSensor.set(key, s)
  }
  // Each satellite against its own past, exactly as the detection jury, on two other quantities.
  const juries = input.witnesses.map((w) => {
    const values = (pick: (s: { frp: number; cells: Set<string> } | undefined) => number) => new Map([...w.months].map((month) => [month, pick(perSensor.get(`${w.sensor}|${month}`))]))
    return {
      w,
      energy: scoreSeries(values((s) => s?.frp ?? 0), input.minimumYears, w.drifted).scores,
      extent: scoreSeries(values((s) => s?.cells.size ?? 0), input.minimumYears, w.drifted).scores,
    }
  })
  return input.months.map(({ month }) => {
    const m = perMonth.get(month)
    const counted = juries.filter((j) => j.w.months.has(month) && !j.w.drifted.has(month.slice(0, 4)))
    const zs = (pick: 'energy' | 'extent') => counted.flatMap((j) => {
      const score = j[pick].get(month)
      return score ? [score.z] : []
    })
    return {
      month,
      detections: m?.detections ?? 0,
      frp: m?.frp ?? 0,
      cells: m?.cells.size ?? 0,
      highConfidence: m && m.classed ? m.high / m.classed : null,
      energy: consensus(zs('energy')),
      extent: consensus(zs('extent')),
    }
  })
}

const THRESHOLDS = [1.5, 2, 2.5, 3]

/** Re-run every flagged verdict with one satellite withheld and at other thresholds. */
function robustness(input: EvidenceInput): Robustness[] {
  const report = input.anomalies
  if (!report) return []
  return report.months.flatMap((a): Robustness[] => {
    if (a.kind !== 'unusual-high' && a.kind !== 'unusual-low' && a.kind !== 'disputed') return []
    const scored = a.witnesses.filter((w) => w.state === 'scored' && w.score)
    const base = { harmonized: a.harmonized?.z ?? null, raw: a.raw?.z ?? null, noRecord: a.witnesses.every((w) => w.state === 'no-record') }
    const consensusOf = (list: typeof scored) => (list.length >= 2 ? median(list.map((w) => w.score!.z)) : null)
    const breakers: SensorKey[] = []
    for (const w of scored) {
      const { kind } = classifyMonth({ ...base, consensus: consensusOf(scored.filter((o) => o !== w)), threshold: report.threshold })
      if (kind !== a.kind) breakers.push(w.sensor)
    }
    return [{
      month: a.month,
      kind: a.kind,
      dropOne: { tried: scored.length, held: scored.length - breakers.length, breakers },
      thresholds: THRESHOLDS.map((threshold) => ({ threshold, kind: classifyMonth({ ...base, consensus: consensusOf(scored), threshold }).kind })),
    }]
  })
}

/** Where it burns: each 5 km cell, how many years it burned, in and out of the fire season. */
function places(input: EvidenceInput): Places | null {
  const day = input.observations.filter((o) => o.day)
  if (day.length < 20) return null
  const byMonth = new Array<number>(12).fill(0)
  const cellDays = new Set<string>()
  for (const o of day) {
    const key = `${o.cx}:${o.cy}|${o.localDate}`
    if (cellDays.has(key)) continue
    cellDays.add(key)
    byMonth[Number(o.month.slice(5, 7)) - 1]++
  }
  let seasonStart = 0
  let best = -1
  for (let start = 0; start < 12; start++) {
    const sum = [0, 1, 2, 3].reduce((total, k) => total + byMonth[(start + k) % 12], 0)
    if (sum > best) {
      best = sum
      seasonStart = start
    }
  }
  const inSeason = (month: string) => (Number(month.slice(5, 7)) - 1 - seasonStart + 12) % 12 < 4
  const cells = new Map<string, FirePlace & { yearSet: Set<string>; lonSum: number; latSum: number; n: number; days: Set<string> }>()
  for (const o of day) {
    const key = `${o.cx}:${o.cy}`
    let cell = cells.get(key)
    if (!cell) cells.set(key, (cell = { cx: o.cx, cy: o.cy, lon: 0, lat: 0, cellDays: 0, years: 0, season: 0, offSeason: 0, yearSet: new Set(), lonSum: 0, latSum: 0, n: 0, days: new Set() }))
    cell.lonSum += o.lon
    cell.latSum += o.lat
    cell.n++
    cell.yearSet.add(o.year)
    if (!cell.days.has(o.localDate)) {
      cell.days.add(o.localDate)
      cell.cellDays++
      if (inSeason(o.month)) cell.season++
      else cell.offSeason++
    }
  }
  const list: FirePlace[] = [...cells.values()].map((c) => ({ cx: c.cx, cy: c.cy, lon: c.lonSum / c.n, lat: c.latSum / c.n, cellDays: c.cellDays, years: c.yearSet.size, season: c.season, offSeason: c.offSeason }))
  const years = new Set(day.map((o) => o.year)).size
  const minimumYears = Math.max(3, Math.ceil(years / 2))
  const total = list.reduce((sum, c) => sum + c.cellDays, 0)
  const recurrentCells = list.filter((c) => c.years >= minimumYears)
  const off = list.reduce((sum, c) => sum + c.offSeason, 0)
  const offElsewhere = list.filter((c) => c.season === 0).reduce((sum, c) => sum + c.offSeason, 0)
  return {
    cells: list,
    seasonStart,
    years,
    recurrent: years >= 3 ? { cells: recurrentCells.length, cellDayShare: total ? recurrentCells.reduce((sum, c) => sum + c.cellDays, 0) / total : 0, minimumYears } : null,
    offSeasonElsewhere: off >= 10 ? { share: offElsewhere / off, offSeasonCellDays: off } : null,
  }
}

/** Chi-square survival function for 6 degrees of freedom (closed form for even df). */
const chiSquare6 = (x: number) => {
  const h = x / 2
  return Math.exp(-h) * (1 + h + (h * h) / 2)
}

/** Is there a weekly rhythm in when new fires appear? Humans keep weeks; weather does not. */
function weekly(input: EvidenceInput): WeeklyRhythm | null {
  const counts = new Array<number>(7).fill(0)
  for (const e of input.episodes.all) {
    // Local solar day of the cluster's first detection, Monday = 0.
    const local = new Date(Date.parse(e.start) + (e.lon / 15) * 3_600_000)
    counts[(local.getUTCDay() + 6) % 7]++
  }
  const n = counts.reduce((a, b) => a + b, 0)
  if (n < 70) return null
  const expected = n / 7
  const chi2 = counts.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0)
  const order = counts.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0])
  return { counts, chi2, p: chiSquare6(chi2), quietest: order[0][1], busiest: order[6][1] }
}

export function evidenceReport(input: EvidenceInput): EvidenceReport {
  const located = input.observations
  const centroid = located.length ? { lat: located.reduce((s, o) => s + o.lat, 0) / located.length, lon: located.reduce((s, o) => s + o.lon, 0) / located.length } : null
  return {
    centroid,
    robustness: robustness(input),
    places: places(input),
    weekly: weekly(input),
    seasonality: seasonality(input),
    timeOfDay: timeOfDay(input),
    intensity: intensity(input),
    trends: trends(input),
    months: monthEvidence(input),
  }
}
