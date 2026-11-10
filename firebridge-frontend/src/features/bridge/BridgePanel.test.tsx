// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBridge } from './engine/index.ts'
import { syntheticSeasons } from './test-fixtures'
import type { BridgeState } from './useBridgeReport'

// Charts render on canvas; their data are covered by the engine tests and the visible tables.
vi.mock('./BridgeCharts', () => ({
  OverpassChart: () => null,
  FrpChart: () => null,
  ResponseChart: () => null,
  ReplayChart: () => <div data-testid="replay-chart" />,
  IndexedYearsChart: () => null,
  MonthlyBridgeChart: () => null,
}))

const report = runBridge({ detections: syntheticSeasons(), start: '2019-01-01', endExclusive: '2022-01-01' })
let state: BridgeState = { status: 'ready', report }
vi.mock('./useBridgeReport', () => ({ MAX_BRIDGE_DETECTIONS: 150_000, useBridgeReport: () => state }))

const { BridgePanel } = await import('./BridgePanel')
const { EpisodesCard } = await import('./EpisodesCard')

afterEach(cleanup)

describe('Sensor bridge panel', () => {
  it('tells the harmonization story in five acts with reproducible method', () => {
    state = { status: 'ready', report }
    render(<BridgePanel analysisId="a1" releaseId="r1" />)
    expect(screen.getByRole('heading', { name: 'How much of the difference is the satellite?' })).toBeVisible()
    for (const title of [/^Why Suomi-NPP records .* as many detections as Aqua$/, 'When each satellite actually looked', 'The detection floor, measured here', 'Hide Aqua. Predict it from Suomi-NPP. Reveal.', 'One comparable record across changing satellites', 'Every number above is recomputable'])
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'VIIRS platform' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Full report \(JSON\)/ })).toBeEnabled()
  })

  it('reveals the withheld reference before scoring the models', () => {
    state = { status: 'ready', report }
    render(<BridgePanel analysisId="a1" />)
    const act = screen.getByRole('heading', { name: /Hide Aqua\. Predict it from/ }).closest('section')!
    expect(within(act).getByText(/Scores appear when Aqua is revealed/)).toBeInTheDocument()
    expect(within(act).queryByRole('table')).toBeNull()
    fireEvent.click(within(act).getByRole('button', { name: /3\. Reveal Aqua/ }))
    const table = within(act).getByRole('table', { name: /Scored against the revealed Aqua record/ })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('adopted')).toBeInTheDocument()
    expect(within(act).getByText(/Largest miss/)).toBeInTheDocument()
  })

  it('separates the satellite-fleet effect from real change when comparing years', () => {
    state = { status: 'ready', report }
    render(<BridgePanel analysisId="a1" />)
    fireEvent.change(screen.getByLabelText('First year'), { target: { value: '2019' } })
    fireEvent.change(screen.getByLabelText('Second year'), { target: { value: '2021' } })
    expect(screen.getByText(/NOAA-21 contributes .* detections in 2021 and none in 2019/)).toBeInTheDocument()
    expect(screen.getByText('Suomi-NPP only, same sensor')).toBeInTheDocument()
  })

  it('reports loading progress and oversize selections plainly', () => {
    state = { status: 'loading', phase: 'detections', loaded: 5000, total: 12000 }
    const { unmount } = render(<BridgePanel analysisId="a1" />)
    expect(screen.getByRole('status')).toHaveTextContent('5,000 of 12,000')
    unmount()
    state = { status: 'too-large', total: 400_000 }
    render(<BridgePanel analysisId="a1" />)
    expect(screen.getByText(/400,000 detections/)).toBeInTheDocument()
  })
})

describe('Fire episodes card', () => {
  it('turns detections into clusters and links episodes to the map', () => {
    state = { status: 'ready', report }
    const onShow = vi.fn()
    render(<EpisodesCard analysisId="a1" onShowEpisode={onShow} />)
    expect(screen.getByRole('heading', { name: 'Fire episodes' })).toBeVisible()
    expect(screen.getByText('Detection clusters')).toBeInTheDocument()
    const [first] = screen.getAllByRole('button', { name: /^Show episode of .* on the map$/ })
    fireEvent.click(first)
    const [start, endExclusive] = onShow.mock.calls[0]
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(endExclusive > start).toBe(true)
  })
})
