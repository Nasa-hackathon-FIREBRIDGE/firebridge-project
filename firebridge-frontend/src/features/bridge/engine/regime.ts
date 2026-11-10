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
