import type { SensorKey } from '../../../lib/sensors.ts'
import { maxFrp, type CellDayIndex } from './celldays.ts'
import type { Observation } from './prepare.ts'
import { quantile, wilson } from './stats.ts'

/** Log-spaced FRP bins in MW. */
export const FRP_EDGES = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, Number.POSITIVE_INFINITY]
export const FRP_LABELS = FRP_EDGES.slice(0, -1).map((edge, i) => (i === 0 ? '<0.5' : FRP_EDGES[i + 1] === Number.POSITIVE_INFINITY ? `≥${edge}` : `${edge}–${FRP_EDGES[i + 1]}`))

export interface FrpDistribution {
  group: 'MODIS' | 'VIIRS' | SensorKey
  n: number
  shares: number[]
  median: number | null
}

export interface ResponseBin {
  label: string
  from: number
  to: number
  n: number
  detected: number
  rate: number | null
  interval: [number, number] | null
}

export interface ResponseCurve {
  platform: SensorKey
  bins: ResponseBin[]
}

export interface GapDecomposition {
  platform: SensorKey
  /** Detections, daytime passes, months both records are inventoried. */
  platformDetections: number
  aquaDetections: number
  platformCellDays: number
  aquaCellDays: number
  /** Platform cell-days whose strongest detection reaches the MODIS FRP floor. */
  platformVisibleCellDays: number | null
  ratioDetections: number | null
  ratioCells: number | null
  ratioVisible: number | null
  /** Shares of ln(ratioDetections) explained by each step; null when not decomposable. */
  shares: { pixel: number; smallFires: number; residual: number } | null
}

export interface Sensitivity {
  /** 5th percentile of Aqua daytime FRP here: the practical MODIS detection floor. */
  floor: number | null
  floorSample: number
  distributions: FrpDistribution[]
  /** Share of each VIIRS platform's detections with FRP below the floor. */
  belowFloor: Partial<Record<SensorKey, number>>
  curves: ResponseCurve[]
  gaps: GapDecomposition[]
}

const RESPONSE_EDGES = [0, 2, 5, 10, 20, 50, Number.POSITIVE_INFINITY]

function distribution(group: FrpDistribution['group'], values: number[]): FrpDistribution {
  const counts = new Array<number>(FRP_EDGES.length - 1).fill(0)
  for (const value of values) {
    const bin = FRP_EDGES.findIndex((edge, i) => value >= edge && value < FRP_EDGES[i + 1])
    if (bin >= 0) counts[bin]++
  }
  return { group, n: values.length, shares: counts.map((count) => (values.length ? count / values.length : 0)), median: values.length ? quantile(values, 0.5) : null }
}

export function sensitivity(
  observations: readonly Observation[],
  index: CellDayIndex,
  platforms: readonly SensorKey[],
  pairedMonths: (platform: SensorKey) => Set<string>,
  minimumFloorSample = 20,
): Sensitivity {
  const frp = (filter: (o: Observation) => boolean) => observations.filter((o) => filter(o) && o.frp !== null).map((o) => o.frp!)
  const aquaFrp = frp((o) => o.sensor === 'aqua' && o.day)
  const floor = aquaFrp.length >= minimumFloorSample ? Math.round(quantile(aquaFrp, 0.05) * 10) / 10 : null
  // Daytime only throughout, matching the daytime floor and the afternoon pairing regime.
  const distributions: FrpDistribution[] = [
    distribution('MODIS', frp((o) => o.instrument === 'MODIS' && o.day)),
    distribution('VIIRS', frp((o) => o.instrument === 'VIIRS' && o.day)),
    distribution('aqua', aquaFrp),
  ]
  const belowFloor: Sensitivity['belowFloor'] = {}
  const curves: ResponseCurve[] = []
  const gaps: GapDecomposition[] = []
  for (const platform of platforms) {
    const values = frp((o) => o.sensor === platform && o.day)
    distributions.push(distribution(platform, values))
    if (floor !== null && values.length) belowFloor[platform] = values.filter((value) => value < floor).length / values.length
    const months = pairedMonths(platform)
    const cells = index.list((cell) => months.has(cell.month))
    const platformCells = cells.filter((cell) => cell.bySensor[platform])
    // Response: is Aqua active within ±1 cell (≈5–10 km) on the same day, by platform FRP?
    const bins: ResponseBin[] = []
    for (let i = 0; i + 1 < RESPONSE_EDGES.length; i++) {
      const [from, to] = [RESPONSE_EDGES[i], RESPONSE_EDGES[i + 1]]
      const inBin = platformCells.filter((cell) => {
        const value = maxFrp(cell.bySensor[platform]!)
        return value >= from && value < to
      })
      const detected = inBin.filter((cell) => index.activeNear(cell, 'aqua')).length
      bins.push({ label: to === Number.POSITIVE_INFINITY ? `≥${from}` : `${from}–${to}`, from, to, n: inBin.length, detected, rate: inBin.length ? detected / inBin.length : null, interval: wilson(detected, inBin.length) })
    }
    curves.push({ platform, bins })
    const platformDetections = observations.filter((o) => o.sensor === platform && o.day && months.has(o.month)).length
    const aquaDetections = observations.filter((o) => o.sensor === 'aqua' && o.day && months.has(o.month)).length
    const aquaCellDays = cells.filter((cell) => cell.bySensor.aqua).length
    const platformVisibleCellDays = floor === null ? null : platformCells.filter((cell) => maxFrp(cell.bySensor[platform]!) >= floor).length
    const ratio = (a: number | null, b: number) => (a !== null && b > 0 && a > 0 ? a / b : null)
    const ratioDetections = ratio(platformDetections, aquaDetections)
    const ratioCells = ratio(platformCells.length, aquaCellDays)
    const ratioVisible = ratio(platformVisibleCellDays, aquaCellDays)
    let shares: GapDecomposition['shares'] = null
    if (ratioDetections && ratioCells && ratioVisible && ratioDetections > 1.05) {
      const total = Math.log(ratioDetections)
      shares = { pixel: Math.log(ratioDetections / ratioCells) / total, smallFires: Math.log(ratioCells / ratioVisible) / total, residual: Math.log(ratioVisible) / total }
    }
    gaps.push({ platform, platformDetections, aquaDetections, platformCellDays: platformCells.length, aquaCellDays, platformVisibleCellDays, ratioDetections, ratioCells, ratioVisible, shares })
  }
  return { floor, floorSample: aquaFrp.length, distributions, belowFloor, curves, gaps }
}
