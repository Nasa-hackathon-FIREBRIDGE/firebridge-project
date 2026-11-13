// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import api from '../lib/axios'
import { analysisFixture, areaFixture, envelope } from '../services/test-fixtures'
import VisualizationPage from './VisualizationPage'

const adapter = api.defaults.adapter
let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); api.defaults.adapter = adapter; vi.restoreAllMocks() })

function mount(selected = true, full = false, listCursors?: (string | undefined)[]) {
  const requests: Record<string, unknown>[] = []
  const analysis = { ...analysisFixture, id: 'saved-analysis', status: 'ready', start_date: full ? '2024-01-01' : '2024-01-17', end_date_exclusive: full ? '2026-01-01' : '2024-01-20', job: null }
  api.defaults.adapter = async (config) => {
    const path = config.url!
    let data: unknown
    if (path === '/analyses') {
      if (listCursors) listCursors.push(config.params.cursor)
      data = listCursors && config.params.cursor
        ? { analyses: [{ ...analysis, id: 'older-analysis' }], nextCursor: null }
        : { analyses: [analysis], nextCursor: listCursors ? 'next-page' : null }
    }
    else if (path.startsWith('/areas/')) data = areaFixture
    else if (path === '/catalog') data = { scope_key: 'test', releases: [], sources: [{ source_id: 'aqua', platform: 'Aqua', product: 'test', collection: '6.1', instrument: 'MODIS', processing_stream: 'standard' }] }
    else if (path.endsWith('/calendar')) {
      requests.push(config.params)
      const counts = (a: string, t: string | null, tState: string) => [{ source_id: 'aqua', count: a, count_status: 'complete' }, { source_id: 'terra', count: t, count_status: tState }, { source_id: 'noaa21', count: null, count_status: 'unknown' }]
      const periods = full ? Array.from({ length: 24 }, (_, i) => ({
        start: new Date(Date.UTC(2024, i, 1)).toISOString(), end_exclusive: new Date(Date.UTC(2024, i + 1, 1)).toISOString(), counts_by_source: counts(String(i % 12 + 1 + Math.floor(i / 12) * 3), String(25 - i), 'complete'),
      })) : config.params.resolution === 'month' ? [
        { start: '2024-01-17T00:00:00Z', end_exclusive: '2024-01-20T00:00:00Z', counts_by_source: counts('3', '2', 'lower_bound') },
      ] : [
        { start: '2024-01-17T00:00:00Z', end_exclusive: '2024-01-18T00:00:00Z', counts_by_source: counts('3', null, 'unknown') },
        { start: '2024-01-18T00:00:00Z', end_exclusive: '2024-01-19T00:00:00Z', counts_by_source: counts('0', '2', 'lower_bound') },
      ]
      data = { analysis_id: analysis.id, data_release_id: 'release', status: 'partial', resolution: config.params.resolution, periods }
    } else data = analysis
    return { config, status: 200, statusText: 'OK', headers: {}, data: envelope(data) }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[selected ? `/visualization?analysis=${analysis.id}` : '/visualization']}><VisualizationPage /></MemoryRouter></QueryClientProvider>)
  return requests
}

async function table() {
  fireEvent.click(await screen.findByText(/^View exact counts/))
  return screen.findByRole('table')
}

describe('D3 visual analytics lab', () => {
  it('shares the monthly request and preserves unknown and lower-bound counts in the evidence table', async () => {
    const requests = mount()
    const exact = await table()
    expect(within(exact).getByText('Unknown')).toBeTruthy()
    expect(within(exact).getByText('≥ 2')).toBeTruthy()
    expect(requests).toEqual([{ start_date: '2024-01-17', end_date_exclusive: '2024-01-20', resolution: 'month' }])
    expect(screen.getByRole('img', { name: 'Inventory continuity by source' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Harmonized fire calendar/ }).getAttribute('href')).toBe('/analyses?analysis=saved-analysis#fire-calendar')
    expect(screen.getByRole('link', { name: /MODIS–VIIRS sensor bridge/ }).getAttribute('href')).toBe('/analyses?analysis=saved-analysis#sensor-bridge')
    expect(screen.getByText('No exact full-month counts in this interval. Widen the dates or choose another source; partial values are not substituted.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download SVG: Monthly variability' }).hasAttribute('disabled')).toBe(true)
  })
  it('applies inclusive end dates as exclusive UTC boundaries', async () => {
    const requests = mount()
    await table()
    fireEvent.change(screen.getByLabelText('Visualization start date'), { target: { value: '2024-01-18' } })
    fireEvent.change(screen.getByLabelText('Visualization end date'), { target: { value: '2024-01-18' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
    await waitFor(() => expect(requests.at(-1)).toEqual({ start_date: '2024-01-18', end_date_exclusive: '2024-01-19', resolution: 'month' }))
  })
  it('rejects out-of-study dates without issuing another request', async () => {
    const requests = mount()
    await table()
    fireEvent.change(screen.getByLabelText('Visualization start date'), { target: { value: '2023-01-01' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Apply dates' }).closest('form')!)
    expect(screen.getByRole('alert').textContent).toContain('inside the saved analysis')
    expect(requests).toHaveLength(1)
  })
  it('keeps chart statistics monthly while changing the exact evidence to daily detail', async () => {
    const requests = mount()
    await table()
    fireEvent.change(screen.getByLabelText('Visualization grouping'), { target: { value: 'day' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
    await waitFor(() => expect(requests.at(-1)?.resolution).toBe('day'))
    expect(requests).toHaveLength(2)
    fireEvent.click(await screen.findByText(/^View exact counts/))
    expect(within(screen.getByRole('table')).getByText('0')).toBeTruthy()
  })
  it('waits for an analysis selection', async () => {
    const requests = mount(false)
    expect(screen.getByText(/Select an analysis to load its charts/)).toBeTruthy()
    await screen.findByRole('option', { name: /saved-an/ })
    expect(requests).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Saved analysis for visualization'), { target: { value: 'saved-analysis' } })
    await table()
    expect(requests).toHaveLength(1)
  })
  it('loads every saved-analysis page automatically without a load-more button', async () => {
    const cursors: (string | undefined)[] = []
    mount(false, false, cursors)
    await screen.findByRole('option', { name: /older-an/ })
    expect(cursors).toEqual([undefined, 'next-page'])
    expect(screen.queryByRole('button', { name: /Load more analyses/i })).toBeNull()
    expect(screen.queryByText('Loading saved analyses…')).toBeNull()
    expect(screen.getByLabelText('Saved analysis for visualization').hasAttribute('disabled')).toBe(false)
  })
  it('renders seven complementary analytical views without the overview calendar or native timeline', async () => {
    mount(true, true)
    await screen.findByRole('img', { name: 'Monthly composition treemap' })
    const legend = screen.getByRole('list', { name: 'All months in the 2025 treemap' })
    expect(within(legend).getAllByRole('button')).toHaveLength(12)
    for (const month of ['Jan', 'May', 'Dec']) expect(within(legend).getByRole('button', { name: new RegExp(`^${month} 2025:`) })).toBeTruthy()
    fireEvent.click(within(legend).getByRole('button', { name: /^Jan 2025:/ }))
    expect(within(screen.getByRole('figure', { name: 'Anatomy of a year' })).getByRole('status').textContent).toContain('Jan 2025')
    for (const name of ['Distribution of monthly detections by source', 'Paired monthly source counts', 'Paired monthly year-over-year differences', 'Ranked monthly concentration curve', 'Seasonal similarity between years'])
      expect(screen.getByRole('img', { name })).toBeTruthy()
    expect(screen.getAllByRole('figure')).toHaveLength(7)
    expect(screen.queryByText('Monthly activity calendar')).toBeNull()
    expect(screen.queryByText('Native detections over time · UTC')).toBeNull()
  })
  it('updates the focus-source analytics and prevents stale inspected values after deselection', async () => {
    mount(true, true)
    const treemap = await screen.findByRole('figure', { name: 'Anatomy of a year' })
    expect(within(treemap).getByText(/Aqua · 6.1/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Focus source for diagnostics'), { target: { value: 'terra' } })
    expect(within(treemap).getByText(/terra · 12\/12/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /terra/ }))
    expect((screen.getByLabelText('Focus source for diagnostics') as HTMLSelectElement).value).toBe('aqua')
    expect(within(treemap).queryByText(/terra · 12\/12/)).toBeNull()
  })
  it('supports keyboard inventory inspection and an empty selection without fabricated charts', async () => {
    mount()
    const ribbon = await screen.findByRole('img', { name: 'Inventory continuity by source' })
    fireEvent.keyDown(ribbon, { key: 'ArrowDown' })
    expect(within(ribbon.closest('figure')!).getByRole('status').textContent).toContain('noaa21')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    expect(screen.getByText('Select a source to inspect its inventory.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download calendar CSV/ }).hasAttribute('disabled')).toBe(true)
  })
})
