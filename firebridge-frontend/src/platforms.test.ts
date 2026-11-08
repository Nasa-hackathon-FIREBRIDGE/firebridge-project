import { describe, expect, it } from 'vitest'
import { demoRepository, filterDetections } from './data'
import { DEMO_DETECTIONS } from './fixtures'
import { ALL_PLATFORM_IDS, familyState, hasDemoRecords, operationalNote, platformsOf, selectedWithoutRecords, toggleFamily, togglePlatformIn } from './platforms'
import type { AnalysisSelection, SatellitePlatform } from './types'

const base = (platforms: SatellitePlatform[]): AnalysisSelection => ({
  area: { id: 'a', name: 'Test', provenance: 'default-demo', geometry: { type: 'Polygon', coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] } },
  startDate: '2000-01-01', endDate: '2100-01-01', platforms, searchText: '', frpThresholdMw: null,
})

describe('platform hierarchy', () => {
  it('maps MODIS to Terra and Aqua and VIIRS to three satellites', () => {
    expect(platformsOf('MODIS')).toEqual(['Terra', 'Aqua'])
    expect(platformsOf('VIIRS')).toEqual(['Suomi-NPP', 'NOAA-20', 'NOAA-21'])
  })
  it('selecting a parent selects all children and deselecting clears them', () => {
    const selected = toggleFamily([], 'MODIS')
    expect(selected).toEqual(['Terra', 'Aqua'])
    expect(toggleFamily(selected, 'MODIS')).toEqual([])
    expect(toggleFamily(['Aqua'], 'MODIS')).toEqual(['Terra', 'Aqua'])
  })
  it('reports indeterminate state for partial selection', () => {
    expect(familyState(['Terra'], 'MODIS')).toBe('some')
    expect(familyState(['Terra', 'Aqua'], 'MODIS')).toBe('all')
    expect(familyState([], 'VIIRS')).toBe('none')
  })
  it('toggles a single child without touching others', () => {
    expect(togglePlatformIn(['Aqua', 'NOAA-20'], 'NOAA-20')).toEqual(['Aqua'])
    expect(togglePlatformIn(['Aqua'], 'NOAA-21')).toEqual(['Aqua', 'NOAA-21'])
  })
})

describe('platform filtering', () => {
  const count = (platforms: SatellitePlatform[]) => filterDetections(DEMO_DETECTIONS, base(platforms))
  it('Terra alone excludes Aqua records', () => {
    expect(count(['Terra'])).toHaveLength(0)
    expect(count(['Aqua']).every((record) => record.platform === 'Aqua')).toBe(true)
  })
  it('MODIS family equals Aqua records because Terra has no demo data', () => {
    expect(count(platformsOf('MODIS'))).toEqual(count(['Aqua']))
  })
  it('NOAA-20 alone yields no records and no fabricated rows', async () => {
    expect(count(['NOAA-20'])).toHaveLength(0)
    const comparison = await demoRepository.loadSensorComparison(base(['NOAA-20']))
    expect(comparison.sourceCounts).toEqual([])
  })
  it('selecting every satellite adds no records beyond the fixtures', () => {
    expect(count(ALL_PLATFORM_IDS)).toHaveLength(DEMO_DETECTIONS.length)
  })
  it('identifies selected satellites without demo records', () => {
    expect(hasDemoRecords('Aqua')).toBe(true)
    expect(hasDemoRecords('Terra')).toBe(false)
    expect(selectedWithoutRecords(['Aqua', 'Terra', 'NOAA-21'])).toEqual(['Terra', 'NOAA-21'])
  })
})

describe('Suomi-NPP operational note', () => {
  it('uses forward wording before the cutoff and past wording after, without claiming NRT', () => {
    expect(operationalNote('Suomi-NPP', new Date('2026-10-30T00:00:00Z'))).toContain('schedules delivery')
    expect(operationalNote('Suomi-NPP', new Date('2026-11-03T00:00:00Z'))).toContain('scheduled delivery')
    expect(operationalNote('Aqua')).toBeNull()
  })
})
