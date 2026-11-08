// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it } from 'vitest'
import api from '../../lib/axios'
import { envelope } from '../../services/test-fixtures'
import { resultFixtures as fixtures } from '../../services/results.test-fixtures'
import { ObservationsPanel } from './ObservationsPanel'
const original = api.defaults.adapter
let client: QueryClient
const requests: { url: string; params: Record<string, unknown> }[] = []
afterEach(() => {
  cleanup()
  client.clear()
  api.defaults.adapter = original
  requests.length = 0
})
function mount(filters?: import('./filters').ObservationFilters) {
  api.defaults.adapter = async (config) => {
    requests.push({ url: config.url!, params: config.params })
    let data: unknown
    if (config.url?.endsWith('/summary')) data = fixtures.summary
    else if (config.url?.endsWith('/calendar'))
      data = {
        ...fixtures.calendar,
        periods: [
          {
            ...fixtures.calendar.periods[0],
            counts_by_source: [{ source_id: 'source', count: '0' }],
          },
        ],
      }
    else {
      const later = !!config.params?.cursor
      const filtered = !!config.params?.source_ids
      data = {
        ...fixtures.detections,
        features: [
          {
            ...fixtures.detections.features[0],
            properties: {
              ...fixtures.detections.features[0]!.properties,
              detection_id: later ? 'second' : 'first',
            },
          },
        ],
        next_cursor: later || filtered ? null : 'opaque-signed-cursor',
      }
    }
    return { config, status: 200, statusText: 'OK', headers: {}, data: envelope(data) }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ObservationsPanel analysisId="analysis" filters={filters} />
      </QueryClientProvider>
    </StrictMode>,
  )
}
it('pages real response shapes, resets a source filter, and never invents FRP or coverage', async () => {
  mount()
  await screen.findByText('#first')
  expect(screen.getByText('Not measured')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Load more records' }))
  await screen.findByText('#second')
  expect(requests.find((r) => r.params?.cursor)?.params.cursor).toBe('opaque-signed-cursor')
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter observation source' }), {
    target: { value: fixtures.summary.native_detections_by_source[0]!.source_id },
  })
  await waitFor(() => expect(screen.queryByText('#second')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Load more records' })).toBeNull()
  const filtered = requests.find((r) => r.params?.source_ids)
  expect(filtered?.params.cursor).toBeUndefined()
  expect(document.querySelectorAll('#observation-records')).toHaveLength(1)
})
it('renders a genuine zero daily count with a zero-height bar', async () => {
  mount()
  await screen.findByRole('img', { name: /0 records/ })
  expect((document.querySelector('.fb-activity-track i') as HTMLElement).style.height).toBe('0%')
})
it('keeps raw precision and null measurements in keyboard-accessible record details', async () => {
  mount()
  const opener = await screen.findByRole('button', { name: 'Inspect detection first' })
  opener.focus()
  fireEvent.click(opener)
  const details = screen.getByRole('region', { name: 'Selected detection details' })
  expect(details.textContent).toContain(fixtures.detections.features[0].properties.acquired_at)
  expect(details.textContent).toContain('Not measured')
  expect(details.textContent).toContain('synthetic_not_measured')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close detection details' }))
  fireEvent.keyDown(details, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Selected detection details' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inspect detection first' }))
})
it('applies search only to loaded records and preserves temporal constraints across pages', async () => {
  mount({ sourceId: '', start: '2024-07-15', endExclusive: '2024-07-16' })
  await screen.findByText('#first')
  fireEvent.click(screen.getByRole('button', { name: 'Load more records' }))
  await screen.findByText('#second')
  const later = requests.find((request) => request.params?.cursor)
  expect(later?.params).toMatchObject({ start: '2024-07-15T00:00:00Z', end_exclusive: '2024-07-16T00:00:00Z' })
  const before = requests.length
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded records' }), { target: { value: 'second' } })
  expect(screen.queryByText('#first')).toBeNull()
  expect(screen.getByText('#second')).toBeTruthy()
  expect(requests.length).toBe(before)
})
