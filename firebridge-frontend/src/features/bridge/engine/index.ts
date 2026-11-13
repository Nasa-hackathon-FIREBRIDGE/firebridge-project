import { SENSORS, type SensorKey } from '../../../lib/sensors.ts'
import { availabilityFromCalendar, availabilityFromDetections, type Availability, type CalendarPeriodInput, type MonthState } from './availability.ts'
import { satelliteJury, type AnomalyReport } from './anomaly.ts'
import { CellDayIndex } from './celldays.ts'
import { driftFingerprint, type DriftFingerprint } from './drift.ts'
import { detectEpisodes, type EpisodeSummary } from './episodes.ts'
import { evidenceReport, type EvidenceReport } from './evidence.ts'
import { GRID_CRS } from './geo.ts'
import { rehearseHandovers, type Handover } from './handover.ts'
import { prepareDetections, type Observation, type RawDetection } from './prepare.ts'
import { orbitDrift, overpassRegime, pairTiming, type Drift, type OrbitDrift, type OverpassRow, type PairTiming } from './regime.ts'
import { estimateMonth, isComplete, platformMonths, replayPlatform, type PlatformReplay } from './replay.ts'
import { sensitivity, type GapDecomposition, type Sensitivity } from './sensitivity.ts'

export const ENGINE_VERSION = 'fb-bridge/1.1.0'
/** A reference pass more than this far from Aqua's maintained-orbit overpass time is outside the
 *  reference regime: the same tolerance the blueprint proposes for pairing near-simultaneous passes. */
export const REFERENCE_DRIFT_MINUTES = 30
const WITNESSES: SensorKey[] = ['aqua', 'terra', 'snpp', 'noaa20', 'noaa21']
export const VIIRS_PLATFORMS: SensorKey[] = ['snpp', 'noaa20', 'noaa21']

export interface BridgeInput {
  detections: readonly RawDetection[]
  start: string
  endExclusive: string
  calendar?: readonly CalendarPeriodInput[]
}

export interface BridgeOptions {
  cellSize?: number
  episodeLinkMetres?: number
  episodeLinkHours?: number
}

export interface Estimate {
  value: number
  low: number
  high: number
}

export interface BridgeMonth {
  month: string
  /** Observed Aqua-active cell-days (daytime, presumed vegetation) when Aqua is inventoried. */
  aqua: number | null
  aquaState: MonthState
  /** Aqua is inventoried but passes outside its original overpass regime this year. */
  referenceDrift: boolean
  estimates: Partial<Record<SensorKey, Estimate>>
  /** The harmonized value: observed Aqua inside its original regime; otherwise (drifted or
   *  missing reference) the best supported VIIRS estimate; drifted Aqua only as a last resort. */
  bridge: (Estimate & { source: SensorKey }) | null
  /** All native detections in the UTC month, every sensor and type (matches the calendar). */
  raw: number
  rawBySensor: Partial<Record<SensorKey, number>>
}

export interface BridgeYear {
  year: string
  monthsInWindow: number
  monthsBridged: number
  partial: boolean
  raw: number
  rawBySensor: Partial<Record<SensorKey, number>>
  bridge: Estimate | null
  observedShare: number | null
}

export interface BridgeReport {
  meta: {
    engine: string
    grid: string
    cellSizeMetres: number
    regime: string
    start: string
    endExclusive: string
    detections: number
    analysedDetections: number
    excludedNonVegetation: Partial<Record<SensorKey, number>>
    invalid: number
    availabilitySource: 'calendar' | 'detections'
    elapsedMs: number
  }
  availability: Availability
  platforms: SensorKey[]
  regime: {
    rows: OverpassRow[]
    drift: Drift[]
    timing: PairTiming[]
    /** Aqua's maintained-orbit overpass time (local solar hours). */
    referenceBaseline: number | null
    /** Years Aqua spends outside its original regime: excluded from calibration and estimated. */
    driftYears: string[]
    orbits: OrbitDrift[]
    fingerprint: DriftFingerprint
  }
  sensitivity: Sensitivity
  replays: PlatformReplay[]
  /** Handover rehearsals for every supported platform, by switch year. */
  handovers: Handover[]
  /** Observed (drifted) Aqua against the original-regime estimate in the drifted years. */
  driftEffect: DriftEffect | null
  months: BridgeMonth[]
  years: BridgeYear[]
  anomalies: AnomalyReport
  episodes: EpisodeSummary
  headline: GapDecomposition | null
  /** Independent scientific checks: season, time of day, intensity, trends, per-month energy and extent. */
  evidence: EvidenceReport
}

export interface DriftEffect {
  years: { year: string; months: number; observed: number; estimate: Estimate }[]
  observed: number
  estimate: Estimate
  /** observed / estimate: how much more (or less) the drifted Aqua records than it would have. */
  ratio: number | null
  sources: SensorKey[]
}

const utcMonth = (o: Observation) => new Date(o.t).toISOString().slice(0, 7)
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function analyzeBridge(input: BridgeInput, options: BridgeOptions = {}): BridgeReport {
  const cellSize = options.cellSize ?? 5000
  const prepared = prepareDetections(input.detections, cellSize)
  const observations = prepared.observations
  let availability: Availability
  let availabilitySource: 'calendar' | 'detections' = 'calendar'
  if (input.calendar?.length) availability = availabilityFromCalendar(input.calendar, input.start, input.endExclusive)
  else {
    availabilitySource = 'detections'
    const seen = new Map<SensorKey, Set<string>>()
    for (const o of prepared.all) {
      let set = seen.get(o.sensor)
      if (!set) seen.set(o.sensor, (set = new Set()))
      set.add(utcMonth(o))
    }
    availability = availabilityFromDetections(seen, input.start, input.endExclusive)
  }
  const state = (sensor: SensorKey, month: string): MonthState => availability.bySensor[sensor]?.[month] ?? 'unknown'
  const platforms = VIIRS_PLATFORMS.filter((p) => availability.bySensor[p] && Object.values(availability.bySensor[p]!).some(isComplete))
  const windowYears = [...new Set(availability.months.map((m) => m.slice(0, 4)))]

  const index = new CellDayIndex(observations)
  const regime = overpassRegime(observations)
  const timing = pairTiming(index, platforms)
  const orbits = (['aqua', 'terra'] as SensorKey[]).map((sensor) => orbitDrift(observations, regime.rows, sensor, windowYears, REFERENCE_DRIFT_MINUTES))
  const aquaOrbit = orbits[0]
  const referenceBaseline = aquaOrbit.baseline
  const driftYears = aquaOrbit.years
  const drifted = new Set(driftYears)
  // Calibration only ever sees Aqua inside its original overpass regime.
  const inRegime = (month: string) => isComplete(state('aqua', month)) && !drifted.has(month.slice(0, 4))
  const paired = (platform: SensorKey) => new Set(availability.months.filter((m) => inRegime(m) && isComplete(state(platform, m))))
  const driftedPaired = (platform: SensorKey) => availability.months.filter((m) => isComplete(state('aqua', m)) && drifted.has(m.slice(0, 4)) && isComplete(state(platform, m)))

  const sense = sensitivity(observations, index, platforms, paired)
  const clock = (hours: number) => {
    const minutes = Math.round(hours * 60)
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  const replays = platforms.map((platform) => {
    const replay = replayPlatform(index, observations, platform, { pairedMonths: paired(platform) })
    if (replay.support === 'insufficient' && replay.pairedMonths < 4 && driftedPaired(platform).length && aquaOrbit.onset && referenceBaseline !== null) {
      replay.driftBlocked = true
      replay.supportReasons = [
        `${SENSORS[platform].label} overlaps Aqua here only from ${aquaOrbit.onset}, after Aqua's overpass drifted away from its original ${clock(referenceBaseline)}. Calibrating against a drifted reference would build the drift into the bridge, so ${SENSORS[platform].label} is not calibrated. A window that includes years before ${aquaOrbit.onset} allows it.`,
      ]
    }
    return replay
  })
  const handovers = replays.filter((r) => r.support !== 'insufficient').flatMap((r) => rehearseHandovers(index, observations, r.platform, [...paired(r.platform)].sort(), driftedPaired(r.platform)))
  const fingerprint = driftFingerprint(index, VIIRS_PLATFORMS, (month) => isComplete(state('aqua', month)) && VIIRS_PLATFORMS.some((p) => isComplete(state(p, month))), drifted, (platform, month) => isComplete(state(platform, month)), availability.months)

  // Apply each supported platform's final model to every month it is inventoried.
  const estimates = new Map<SensorKey, Map<string, ReturnType<typeof estimateMonth>>>()
  for (const replay of replays) {
    if (replay.support === 'insufficient') continue
    const months = new Set(availability.months.filter((m) => isComplete(state(replay.platform, m))))
    const data = platformMonths(index, observations, replay.platform, months)
    estimates.set(replay.platform, new Map([...data].map(([month, value]) => [month, estimateMonth(replay, value)])))
  }
  const ranked = replays
    .filter((r) => r.support !== 'insufficient' && r.scores.length)
    .map((r) => {
      const chosen = r.scores.find((s) => s.model === r.decision.model)!
      return { platform: r.platform, relative: chosen.actualTotal > 0 ? chosen.mae / (chosen.actualTotal / r.months.length) : Infinity }
    })
    .sort((a, b) => a.relative - b.relative)
    .map((r) => r.platform)

  const aquaByMonth = new Map<string, number>()
  for (const cell of index.cells.values()) if (cell.bySensor.aqua) aquaByMonth.set(cell.month, (aquaByMonth.get(cell.month) ?? 0) + 1)
  const rawByMonth = new Map<string, Partial<Record<SensorKey, number>>>()
  for (const o of prepared.all) {
    const month = utcMonth(o)
    const entry = rawByMonth.get(month) ?? {}
    entry[o.sensor] = (entry[o.sensor] ?? 0) + 1
    rawByMonth.set(month, entry)
  }
  const months: BridgeMonth[] = availability.months.map((month) => {
    const aquaState = state('aqua', month)
    const aqua = isComplete(aquaState) ? aquaByMonth.get(month) ?? 0 : null
    const referenceDrift = aqua !== null && drifted.has(month.slice(0, 4))
    const monthEstimates: BridgeMonth['estimates'] = {}
    for (const [platform, byMonth] of estimates) {
      const estimate = byMonth.get(month)
      if (estimate) monthEstimates[platform] = estimate
    }
    const best = ranked.find((platform) => monthEstimates[platform])
    const rawBySensor = rawByMonth.get(month) ?? {}
    const observed = aqua !== null ? { value: aqua, low: aqua, high: aqua, source: 'aqua' as SensorKey } : null
    return {
      month,
      aqua,
      aquaState,
      referenceDrift,
      estimates: monthEstimates,
      bridge: observed && !referenceDrift ? observed : best ? { ...monthEstimates[best]!, source: best } : observed,
      raw: Object.values(rawBySensor).reduce((a, b) => a + (b ?? 0), 0),
      rawBySensor,
    }
  })

  let driftEffect: DriftEffect | null = null
  const corrected = months.filter((m) => m.referenceDrift && m.bridge && m.bridge.source !== 'aqua')
  if (corrected.length) {
    const sum = (list: BridgeMonth[], pick: (m: BridgeMonth) => number) => list.reduce((total, m) => total + pick(m), 0)
    const estimateOf = (list: BridgeMonth[]): Estimate => ({ value: sum(list, (m) => m.bridge!.value), low: sum(list, (m) => m.bridge!.low), high: sum(list, (m) => m.bridge!.high) })
    const byYear = [...new Set(corrected.map((m) => m.month.slice(0, 4)))].map((year) => {
      const list = corrected.filter((m) => m.month.startsWith(year))
      return { year, months: list.length, observed: sum(list, (m) => m.aqua!), estimate: estimateOf(list) }
    })
    const estimate = estimateOf(corrected)
    const observed = sum(corrected, (m) => m.aqua!)
    driftEffect = { years: byYear, observed, estimate, ratio: estimate.value > 0 ? observed / estimate.value : null, sources: [...new Set(corrected.map((m) => m.bridge!.source))] }
  }

  // Satellite jury: each sensor's own daytime cell-days in the months it is fully inventoried.
  const cellDays = new Map<string, number>()
  for (const cell of index.cells.values()) for (const sensor of Object.keys(cell.bySensor)) cellDays.set(`${sensor}|${cell.month}`, (cellDays.get(`${sensor}|${cell.month}`) ?? 0) + 1)
  const witnesses = WITNESSES.filter((sensor) => availability.bySensor[sensor]).map((sensor) => ({
    sensor,
    months: new Set(availability.months.filter((m) => isComplete(state(sensor, m)))),
    drifted: new Set(orbits.find((o) => o.sensor === sensor)?.years ?? []),
  }))
  const anomalies = satelliteJury({
    months: availability.months,
    harmonized: new Map(months.filter((m) => m.bridge).map((m) => [m.month, m.bridge!.value])),
    raw: new Map(months.map((m) => [m.month, m.raw])),
    witnesses: witnesses.map((w) => ({ sensor: w.sensor, values: new Map([...w.months].map((m) => [m, cellDays.get(`${w.sensor}|${m}`) ?? 0])), drifted: w.drifted })),
  })

  const years: BridgeYear[] = []
  for (const year of [...new Set(months.map((m) => m.month.slice(0, 4)))]) {
    const list = months.filter((m) => m.month.startsWith(year))
    const bridged = list.filter((m) => m.bridge)
    const rawBySensor: Partial<Record<SensorKey, number>> = {}
    for (const m of list) for (const [sensor, value] of Object.entries(m.rawBySensor) as [SensorKey, number][]) rawBySensor[sensor] = (rawBySensor[sensor] ?? 0) + value
    const sum = (pick: (e: Estimate) => number) => bridged.reduce((total, m) => total + pick(m.bridge!), 0)
    years.push({
      year,
      monthsInWindow: list.length,
      monthsBridged: bridged.length,
      partial: list.length < 12 || bridged.length < list.length,
      raw: list.reduce((total, m) => total + m.raw, 0),
      rawBySensor,
      bridge: bridged.length ? { value: sum((e) => e.value), low: sum((e) => e.low), high: sum((e) => e.high) } : null,
      observedShare: bridged.length ? bridged.filter((m) => m.bridge!.source === 'aqua').length / bridged.length : null,
    })
  }

  const episodes = detectEpisodes(observations, options.episodeLinkMetres, options.episodeLinkHours)
  if (sense.floor !== null) episodes.viirsOnlyBelowFloor = episodes.all.filter((e) => e.viirs && !e.modis && (e.maxFrp ?? 0) < sense.floor!).length
  const headline = sense.gaps.filter((g) => g.shares).sort((a, b) => b.platformCellDays - a.platformCellDays)[0] ?? null
  const evidence = evidenceReport({ observations, months, witnesses, episodes, minimumYears: anomalies.minimumYears, anomalies })
  return {
    meta: {
      engine: ENGINE_VERSION,
      grid: GRID_CRS,
      cellSizeMetres: cellSize,
      regime: 'Daytime (afternoon) passes; presumed-vegetation detections (FIRMS type 0)',
      start: input.start,
      endExclusive: input.endExclusive,
      detections: input.detections.length,
      analysedDetections: observations.length,
      excludedNonVegetation: prepared.excludedNonVegetation,
      invalid: prepared.invalid,
      availabilitySource,
      elapsedMs: 0,
    },
    availability,
    platforms,
    regime: { ...regime, timing, referenceBaseline, driftYears, orbits, fingerprint },
    sensitivity: sense,
    replays,
    handovers,
    driftEffect,
    months,
    years,
    anomalies,
    episodes,
    headline,
    evidence,
  }
}

/** Run the engine and record wall-clock time. */
export function runBridge(input: BridgeInput, options?: BridgeOptions): BridgeReport {
  const started = now()
  const report = analyzeBridge(input, options)
  report.meta.elapsedMs = Math.round(now() - started)
  return report
}

export interface YearComparison {
  a: string
  b: string
  /** Calendar months (MM) compared: those with every series available in both years. */
  months: string[]
  constantSensor: SensorKey | null
  raw: { a: number; b: number; change: number | null }
  constant: { a: number; b: number; change: number | null } | null
  bridge: { a: Estimate; b: Estimate; change: number | null; range: [number, number] | null; observed: boolean } | null
}

const change = (a: number, b: number) => (a > 0 ? (b - a) / a : null)

/** Compare two years on three scales over the same calendar months: all satellites (raw),
 *  one constant sensor, and the Aqua-equivalent bridge. */
export function compareYears(report: BridgeReport, a: string, b: string): YearComparison {
  const byMonth = new Map(report.months.map((m) => [m.month, m]))
  const state = (sensor: SensorKey, month: string) => report.availability.bySensor[sensor]?.[month]
  const calendarMonths = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).filter((mm) => byMonth.has(`${a}-${mm}`) && byMonth.has(`${b}-${mm}`))
  const bridged = calendarMonths.filter((mm) => byMonth.get(`${a}-${mm}`)!.bridge && byMonth.get(`${b}-${mm}`)!.bridge)
  const months = bridged.length ? bridged : calendarMonths
  const constantSensor =
    (['snpp', 'noaa20', 'noaa21', 'aqua', 'terra'] as SensorKey[]).find((sensor) => months.length > 0 && months.every((mm) => isComplete(state(sensor, `${a}-${mm}`)) && isComplete(state(sensor, `${b}-${mm}`)))) ?? null
  const total = (year: string, pick: (m: BridgeMonth) => number) => months.reduce((sum, mm) => sum + pick(byMonth.get(`${year}-${mm}`)!), 0)
  const raw = { a: total(a, (m) => m.raw), b: total(b, (m) => m.raw), change: 0 as number | null }
  raw.change = change(raw.a, raw.b)
  let constant: YearComparison['constant'] = null
  if (constantSensor) {
    const ca = total(a, (m) => m.rawBySensor[constantSensor] ?? 0)
    const cb = total(b, (m) => m.rawBySensor[constantSensor] ?? 0)
    constant = { a: ca, b: cb, change: change(ca, cb) }
  }
  let bridge: YearComparison['bridge'] = null
  if (bridged.length) {
    const sum = (year: string, pick: (e: Estimate) => number) => total(year, (m) => pick(m.bridge!))
    const ea = { value: sum(a, (e) => e.value), low: sum(a, (e) => e.low), high: sum(a, (e) => e.high) }
    const eb = { value: sum(b, (e) => e.value), low: sum(b, (e) => e.low), high: sum(b, (e) => e.high) }
    const observed = months.every((mm) => byMonth.get(`${a}-${mm}`)!.bridge!.source === 'aqua' && byMonth.get(`${b}-${mm}`)!.bridge!.source === 'aqua')
    const low = ea.high > 0 ? (eb.low - ea.high) / ea.high : null
    const high = ea.low > 0 ? (eb.high - ea.low) / ea.low : null
    bridge = { a: ea, b: eb, change: change(ea.value, eb.value), range: !observed && low !== null && high !== null ? [low, high] : null, observed }
  }
  return { a, b, months, constantSensor, raw, constant, bridge }
}

export type { RawDetection } from './prepare.ts'
export type { Handover, HandoverMonth, HandoverWindow } from './handover.ts'
export type { AnomalyKind, AnomalyReport, MonthAnomaly, SeriesScore, Witness, WitnessState } from './anomaly.ts'
export { ANOMALY_THRESHOLD, ANOMALY_MINIMUM_YEARS } from './anomaly.ts'
export type { DriftFingerprint, FingerprintYear, UnmatchedShare } from './drift.ts'
export type { OrbitDrift } from './regime.ts'
export { MAINTAINED_ORBIT_UNTIL } from './regime.ts'
export type { PlatformReplay, ModelId, ModelScore, ReplayMonth } from './replay.ts'
export { MODELS, B2_FEATURES } from './replay.ts'
export type { Episode, EpisodeSummary } from './episodes.ts'
export type { Consensus, EvidenceReport, FirePlace, Intensity, MonthEvidence, Places, Robustness, Seasonality, TimeOfDay, Trends, TrendTest, WeeklyRhythm } from './evidence.ts'
export type { Sensitivity, GapDecomposition, ResponseCurve, FrpDistribution } from './sensitivity.ts'
export { FRP_LABELS } from './sensitivity.ts'
export type { OverpassRow, Drift, PairTiming } from './regime.ts'
export type { Availability, RecordEvent, MonthState, CalendarPeriodInput } from './availability.ts'
