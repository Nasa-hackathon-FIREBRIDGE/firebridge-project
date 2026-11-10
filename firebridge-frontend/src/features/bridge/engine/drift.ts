import type { SensorKey } from '../../../lib/sensors.ts'
import type { CellDayIndex } from './celldays.ts'
import { wilson } from './stats.ts'

export interface UnmatchedShare {
  cellDays: number
  /** Aqua cell-days with no VIIRS detection within ±1 cell on the same local day. */
  unmatched: number
  share: number | null
  /** 90% Wilson interval of the share. */
  interval: [number, number] | null
}

export interface FingerprintYear extends UnmatchedShare {
  year: string
  drifted: boolean
}

/**
 * The observable signature of a drifting reference: when Aqua passes long after VIIRS, it
 * increasingly records fires VIIRS did not see that day (ignited or flared after the VIIRS
 * pass) and misses fires that had died down. Counted only in months where Aqua and at least
 * one VIIRS platform are both fully inventoried, so a missing record never looks like a miss.
 */
export interface DriftFingerprint {
  years: FingerprintYear[]
  inRegime: UnmatchedShare
  drifted: UnmatchedShare
  /** True when the two 90% intervals do not overlap. */
  distinguishable: boolean
  /** VIIRS platforms inventoried only in the drifted years. They make a match more likely, so a
   *  higher unmatched share despite them is a conservative reading. */
  addedInDrift: SensorKey[]
}

function share(cellDays: number, unmatched: number): UnmatchedShare {
  return { cellDays, unmatched, share: cellDays ? unmatched / cellDays : null, interval: wilson(unmatched, cellDays) }
}

export function driftFingerprint(index: CellDayIndex, viirs: readonly SensorKey[], comparable: (month: string) => boolean, driftYears: ReadonlySet<string>, inventoried: (platform: SensorKey, month: string) => boolean, months: readonly string[]): DriftFingerprint {
  const counts = new Map<string, [number, number]>()
  for (const cell of index.cells.values()) {
    if (!cell.bySensor.aqua || !comparable(cell.month)) continue
    const entry = counts.get(cell.year) ?? [0, 0]
    entry[0]++
    if (!viirs.some((platform) => index.activeNear(cell, platform))) entry[1]++
    counts.set(cell.year, entry)
  }
  const years = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([year, [cellDays, unmatched]]) => ({ year, drifted: driftYears.has(year), ...share(cellDays, unmatched) }))
  const pool = (drifted: boolean) => {
    const list = years.filter((y) => y.drifted === drifted)
    return share(list.reduce((sum, y) => sum + y.cellDays, 0), list.reduce((sum, y) => sum + y.unmatched, 0))
  }
  const inRegime = pool(false)
  const drifted = pool(true)
  const distinguishable = !!inRegime.interval && !!drifted.interval && (drifted.interval[0] > inRegime.interval[1] || drifted.interval[1] < inRegime.interval[0])
  const flown = (platform: SensorKey, inDrift: boolean) => months.some((m) => driftYears.has(m.slice(0, 4)) === inDrift && comparable(m) && inventoried(platform, m))
  const addedInDrift = driftYears.size ? viirs.filter((p) => flown(p, true) && !flown(p, false)) : []
  return { years, inRegime, drifted, distinguishable, addedInDrift }
}
