import { describe, expect, it } from 'vitest'
import { csvForDetections, demoRepository, filterDetections } from './data'
import { DEMO_DETECTIONS } from './fixtures'
import type { AnalysisSelection } from './types'

const selection: AnalysisSelection = {
  area: {
    id: 'test-area',
    name: 'Test area',
    provenance: 'default-demo',
    geometry: {
      type: 'Polygon',
      coordinates: [[[-6.4, 34.5], [-4.5, 34.5], [-4.5, 35.9], [-6.4, 35.9], [-6.4, 34.5]]],
    },
  },
  startDate: '2024-07-18',
  endDate: '2024-07-25',
  platforms: ['Aqua', 'Suomi-NPP'],
  searchText: '',
  frpThresholdMw: null,
}

describe('synthetic demo repository', () => {
  it('filters by inclusive dates and selected platform', () => {
    const records = filterDetections(DEMO_DETECTIONS, {
      ...selection,
      startDate: '2024-07-20',
      endDate: '2024-07-20',
      platforms: ['Aqua'],
    })

    expect(records.map((record) => record.id)).toEqual(['demo-008'])
  })

  it('applies search and FRP filters without changing fixture data', () => {
    const records = filterDetections(DEMO_DETECTIONS, {
      ...selection,
      searchText: 'demo-009',
      frpThresholdMw: 10,
    })

    expect(records.map((record) => record.id)).toEqual(['demo-009'])
    expect(DEMO_DETECTIONS).toHaveLength(24)
  })

  it('keeps coverage unknown when only synthetic point records are available', async () => {
    const summary = await demoRepository.loadDashboardSummary(selection)

    expect(summary.rawDetections).toBe(24)
    expect(summary.status).toBe('synthetic_demo')
    expect(summary.coverage).toMatchObject({ fraction: null, status: 'unknown', denominator: null })
  })

  it('exports explicit provenance and synthetic markers as CSV', () => {
    const csv = csvForDetections(DEMO_DETECTIONS.slice(0, 1))

    expect(csv).toContain('provenance,synthetic_demo')
    expect(csv).toContain('"Synthetic fixture record","true"')
  })
})
