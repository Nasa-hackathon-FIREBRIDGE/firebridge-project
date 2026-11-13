import { SENSORS, sensorKeyOf, type SensorKey } from '../../../lib/sensors.ts'
import { cellIndex, toEase2 } from './geo.ts'

/** One native detection as served by `/analyses/:id/detections`. */
export interface RawDetection {
  sourceId: string
  platform: string | null
  lon: number
  lat: number
  acquiredAt: string
  dayNight: string | null
  frp: number | null
  confidence: string | null
  confidenceScheme: string | null
  type: string | null
}

export type ConfidenceClass = 'low' | 'nominal' | 'high' | 'unknown'

/** A detection normalised for comparison. Native values are kept; nothing is imputed. */
export interface Observation {
  sensor: SensorKey
  instrument: 'MODIS' | 'VIIRS' | 'OLI' | 'Unknown'
  sourceId: string
  t: number
  lon: number
  lat: number
  x: number
  y: number
  cx: number
  cy: number
  /** Local solar time in hours [0, 24), from UTC time and longitude. */
  lst: number
  /** Calendar date in local solar time: the overpass day used for pairing. */
  localDate: string
  month: string
  year: string
  day: boolean
  frp: number | null
  confidence: ConfidenceClass
  /** NASA FIRMS type 0 (presumed vegetation fire) or no type supplied. Types 1–3 are
   *  active volcano, other static land source and offshore. */
  presumedVegetation: boolean
}

export interface Prepared {
  observations: Observation[]
  /** All valid detections, including static/offshore sources (for raw totals). */
  all: Observation[]
  excludedNonVegetation: Partial<Record<SensorKey, number>>
  invalid: number
}

const HOUR = 3_600_000

/** MODIS C6/C6.1 numeric confidence classes: 0–29 low, 30–79 nominal, 80–100 high
 *  (MODIS Collection 6 Active Fire User Guide). VIIRS supplies l/n/h directly. */
export function confidenceClass(raw: string | null, scheme: string | null): ConfidenceClass {
  if (raw === null || raw === '') return 'unknown'
  const value = raw.trim().toLowerCase()
  if (value === 'l' || value === 'low') return 'low'
  if (value === 'n' || value === 'nominal') return 'nominal'
  if (value === 'h' || value === 'high') return 'high'
  const numeric = Number(value)
  if (Number.isFinite(numeric) && (!scheme || /modis|0_100/i.test(scheme))) return numeric < 30 ? 'low' : numeric < 80 ? 'nominal' : 'high'
  return 'unknown'
}

function isDaytime(dayNight: string | null, lst: number) {
  const value = dayNight?.trim().toLowerCase()
  if (value === 'day' || value === 'd') return true
  if (value === 'night' || value === 'n') return false
  return lst >= 6 && lst < 18
}

export function prepareDetections(raw: readonly RawDetection[], cellSize: number): Prepared {
  const all: Observation[] = []
  const excludedNonVegetation: Partial<Record<SensorKey, number>> = {}
  let invalid = 0
  for (const detection of raw) {
    const t = Date.parse(detection.acquiredAt)
    if (!Number.isFinite(t) || !Number.isFinite(detection.lon) || !Number.isFinite(detection.lat) || Math.abs(detection.lat) > 90 || Math.abs(detection.lon) > 180) {
      invalid++
      continue
    }
    const sensor = sensorKeyOf(detection.platform, detection.sourceId)
    const [x, y] = toEase2(detection.lon, detection.lat)
    const [cx, cy] = cellIndex(x, y, cellSize)
    const offset = (detection.lon / 15) * HOUR
    const localDate = new Date(t + offset).toISOString().slice(0, 10)
    const lst = ((((t % 86_400_000) / HOUR + detection.lon / 15) % 24) + 24) % 24
    const type = detection.type?.trim() ?? ''
    const observation: Observation = {
      sensor,
      instrument: SENSORS[sensor].instrument,
      sourceId: detection.sourceId,
      t,
      lon: detection.lon,
      lat: detection.lat,
      x,
      y,
      cx,
      cy,
      lst,
      localDate,
      month: localDate.slice(0, 7),
      year: localDate.slice(0, 4),
      day: isDaytime(detection.dayNight, lst),
      frp: detection.frp !== null && Number.isFinite(detection.frp) && detection.frp >= 0 ? detection.frp : null,
      confidence: confidenceClass(detection.confidence, detection.confidenceScheme),
      presumedVegetation: type === '' || type === '0',
    }
    all.push(observation)
    if (!observation.presumedVegetation) excludedNonVegetation[sensor] = (excludedNonVegetation[sensor] ?? 0) + 1
  }
  all.sort((a, b) => a.t - b.t || a.x - b.x)
  return { observations: all.filter((o) => o.presumedVegetation), all, excludedNonVegetation, invalid }
}
