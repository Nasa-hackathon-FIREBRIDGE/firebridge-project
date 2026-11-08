// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../../lib/axios'
import { envelope } from '../../services/test-fixtures'
import { resultFixtures as fixtures } from '../../services/results.test-fixtures'
import { TemporalPanel, SourceComparison } from './TemporalPanel'
import { emptyObservationFilters } from './filters'
import { MemoryRouter } from 'react-router-dom'

const original = api.defaults.adapter
let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); api.defaults.adapter = original })
function mount(children: React.ReactNode, data: unknown) {
  api.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: envelope(data) })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>)
}
it('selects an actual UTC calendar interval and toggles it off without simulating dates', async () => {
  const onChange = vi.fn()
  const row = fixtures.calendar.periods[0]
  const view = mount(<TemporalPanel analysisId="analysis" filters={emptyObservationFilters} onChange={onChange} />, fixtures.calendar)
  const button = await screen.findByRole('button', { name: new RegExp(row.start.slice(0, 10)) })
  fireEvent.click(button)
  const selected = { sourceId: '', start: row.start.slice(0, 10), endExclusive: row.end_exclusive.slice(0, 10) }
  expect(onChange).toHaveBeenLastCalledWith(selected)
  view.rerender(<QueryClientProvider client={client}><MemoryRouter><TemporalPanel analysisId="analysis" filters={selected} onChange={onChange} /></MemoryRouter></QueryClientProvider>)
  expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(button)
  expect(onChange).toHaveBeenLastCalledWith(emptyObservationFilters)
})
it('renders unknown inventory independently from a genuine zero', async () => {
  const data = { ...fixtures.calendar, periods: [
    { start: '2024-07-15T00:00:00Z', end_exclusive: '2024-07-16T00:00:00Z', counts_by_source: [{ source_id: 'source', count: null, count_status: 'unknown' }] },
    { start: '2024-07-16T00:00:00Z', end_exclusive: '2024-07-17T00:00:00Z', counts_by_source: [{ source_id: 'source', count: '0', count_status: 'complete' }] },
  ] }
  mount(<TemporalPanel analysisId="analysis" filters={emptyObservationFilters} onChange={() => {}} />, data)
  await screen.findByText('Unknown')
  expect(screen.getByText('0')).toBeTruthy()
  expect(document.querySelectorAll('.geo-unknown')).toHaveLength(1)
  expect((document.querySelectorAll('.geo-timeline-track i')[1] as HTMLElement).style.height).toBe('0%')
})
it('preserves large lower bounds and uses a shared source count scale', async () => {
  const source = fixtures.summary.native_detections_by_source[0]
  mount(<SourceComparison analysisId="analysis" />, { ...fixtures.summary, native_detections_by_source: [
    { ...source, source_id: 'large', count: '90071992547409930', count_status: 'lower_bound' },
    { ...source, source_id: 'small', count: '45035996273704965', count_status: 'complete' },
    { ...source, source_id: 'unknown', count: null, count_status: 'unknown' },
  ] })
  expect(await screen.findByText('≥ ' + BigInt('90071992547409930').toLocaleString())).toBeTruthy()
  const bars = document.querySelectorAll<HTMLElement>('.geo-source-track i')
  expect([...bars].map((bar) => bar.style.width)).toEqual(['100%', '50%', '0%'])
  expect(screen.getByText('Unknown')).toBeTruthy()
  expect(screen.getByText(/Sensor sampling, resolution and detection methods differ; these counts are not a harmonized fire response/)).toBeTruthy()
})
