import { DEMO_DETECTIONS } from './fixtures'
import type { SatellitePlatform, Sensor } from './types'

export interface PlatformOperationalNote {
  /** Moment a documented data-delivery change takes effect. */
  effectiveUtc: string
  before: string
  after: string
}

export interface PlatformInfo {
  id: SatellitePlatform
  sensor: Sensor
  label: string
  /** Native product/source identifier. Null until verified against real product metadata. */
  nativeProductId: string | null
  operationalNote?: PlatformOperationalNote
}

/** Instrument families and the spacecraft that carry them. MODIS is on two spacecraft, VIIRS on three. */
export const SENSOR_FAMILIES: { id: Sensor; label: string; description: string }[] = [
  { id: 'MODIS', label: 'MODIS', description: 'Instrument on Terra and Aqua' },
  { id: 'VIIRS', label: 'VIIRS', description: 'Instrument on Suomi-NPP, NOAA-20 and NOAA-21' },
]

export const PLATFORMS: PlatformInfo[] = [
  { id: 'Terra', sensor: 'MODIS', label: 'Terra', nativeProductId: null },
  { id: 'Aqua', sensor: 'MODIS', label: 'Aqua', nativeProductId: null },
  {
    id: 'Suomi-NPP', sensor: 'VIIRS', label: 'Suomi-NPP', nativeProductId: null,
    operationalNote: {
      effectiveUtc: '2026-11-02T13:00:00Z',
      before: 'NOAA schedules delivery of Suomi-NPP products to users to cease on 2 Nov 2026 13:00 UTC (NOAA-21 primary, NOAA-20 secondary). Historical records are unaffected.',
      after: 'NOAA scheduled delivery of Suomi-NPP products to users to cease on 2 Nov 2026 13:00 UTC (NOAA-21 primary, NOAA-20 secondary). Historical records are unaffected.',
    },
  },
  { id: 'NOAA-20', sensor: 'VIIRS', label: 'NOAA-20', nativeProductId: null },
  { id: 'NOAA-21', sensor: 'VIIRS', label: 'NOAA-21', nativeProductId: null },
]

export const ALL_PLATFORM_IDS: SatellitePlatform[] = PLATFORMS.map((platform) => platform.id)

export const platformsOf = (sensor: Sensor): SatellitePlatform[] => PLATFORMS.filter((platform) => platform.sensor === sensor).map((platform) => platform.id)

export const platformInfo = (id: SatellitePlatform): PlatformInfo => PLATFORMS.find((platform) => platform.id === id) as PlatformInfo

// Availability is derived from the loaded fixtures so it cannot drift from the data.
const PLATFORMS_WITH_DEMO_RECORDS = new Set<SatellitePlatform>(DEMO_DETECTIONS.map((record) => record.platform))
export const hasDemoRecords = (id: SatellitePlatform): boolean => PLATFORMS_WITH_DEMO_RECORDS.has(id)

export const NO_RECORDS_LABEL = 'No demo records loaded'
export const NO_RECORDS_EXPLANATION = 'The current demonstration dataset contains no records for this satellite. This does not mean the satellite has no real-world fire detections.'

export function operationalNote(id: SatellitePlatform, now: Date = new Date()): string | null {
  const note = platformInfo(id).operationalNote
  if (!note) return null
  return now.getTime() >= Date.parse(note.effectiveUtc) ? note.after : note.before
}

export type FamilyState = 'all' | 'some' | 'none'

export function familyState(selected: SatellitePlatform[], sensor: Sensor): FamilyState {
  const members = platformsOf(sensor)
  const count = members.filter((id) => selected.includes(id)).length
  return count === 0 ? 'none' : count === members.length ? 'all' : 'some'
}

const canonical = (ids: Iterable<SatellitePlatform>): SatellitePlatform[] => {
  const set = new Set(ids)
  return ALL_PLATFORM_IDS.filter((id) => set.has(id))
}

/** A parent toggle selects every child unless all children are already selected, in which case it clears them. */
export function toggleFamily(selected: SatellitePlatform[], sensor: Sensor): SatellitePlatform[] {
  const members = platformsOf(sensor)
  if (familyState(selected, sensor) === 'all') return canonical(selected.filter((id) => !members.includes(id)))
  return canonical([...selected, ...members])
}

export function togglePlatformIn(selected: SatellitePlatform[], platform: SatellitePlatform): SatellitePlatform[] {
  return canonical(selected.includes(platform) ? selected.filter((id) => id !== platform) : [...selected, platform])
}

/** Selected platforms for which the loaded dataset holds no records. */
export const selectedWithoutRecords = (selected: SatellitePlatform[]): SatellitePlatform[] => selected.filter((id) => !hasDemoRecords(id))
