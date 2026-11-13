import type { SensorKey } from '../../../lib/sensors.ts'
import type { Observation } from './prepare.ts'

/** All daytime detections of one sensor in one equal-area cell on one local solar day. */
export interface CellDay {
  key: string
  cx: number
  cy: number
  date: string
  month: string
  year: string
  bySensor: Partial<Record<SensorKey, Observation[]>>
}

const cellKey = (cx: number, cy: number, date: string) => `${cx}:${cy}|${date}`

/** Index daytime (afternoon-regime) presumed-vegetation detections by cell-day. */
export class CellDayIndex {
  readonly cells = new Map<string, CellDay>()
  constructor(observations: readonly Observation[]) {
    for (const o of observations) {
      if (!o.day) continue
      const key = cellKey(o.cx, o.cy, o.localDate)
      let cell = this.cells.get(key)
      if (!cell) {
        cell = { key, cx: o.cx, cy: o.cy, date: o.localDate, month: o.month, year: o.year, bySensor: {} }
        this.cells.set(key, cell)
      }
      ;(cell.bySensor[o.sensor] ??= []).push(o)
    }
  }
  get(cx: number, cy: number, date: string) {
    return this.cells.get(cellKey(cx, cy, date))
  }
  /** True when `sensor` is active in the cell or one of its eight neighbours that day. */
  activeNear(cell: CellDay, sensor: SensorKey) {
    if (cell.bySensor[sensor]) return true
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue
        if (this.get(cell.cx + dx, cell.cy + dy, cell.date)?.bySensor[sensor]) return true
      }
    return false
  }
  list(filter?: (cell: CellDay) => boolean) {
    const out: CellDay[] = []
    for (const cell of this.cells.values()) if (!filter || filter(cell)) out.push(cell)
    return out
  }
}

export const maxFrp = (observations: readonly Observation[]) => observations.reduce((max, o) => Math.max(max, o.frp ?? 0), 0)
