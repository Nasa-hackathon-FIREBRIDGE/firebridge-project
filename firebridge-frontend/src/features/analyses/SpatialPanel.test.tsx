// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../../lib/axios'
import { envelope } from '../../services/test-fixtures'
import { resultFixtures } from '../../services/results.test-fixtures'
import { SpatialPanel } from './SpatialPanel'
import { emptyObservationFilters, type ObservationFilters } from '../observations/filters'

vi.mock('../../components/MapView', () => ({
  MapView: ({ apiAnalysisId, nativeRecords }: { apiAnalysisId?: string; nativeRecords?: unknown[] }) => <div data-testid="map-mode">{apiAnalysisId ? `Aggregate ${apiAnalysisId}` : nativeRecords ? `Loaded records ${nativeRecords.length}` : 'No records'}</div>,
}))
const original = api.defaults.adapter
let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); api.defaults.adapter = original })
function mount(filters = emptyObservationFilters) {
  const requests: Record<string, unknown>[] = []
  api.defaults.adapter = async (config) => {
    // Only record-page requests matter here; analysis metadata and summaries are always read.
    if (/\/detections/.test(config.url ?? '') && config.params?.limit !== 5000) requests.push(config.params)
    return { config, status: 200, statusText: 'OK', headers: {}, data: envelope(resultFixtures.detections) }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const panel = (value: ObservationFilters) => <QueryClientProvider client={client}><SpatialPanel area={null} analysisId="saved-analysis" showLayer onShowLayer={() => {}} clearToken={0} onDraw={() => {}} onReject={() => {}} onClear={() => {}} error={null} filters={value} /></QueryClientProvider>
  const view = render(panel(filters))
  return { requests, setFilters: (value: ObservationFilters) => view.rerender(panel(value)) }
}
it('does not fetch record pages in aggregate mode and labels filtered maps as loaded records', async () => {
  const view = mount()
  await screen.findByText('Aggregate saved-analysis')
  expect(view.requests).toHaveLength(0)
  view.setFilters({ sourceId: 'source', start: '2024-07-15', endExclusive: '2024-07-16' })
  await screen.findByText('Loaded records 1')
  expect(view.requests[0]).toMatchObject({ source_ids: 'source', start: '2024-07-15T00:00:00Z', end_exclusive: '2024-07-16T00:00:00Z' })
  expect(screen.queryByText('Aggregate saved-analysis')).toBeNull()
  expect(screen.getByText(/Only loaded records appear on the map/)).toBeTruthy()
  view.setFilters(emptyObservationFilters)
  await screen.findByText('Aggregate saved-analysis')
})
it('blocks an invalid interval without requesting or displaying aggregate results', async () => {
  const view = mount({ sourceId: '', start: '2024-07-17', endExclusive: '2024-07-15' })
  await screen.findByText('Loaded records 0')
  expect(screen.getByText('Correct the date interval to load records.')).toBeTruthy()
  await waitFor(() => expect(view.requests).toHaveLength(0))
  expect(screen.queryByText('Aggregate saved-analysis')).toBeNull()
})
