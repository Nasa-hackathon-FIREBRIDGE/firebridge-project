import type { SensorKey } from '../../../lib/sensors.ts'
import type { CellDayIndex } from './celldays.ts'
import type { Observation } from './prepare.ts'
import { circularClock, median } from './stats.ts'

export interface OverpassRow {
  sensor: SensorKey
  year: string
  pass: 'day' | 'night'
  n: number
  /** Local solar time, hours. */
  median: number
  p25: number
  p75: number
}

export interface Drift {
  sensor: SensorKey
  fromYear: string
  toYear: string
  from: number
  to: number
  /** Signed change of the median daytime local solar time, minutes. */
  shiftMinutes: number
  nFrom: number
  nTo: number
}

export interface PairTiming {
  platform: SensorKey
  year: string
  /** Co-detected cell-days (reference and platform active in the same cell on the same day). */
  n: number
  /** Median of (platform time − Aqua time) in minutes; negative means the platform passed first. */
  medianMinutes: number
}

const REGIME_SENSORS: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21']

/** Observed overpass regime: when, in local solar time, each satellite actually recorded
 *  detections here, by year. Derived from timestamps, not nominal orbit tables. */
export function overpassRegime(observations: readonly Observation[], minimum = 5): { rows: OverpassRow[]; drift: Drift[] } {
  const groups = new Map<string, number[]>()
  for (const o of observations) {
    if (!REGIME_SENSORS.includes(o.sensor)) continue
    const key = `${o.sensor}|${o.year}|${o.day ? 'day' : 'night'}`
    let list = groups.get(key)
    if (!list) groups.set(key, (list = []))
    list.push(o.lst)
  }
  const rows: OverpassRow[] = []
  for (const [key, values] of groups) {
    if (values.length < minimum) continue
    const [sensor, year, pass] = key.split('|') as [SensorKey, string, 'day' | 'night']
    const clock = circularClock(values)!
    rows.push({ sensor, year, pass, n: values.length, ...clock })
  }
  rows.sort((a, b) => REGIME_SENSORS.indexOf(a.sensor) - REGIME_SENSORS.indexOf(b.sensor) || a.year.localeCompare(b.year) || a.pass.localeCompare(b.pass))
  const drift: Drift[] = []
  for (const sensor of REGIME_SENSORS) {
    const days = rows.filter((row) => row.sensor === sensor && row.pass === 'day' && row.n >= Math.max(minimum, 10))
    if (days.length < 2) continue
    const first = days[0]
    const last = days[days.length - 1]
    drift.push({ sensor, fromYear: first.year, toYear: last.year, from: first.median, to: last.median, shiftMinutes: Math.round((last.median - first.median) * 60), nFrom: first.n, nTo: last.n })
  }
  return { rows, drift }
}

/** Time separation between the reference (Aqua) and each VIIRS platform, measured on
 *  cell-days where both recorded detections. Shows whether passes are near-simultaneous. */
export function pairTiming(index: CellDayIndex, platforms: readonly SensorKey[]): PairTiming[] {
  const out: PairTiming[] = []
  for (const platform of platforms) {
    const byYear = new Map<string, number[]>()
    for (const cell of index.cells.values()) {
      const aqua = cell.bySensor.aqua
      const other = cell.bySensor[platform]
      if (!aqua || !other) continue
      const dt = (median(other.map((o) => o.t)) - median(aqua.map((o) => o.t))) / 60_000
      let list = byYear.get(cell.year)
      if (!list) byYear.set(cell.year, (list = []))
      list.push(dt)
    }
    for (const [year, values] of [...byYear].sort()) out.push({ platform, year, n: values.length, medianMinutes: Math.round(median(values)) })
  }
  return out
}

/** Last calendar year each MODIS platform's orbit was still actively maintained. Afterwards
 *  its overpass time drifts without correction (Terra earlier, Aqua later in the day). */
export const MAINTAINED_ORBIT_UNTIL: Partial<Record<SensorKey, string>> = { terra: '2019', aqua: '2021' }

/** Design orbits of the drifting MODIS platforms: daytime node crossing (mean local solar time,
 *  hours) and inclination. Aqua crosses the equator northbound at 13:30, Terra southbound at 10:30. */
const DESIGN_ORBIT: Partial<Record<SensorKey, { node: number; ascending: boolean; inclination: number }>> = {
  aqua: { node: 13.5, ascending: true, inclination: 98.2 },
  terra: { node: 10.5, ascending: false, inclination: 98.2 },
}
const DEG = Math.PI / 180

/** Nadir local solar time of a design-orbit daytime pass at a latitude: on a sun-synchronous orbit
 *  the sub-satellite point at latitude φ lies asin(tan φ / tan i) in longitude from the node. */
export function nominalOverpass(sensor: SensorKey, latitude: number): number | null {
  const orbit = DESIGN_ORBIT[sensor]
  if (!orbit) return null
  const ratio = Math.tan(latitude * DEG) / Math.tan(orbit.inclination * DEG)
  if (Math.abs(ratio) > 1) return null
  const shift = Math.asin(ratio) / DEG / 15
  return orbit.node + (orbit.ascending ? shift : -shift)
}

export interface OrbitDrift {
  sensor: SensorKey
  /** Original overpass time here, local solar hours. */
  baseline: number | null
  /** 'maintained-orbit': measured from this window's detections in the years the orbit was still
   *  maintained. 'design-orbit': computed from the design orbit at this latitude, because the window
   *  holds no maintained-orbit years. */
  baselineFrom: 'maintained-orbit' | 'design-orbit' | null
  /** First year after the maintained era whose median pass (n ≥ 10) is more than the tolerance
   *  away from the baseline. Drift persists from then on. */
  onset: string | null
  /** Window years from the onset on. */
  years: string[]
}

/** Detect when a satellite left its original overpass regime, from its own timestamps. */
export function orbitDrift(observations: readonly Observation[], rows: readonly OverpassRow[], sensor: SensorKey, windowYears: readonly string[], toleranceMinutes: number): OrbitDrift {
  const until = MAINTAINED_ORBIT_UNTIL[sensor] ?? '0000'
  const own = observations.filter((o) => o.sensor === sensor && o.day)
  const early = own.filter((o) => o.year <= until).map((o) => o.lst)
  const days = rows.filter((row) => row.sensor === sensor && row.pass === 'day').sort((a, b) => a.year.localeCompare(b.year))
  let baseline: number | null = null
  let baselineFrom: OrbitDrift['baselineFrom'] = null
  if (early.length >= 10) {
    baseline = circularClock(early)!.median
    baselineFrom = 'maintained-orbit'
  } else if (own.length) {
    baseline = nominalOverpass(sensor, median(own.map((o) => o.lat)))
    baselineFrom = baseline === null ? null : 'design-orbit'
  }
  if (baseline === null) return { sensor, baseline, baselineFrom, onset: null, years: [] }
  const offset = (hours: number) => Math.abs(((hours - baseline! + 36) % 24) - 12) * 60
  const onset = days.find((row) => row.year > until && row.n >= 10 && offset(row.median) > toleranceMinutes)?.year ?? null
  return { sensor, baseline, baselineFrom, onset, years: onset ? windowYears.filter((year) => year >= onset) : [] }
}
