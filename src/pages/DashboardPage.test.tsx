// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../lib/axios'
import { areaFixture, envelope, jobFixture, readyFixture } from '../services/test-fixtures'
import DashboardPage from './DashboardPage'
import { useWorkspaceAnalyses } from '../hooks/useWorkspace'

const areaId = '11111111-1111-4111-8111-111111111111'
const analysisId = '22222222-2222-4222-8222-222222222222'
const listAnalysis = {
  id: analysisId,
  area_id: areaId,
  release_id: 'release',
  status: 'partial',
  metric_key: 'native_detections_v1',
  data_mode: 'standard_only',
  grid_id: null,
  start_date: '2024-01-01',
  end_date_exclusive: '2024-01-02',
  time_basis: 'utc',
  created_at: '2026-11-07T10:00:00Z',
  completed_at: '2026-11-07T10:01:00Z',
}
const original = api.defaults.adapter
const clients: QueryClient[] = []
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  api.defaults.adapter = original
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function mount(children = <DashboardPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
}
function install({ empty = false, failJobs = false } = {}) {
  const calls: { url: string; params: Record<string, unknown> }[] = []
  api.defaults.adapter = async (config) => {
    const params = config.params ?? {}
    calls.push({ url: config.url!, params })
    if (config.url === '/jobs' && failJobs)
      throw new AxiosError('private SQL error', 'ERR_BAD_RESPONSE', config, undefined, {
        config,
        status: 500,
        statusText: 'Error',
        headers: {},
        data: {
          ...envelope(null),
          code: 'SERVER_ERROR',
          message: 'SQL password=secret /private/backend',
        },
      })
    const data =
      config.url === '/analyses'
        ? {
            analyses:
              empty || params.status === 'failed'
                ? []
                : [
                    {
                      ...listAnalysis,
                      ...(params.cursor ? { id: '33333333-3333-4333-8333-333333333333' } : {}),
                    },
                  ],
            nextCursor: empty || params.cursor || params.status ? null : 'page-two',
          }
        : config.url === '/areas'
          ? { areas: empty ? [] : [{ ...areaFixture, id: areaId }], nextCursor: null }
          : config.url === '/jobs'
            ? {
                jobs: empty
                  ? []
                  : [{ ...jobFixture, status: 'succeeded', current_stage: 'completed' }],
                nextCursor: null,
              }
            : config.url === '/catalog'
              ? { scope_key: 'public', sources: [], releases: [] }
              : config.url === '/health/live'
                ? { status: 'ok', service: 'api', uptimeMs: 10, timestamp: 'now' }
                : { ...readyFixture, status: 'ok' }
    return { config, status: 200, statusText: 'OK', headers: {}, data: envelope(data) }
  }
  return calls
}

describe('Real-record dashboard', () => {
  it('joins saved area names, scopes counts to loaded pages and does not eagerly read individual jobs', async () => {
    const calls = install()
    mount()
    await screen.findByRole('link', { name: /TEST ONLY area.*2024-01-01.*2024-01-02.*end excluded/ })
    await waitFor(() => expect(screen.getAllByText('TEST ONLY area').length).toBeGreaterThan(0))
    expect(screen.getByText(/not server-wide totals/)).toBeTruthy()
    expect(calls.filter((call) => call.url === '/analyses')).toHaveLength(1)
    expect(calls.filter((call) => call.url === '/jobs')).toHaveLength(1)
    expect(calls.some((call) => call.url.startsWith('/jobs/'))).toBe(false)
    expect(calls.some((call) => call.url.startsWith('/areas/'))).toBe(false)
    expect(screen.queryByText(/Synthetic detections/)).toBeNull()
  })
  it('uses the real nextCursor and resets pagination when the server-side status filter changes', async () => {
    const calls = install()
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more analyses' }))
    await screen.findByRole('link', { name: 'Open analysis 33333333-3333-4333-8333-333333333333' })
    expect(calls.filter((call) => call.url === '/analyses').at(-1)?.params.cursor).toBe('page-two')
    fireEvent.change(screen.getByLabelText('Filter analyses by status'), {
      target: { value: 'failed' },
    })
    await screen.findByText('No analyses with this status')
    expect(calls.filter((call) => call.url === '/analyses').at(-1)?.params).toEqual({
      limit: 20,
      status: 'failed',
    })
    expect(screen.queryByRole('link', { name: 'Open analysis 22222222-2222-4222-8222-222222222222' })).toBeNull()
  })
  it('keeps successful resources usable if the job endpoint fails and hides raw backend messages', async () => {
    install({ failJobs: true })
    mount()
    await screen.findByRole('link', { name: /TEST ONLY area.*2024-01-01.*2024-01-02.*end excluded/ })
    await screen.findByText('We couldn’t complete the processing job')
    expect(document.body.textContent).not.toMatch(/password=|private SQL|\/private\/backend/)
    expect(screen.queryByText('No processing activity yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
  it('renders an honest empty state without invented observations or coverage', async () => {
    install({ empty: true })
    mount()
    await screen.findByText('A clear starting point')
    expect(screen.getByRole('link', { name: 'Set up an analysis' }).getAttribute('href')).toBe(
      '/analyses',
    )
    expect(screen.getByText('No saved areas')).toBeTruthy()
    expect(
      within(
        screen.getByRole('region', { name: 'Analysis statistics for loaded records' }),
      ).getAllByText('0'),
    ).toHaveLength(8) // one accessible final value plus its aria-hidden visual copy per StatCard
  })
  it('stops list polling after processing becomes terminal', async () => {
    vi.useFakeTimers()
    let reads = 0
    api.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: envelope({
        analyses: [{ ...listAnalysis, status: ++reads === 1 ? 'running' : 'ready' }],
        nextCursor: null,
      }),
    })
    function PollingHarness() {
      const query = useWorkspaceAnalyses()
      return <output>{query.data?.pages[0].items[0].status}</output>
    }
    mount(<PollingHarness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(reads).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(reads).toBe(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(reads).toBe(2)
  })
  it('rejects malformed list responses instead of displaying zero analyses', async () => {
    api.defaults.adapter = async (config) => ({
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: envelope({ analyses: 'invalid', nextCursor: null }),
    })
    mount()
    await waitFor(() =>
      expect(screen.getAllByText('We couldn’t read the server response').length).toBeGreaterThan(0),
    )
    expect(screen.queryByText('A clear starting point')).toBeNull()
  })
})
