/** Presentation metadata for the satellite records FIREBRIDGE serves.
 *  Values are documented instrument characteristics used for explanation only;
 *  actual archive availability always comes from the API. */
export type SensorKey = 'terra' | 'aqua' | 'snpp' | 'noaa20' | 'noaa21' | 'landsat' | 'other'

export interface SensorMeta {
  key: SensorKey
  label: string
  instrument: 'MODIS' | 'VIIRS' | 'OLI' | 'Unknown'
  color: string
  /** Nominal active-fire pixel size at nadir. */
  pixel: string
  /** Approximate local equator-crossing time (daytime overpass). */
  overpass: string
  /** First year of the active-fire record (approximate). */
  since: number
  /** Year the record ends, when a documented end exists. */
  until?: number
  note?: string
}

export const SENSORS: Record<SensorKey, SensorMeta> = {
  terra: { key: 'terra', label: 'Terra', instrument: 'MODIS', color: '#f2c14e', pixel: '1 km', overpass: '10:30', since: 2000, note: 'Longest record · morning overpass' },
  aqua: { key: 'aqua', label: 'Aqua', instrument: 'MODIS', color: '#38c6f4', pixel: '1 km', overpass: '13:30', since: 2002, note: 'Proposed harmonization reference' },
  snpp: { key: 'snpp', label: 'Suomi-NPP', instrument: 'VIIRS', color: '#a78bfa', pixel: '375 m', overpass: '13:30', since: 2012, until: 2026, note: 'User delivery ended 2 Nov 2026' },
  noaa20: { key: 'noaa20', label: 'NOAA-20', instrument: 'VIIRS', color: '#34d399', pixel: '375 m', overpass: '13:30', since: 2018 },
  noaa21: { key: 'noaa21', label: 'NOAA-21', instrument: 'VIIRS', color: '#f472b6', pixel: '375 m', overpass: '13:30', since: 2023 },
  landsat: { key: 'landsat', label: 'Landsat 8/9', instrument: 'OLI', color: '#94a3b8', pixel: '30 m', overpass: '10:00', since: 2022, note: 'Supplementary, US/Canada NRT' },
  other: { key: 'other', label: 'Other source', instrument: 'Unknown', color: '#737a88', pixel: '—', overpass: '—', since: 2000 },
}

export const TIMELINE_SENSORS: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21']

/** Resolve a FIRMS/FIREBRIDGE source id or platform label to a sensor key. */
export function sensorKeyOf(...values: (string | null | undefined)[]): SensorKey {
  const text = values.filter(Boolean).join(' ').toLowerCase()
  if (!text) return 'other'
  if (/noaa[-_ ]?21|\bn21\b|j2/.test(text)) return 'noaa21'
  if (/noaa[-_ ]?20|\bn20\b|j1/.test(text)) return 'noaa20'
  if (/snpp|suomi|\bnpp\b/.test(text)) return 'snpp'
  if (/aqua/.test(text)) return 'aqua'
  if (/terra/.test(text)) return 'terra'
  if (/landsat/.test(text)) return 'landsat'
  return 'other'
}

export const sensorMeta = (...values: (string | null | undefined)[]) => SENSORS[sensorKeyOf(...values)]
