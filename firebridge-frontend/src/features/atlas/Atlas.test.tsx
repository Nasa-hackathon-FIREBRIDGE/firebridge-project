// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObservationFilters } from '../observations/filters'
import { emptyObservationFilters } from '../observations/filters'
import type { AtlasLayerConfig } from './useAtlasLayers'
import { fixture } from './test-fixtures'

// WebGL is out of reach in jsdom: the map is replaced, and what the atlas hands it is checked.
const map = vi.hoisted(() => ({ props: null as null | { atlas?: AtlasLayerConfig; apiAnalysisId?: string } }))
vi.mock('../../components/MapView', () => ({
  MapView: (props: { atlas?: AtlasLayerConfig; apiAnalysisId?: string; children?: ReactNode; footer?: ReactNode }) => {
    map.props = props
    return <div data-testid="map">{props.children}{props.footer}</div>
  },
}))
vi.mock('../bridge/useBridgeReport', () => ({
  useAllDetections: () => ({ features: fixture, loaded: fixture.length, total: fixture.length, tooLarge: false, complete: true, pages: { isError: false }, summary: { isError: false } }),
}))
vi.mock('../../hooks/useFirebridge', () => ({ useAnalysis: () => ({ data: { start_date: '2022-01-01', end_date_exclusive: '2023-01-01' } }) }))

const { SpatialPanel } = await import('../analyses/SpatialPanel')

let client: QueryClient
let applyFilters: (value: ObservationFilters) => void = () => {}

/** The workspace owns the filters: the atlas proposes changes and the workspace applies them. */
function Workspace({ initial, onFiltersChange }: { initial: ObservationFilters; onFiltersChange: (value: ObservationFilters) => void }) {
  const [filters, setFilters] = useState(initial)
  useEffect(() => {
    applyFilters = setFilters
  }, [])
  return (
    <SpatialPanel area={null} analysisId="analysis" showLayer onShowLayer={() => {}} clearToken={0} onDraw={() => {}} onReject={() => {}} onClear={() => {}} error={null}
      filters={filters} onFiltersChange={(value) => { onFiltersChange(value); setFilters(value) }} />
  )
}

async function mount(filters: ObservationFilters = emptyObservationFilters) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onFiltersChange = vi.fn()
  render(<QueryClientProvider client={client}><Workspace initial={filters} onFiltersChange={onFiltersChange} /></QueryClientProvider>)
  await screen.findByRole('radiogroup', { name: 'Seen by' })
  return { onFiltersChange, setFilters: (value: ObservationFilters) => act(() => applyFilters(value)) }
}
const atlas = () => map.props!.atlas!

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
afterEach(() => {
  cleanup()
  client?.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('fire atlas', () => {
  it('draws every detection in the browser and compares what MODIS and VIIRS saw', async () => {
    await mount()
    expect(screen.getByRole('heading', { name: 'Fire atlas' })).toBeInTheDocument()
    expect(screen.getByText('All years')).toBeInTheDocument()
    expect(screen.getByText('6 detections on 4 days')).toBeInTheDocument()
    expect(screen.getByText(/VIIRS recorded 2\.0× as many detections as MODIS/)).toBeInTheDocument()
    expect(atlas().visible).toHaveLength(6)
    expect(map.props!.apiAnalysisId).toBeUndefined()

    fireEvent.click(screen.getByRole('radio', { name: /^MODIS/ }))
    expect(atlas().visible.map((p) => p.properties.m)).toEqual([1, 1])
    expect(screen.getByText('MODIS saw 2 of the 6 detections in this period.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /^VIIRS/ }))
    expect(atlas().visible).toHaveLength(4)
    expect(screen.getByText('VIIRS saw 4 detections, 2.0× as many as MODIS.')).toBeInTheDocument()
  })

  it('follows the workspace period and hands its own back', async () => {
    const view = await mount()
    view.setFilters({ sourceId: '', start: '2022-07-01', endExclusive: '2022-08-01' })
    expect(screen.getByText('July 2022')).toBeInTheDocument()
    expect(screen.getByText('5 detections on 3 days')).toBeInTheDocument()
    expect(atlas().visible).toHaveLength(5)
    expect(atlas().focus?.bounds).toEqual([-5.52, 35.09, -5.49, 35.12])
    fireEvent.click(screen.getByRole('button', { name: 'Show all years' }))
    expect(view.onFiltersChange).toHaveBeenCalledWith({ sourceId: '', start: '', endExclusive: '' })
    expect(atlas().visible).toHaveLength(6)
  })

  it('explains what is under a circle in plain language', async () => {
    const view = await mount()
    act(() => atlas().onPick({ indices: [1, 2, 3, 4], lngLat: [-5.5, 35.1] }))
    const popup = within(atlas().popup!.node)
    expect(popup.getByText('4 detections')).toBeTruthy()
    expect(popup.getByText(/on 2 days · 10–11 Jul 2022/)).toBeTruthy()
    expect(popup.getByText('NOAA-20')).toBeTruthy()
    expect(popup.getByText('20.0 MW')).toBeTruthy()

    act(() => atlas().onPick({ indices: [3], lngLat: [-5.5, 35.11] }))
    const single = within(atlas().popup!.node)
    expect(single.getByText(/NOAA-20 · VIIRS · 375 m pixel/)).toBeTruthy()
    expect(single.getByText('5.0 MW')).toBeTruthy()
    fireEvent.click(single.getByRole('button', { name: 'Show all fires that day' }))
    expect(view.onFiltersChange).toHaveBeenCalledWith({ sourceId: '', start: '2022-07-10', endExclusive: '2022-07-11' })
    expect(atlas().popup).toBeNull()
  })

  it('replays the record day by day with a clock, and leaves the replay', async () => {
    await mount({ sourceId: '', start: '2022-07-01', endExclusive: '2022-08-01' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Replay the fires day by day' }))
    expect(screen.getByText('Replaying')).toBeInTheDocument()
    expect(atlas().replay).toMatchObject({ glowDays: 3 })
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(screen.getByText('11 Jul 2022')).toBeInTheDocument()
    expect(atlas().replay!.now).toBeGreaterThan(Date.parse('2022-07-11T00:00:00Z'))
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }))
    expect(screen.getByText('Replay paused')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Leave the replay' }))
    expect(atlas().replay).toBeNull()
    expect(screen.queryByText('Replay paused')).toBeNull()
  })
})
