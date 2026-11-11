// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AxiosError } from 'axios'
import type { AnalysisView } from '@firebridge/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../../lib/axios'
import { apiKeys } from '../../services/api.keys'
import { resultFixtures } from '../../services/results.test-fixtures'
import {
  acceptedFixture,
  analysisFixture,
  areaFixture,
  envelope,
  jobFixture,
  readyFixture,
} from '../../services/test-fixtures'
import AnalysisWorkspace from './AnalysisWorkspace'

// WebGL is tested separately. These tests exercise real components, hooks and Axios services.
vi.mock('../../components/MapView', () => ({
  MapView: ({ apiAnalysisId, footer }: { apiAnalysisId?: string; footer?: unknown }) => (
    <div data-testid="api-map">
      {footer ? 'Fire atlas' : apiAnalysisId ? `API layer ${apiAnalysisId}` : 'No API tiles requested'}
    </div>
  ),
}))
const original = api.defaults.adapter
const areaId = '11111111-1111-4111-8111-111111111111'
const analysisId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const clients: QueryClient[] = []
// The preparation globe is a decorative canvas; jsdom has no 2D context, so the scene stays inert.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  api.defaults.adapter = original
  vi.restoreAllMocks()
})
function mount(search = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analyses' + search]}>
        <AnalysisWorkspace />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
function LocationProbe() { const location = useLocation(); return <output aria-label="Current workspace URL">{location.pathname}{location.search}{location.hash}</output> }
function installApi({ ready = false, missing = false, failed = false, expired = false } = {}) {
  const requests: { url: string; body: unknown; key: unknown }[] = []
  api.defaults.adapter = async (config) => {
    requests.push({
      url: config.url!,
      body: config.data ? JSON.parse(config.data) : null,
      key: config.headers.get('Idempotency-Key'),
    })
    let data: unknown
    let status = 200
    if (config.url === '/health/live')
      data = { status: 'ok', service: 'api', uptimeMs: 1, timestamp: 'now' }
    else if (config.url === '/health/ready') {
      data = {
        ...readyFixture,
        status: ready ? 'ok' : 'error',
        checks: { ...readyFixture.checks, catalogue: ready ? 'ready' : 'unavailable' },
      }
      if (!ready)
        throw new AxiosError('Not ready', 'ERR_BAD_RESPONSE', config, undefined, {
          config,
          status: 503,
          statusText: 'Not ready',
          headers: {},
          data: envelope(data),
        })
    } else if (config.url === '/areas' && config.method === 'post') {
      data = { ...areaFixture, id: areaId }
      status = 201
    } else if (config.url === `/areas/${areaId}`) data = { ...areaFixture, id: areaId }
    else if (config.url === '/analyses' && config.method === 'post') {
      data = { ...acceptedFixture, id: analysisId, job_id: jobId, area_id: areaId }
      status = 202
    } else if (config.url === `/analyses/${analysisId}/exports`) {
      data = {
        job_id: jobId,
        analysis_id: analysisId,
        status: 'queued',
        format: 'csv',
        status_url: `/api/v1/jobs/${jobId}`,
        created_at: 'now',
      }
      status = 202
    } else if (config.url?.startsWith('/releases/')) data = resultFixtures.release
    else if (config.url === `/analyses/${analysisId}/summary`) data = resultFixtures.summary
    else if (config.url === `/analyses/${analysisId}/calendar`) data = resultFixtures.calendar
    else if (config.url === `/analyses/${analysisId}/detections`) data = resultFixtures.detections
    else if (config.url === `/analyses/${analysisId}` && !missing)
      data = { ...analysisFixture, id: analysisId, area_id: areaId, status: 'partial', job: null }
    else if (config.url === `/jobs/${jobId}`)
      data = {
        ...jobFixture,
        id: jobId,
        analysis_id: analysisId,
        status: failed ? 'failed' : 'succeeded',
        current_stage: failed ? 'failed' : 'completed',
        retryable: failed,
        error_code: failed ? 'TEST_ERROR' : null,
        expires_at: expired ? '2000-01-01T00:00:00Z' : null,
        download_url: `/api/v1/jobs/${jobId}/download?signature=never-display`,
      }
    else
      throw new AxiosError('Missing', 'ERR_BAD_RESPONSE', config, undefined, {
        config,
        status: 404,
        statusText: 'Missing',
        headers: {},
        data: { ...envelope(null), message: 'Missing', code: 'NOT_FOUND' },
      })
    return { config, status, statusText: 'OK', headers: {}, data: envelope(data) }
  }
  return requests
}

describe('API workspace integration with isolated HTTP responses', () => {
  it.each(['accepted', 'rejected'])('shows preparation while the initial request is pending and removes it when %s', async (outcome) => {
    installApi({ ready: true })
    const delegate = api.defaults.adapter as import('axios').AxiosAdapter
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })
    api.defaults.adapter = async (config) => {
      if (config.url === '/analyses' && config.method === 'post') {
        await pending
        if (outcome === 'rejected') throw new AxiosError('offline', 'ERR_NETWORK', config)
      }
      return delegate(config)
    }
    mount(`?area=${areaId}`)
    await screen.findByRole('heading', { name: 'TEST ONLY area' })
    fireEvent.change(screen.getByLabelText('Start date (UTC)'), { target: { value: '2024-01-01' } })
    fireEvent.change(screen.getByLabelText('End date, exclusive (UTC)'), { target: { value: '2024-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request analysis' }))
    const preparation = await screen.findByRole('region', { name: 'Analysis preparation' })
    expect(within(preparation).getByRole('status')).toHaveTextContent('Sending your request')
    expect(screen.getByRole('button', { name: 'Submitting analysis…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(preparation).toBeVisible()
    await act(async () => { release() })
    if (outcome === 'accepted') await screen.findByRole('heading', { name: 'TEST ONLY area', level: 1 })
    else await screen.findByText('We couldn’t connect to the server.')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Analysis preparation' })).not.toBeInTheDocument())
  })
  it('keeps the same preparation view from acceptance until the new analysis is first read', async () => {
    installApi({ ready: true })
    const delegate = api.defaults.adapter as import('axios').AxiosAdapter
    let release: () => void = () => {}
    const firstRead = new Promise<void>((resolve) => { release = resolve })
    api.defaults.adapter = async (config) => {
      if (config.url === `/analyses/${analysisId}`) await firstRead
      return delegate(config)
    }
    mount(`?area=${areaId}`)
    await screen.findByRole('heading', { name: 'TEST ONLY area' })
    fireEvent.change(screen.getByLabelText('Start date (UTC)'), { target: { value: '2024-01-01' } })
    fireEvent.change(screen.getByLabelText('End date, exclusive (UTC)'), { target: { value: '2024-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request analysis' }))
    const preparation = await screen.findByRole('region', { name: 'Analysis preparation' })
    expect(within(preparation).getByText('TEST ONLY area')).toBeVisible()
    expect(within(preparation).getByText('1 Jan 2024')).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('Current workspace URL')).toHaveTextContent(`analysis=${analysisId}`))
    await waitFor(() => expect(within(preparation).getByRole('status')).toHaveTextContent('Your request is queued'))
    expect(screen.getByRole('region', { name: 'Analysis preparation' })).toBe(preparation)
    expect(within(preparation).getByRole('listitem', { current: 'step' })).toHaveTextContent('Queue')
    expect(screen.queryByText('Loading the selected analysis…')).not.toBeInTheDocument()
    await act(async () => { release() })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Analysis preparation' })).not.toBeInTheDocument())
  })
  it('follows confirmed processing stages, including a partial analysis with an active job, across tabs', async () => {
    installApi({ ready: true })
    const delegate = api.defaults.adapter as import('axios').AxiosAdapter
    let current: AnalysisView = {
      ...analysisFixture, id: analysisId, area_id: areaId, status: 'queued',
      job: { id: jobId, status: 'queued', progress: { stage: 'queued' }, attempt: 0 },
    }
    api.defaults.adapter = async (config) => {
      const response = await delegate(config)
      return config.url === `/analyses/${analysisId}` ? { ...response, data: envelope(current) } : response
    }
    mount(`?analysis=${analysisId}`)
    const preparation = await screen.findByRole('region', { name: 'Analysis preparation' })
    expect(within(preparation).getByRole('status')).toHaveTextContent('Your request is queued')
    fireEvent.click(screen.getByRole('tab', { name: 'Data & provenance' }))
    expect(preparation).toBeVisible()
    const update = async (status: AnalysisView['status'], stage: unknown) => {
      current = { ...current, status, job: { ...current.job!, status: 'running', progress: stage } }
      await act(async () => { await clients.at(-1)!.refetchQueries({ queryKey: apiKeys.analysis(analysisId), exact: true }) })
    }
    await update('running', { stage: 'resolving_data' })
    await waitFor(() => expect(within(preparation).getByRole('status')).toHaveTextContent('Finding published observations'))
    await update('running', { stage: 'preparing_history' })
    await waitFor(() => expect(within(preparation).getByRole('status')).toHaveTextContent('Matching your area & dates'))
    await update('partial', { stage: 'retrying' })
    await waitFor(() => expect(within(preparation).getByRole('status')).toHaveTextContent('Retrying preparation'))
    await update('partial', ['unrecognised progress'])
    await waitFor(() => expect(within(preparation).getByRole('status')).toHaveTextContent('Your analysis is processing'))
    await update('partial', { stage: 'completed' })
    await waitFor(() => expect(within(preparation).getByRole('status')).toHaveTextContent('Finalising your results'))
    current = { ...current, status: 'partial', job: null }
    await act(async () => { await clients.at(-1)!.refetchQueries({ queryKey: apiKeys.analysis(analysisId), exact: true }) })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Analysis preparation' })).not.toBeInTheDocument())
    // Server tiles while every detection loads, then the in-browser fire atlas.
    expect(screen.getByTestId('api-map')).toHaveTextContent(new RegExp(`API layer ${analysisId}|Fire atlas`))
    await waitFor(() => expect(screen.getByTestId('api-map')).toHaveTextContent('Fire atlas'))
  })
  it.each([
    { status: 'ready' as const, job: null },
    { status: 'failed' as const, job: null },
    { status: 'unsupported' as const, job: null },
    { status: 'running' as const, job: { id: jobId, status: 'cancelled' as const, progress: {}, attempt: 1 } },
  ])('removes preparation on terminal analysis/job state $status / $job.status', async (terminal) => {
    installApi({ ready: true })
    const delegate = api.defaults.adapter as import('axios').AxiosAdapter
    let current: AnalysisView = { ...analysisFixture, id: analysisId, area_id: areaId, status: 'running' }
    api.defaults.adapter = async (config) => {
      const response = await delegate(config)
      return config.url === `/analyses/${analysisId}` ? { ...response, data: envelope(current) } : response
    }
    mount(`?analysis=${analysisId}`)
    await screen.findByRole('region', { name: 'Analysis preparation' })
    current = { ...current, ...terminal }
    await act(async () => { await clients.at(-1)!.refetchQueries({ queryKey: apiKeys.analysis(analysisId), exact: true }) })
    expect(clients.at(-1)!.getQueryData<AnalysisView>(apiKeys.analysis(analysisId))).toMatchObject(terminal)
    // Refetch resolves before React Query's scheduled observer notification commits to the DOM.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Analysis preparation' })).not.toBeInTheDocument())
  })
  it('stops illustrating preparation when a refresh cannot confirm the active analysis and preserves the retry error', async () => {
    installApi({ ready: true })
    const delegate = api.defaults.adapter as import('axios').AxiosAdapter
    let offline = false
    api.defaults.adapter = async (config) => {
      if (config.url === `/analyses/${analysisId}`) {
        if (offline) throw new AxiosError('offline', 'ERR_NETWORK', config)
        return { config, status: 200, statusText: 'OK', headers: {}, data: envelope({ ...analysisFixture, id: analysisId, area_id: areaId, status: 'running' }) }
      }
      return delegate(config)
    }
    mount(`?analysis=${analysisId}`)
    await screen.findByRole('region', { name: 'Analysis preparation' })
    offline = true
    await act(async () => { await clients.at(-1)!.refetchQueries({ queryKey: apiKeys.analysis(analysisId), exact: true }) })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Analysis preparation' })).not.toBeInTheDocument()
      expect(screen.getByText('We couldn’t connect to the server.')).toBeVisible()
      expect(screen.getByText(/Previously loaded analysis details are shown/)).toBeVisible()
    })
  })
  it('keeps the geometry label stable and focuses invalid geometry without sending a creation request', () => {
    const requests = installApi({ ready: true })
    mount()
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Invalid draft' } })
    fireEvent.click(screen.getByText('Paste GeoJSON · advanced'))
    fireEvent.change(screen.getByLabelText('GeoJSON Polygon'), { target: { value: 'not JSON' } })
    fireEvent.click(screen.getByText('Paste GeoJSON · advanced'))
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))
    const geometry = screen.getByLabelText('GeoJSON Polygon')
    expect(geometry.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(geometry)
    expect(geometry.closest('details')?.open).toBe(true)
    expect(document.getElementById('geometry-error')).toBeVisible()
    expect(requests.some((request) => request.url === '/areas')).toBe(false)
  })
  it('keeps liveness independent of unavailable catalogue and shows an honest empty workflow', async () => {
    const requests = installApi()
    mount()
    await screen.findByText('alive')
    expect(screen.getByText('not ready')).toBeTruthy()
    expect(screen.getByText(/data dependencies are not ready/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Request analysis' }).hasAttribute('disabled')).toBe(
      true,
    ) // Both the native fieldset and the visible disabled-reason button enforce the same area guard.
    expect(
      screen.getByRole('button', { name: 'Request analysis' }).closest('fieldset')?.disabled,
    ).toBe(true)
    expect(requests.every((r) => r.url.startsWith('/health/'))).toBe(true)
    expect(screen.getByText(/^Filters affect matching loaded\/paginated map records/)).toBeVisible()
    expect(await screen.findByText('No API tiles requested')).toBeTruthy()
  })
  it('creates an area, submits the exact analysis defaults, shows partial components and queues an export', async () => {
    const requests = installApi({ ready: true })
    mount()
    expect(screen.queryByRole('button', { name: /Copy accepted/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'My study area' } })
    fireEvent.change(screen.getByLabelText('GeoJSON Polygon'), {
      target: { value: JSON.stringify(areaFixture.geometry) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))
    await screen.findByText('Area saved. Ready for analysis.')
    expect(await screen.findByText('not prepared')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Start date (UTC)'), { target: { value: '2024-01-01' } })
    fireEvent.change(screen.getByLabelText('End date, exclusive (UTC)'), {
      target: { value: '2024-01-02' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request analysis' }))
    await screen.findByText(/Partial analysis\./)
    // jsdom has no scrolling implementation; real scrolling is checked in Chrome.
    document.getElementById('request-analysis')!.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('button', { name: 'Open workflow' }))
    expect(screen.getByRole('button', { name: `Copy accepted analysis ID: ${analysisId}` })).toBeVisible()
    expect(screen.getByRole('button', { name: `Copy accepted job ID: ${jobId}` })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Component availability' })
    expect(within(table).getByText('ready')).toBeTruthy()
    expect(within(table).getByText('missing')).toBeTruthy()
    expect(await screen.findByText(`API layer ${analysisId}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Observations' }))
    await screen.findByRole('table', {
      name: 'Native detection records from the selected analysis',
    })
    expect(screen.getAllByRole('heading', { name: 'Observation records' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Context & notes' }))
    expect(screen.getAllByRole('heading', { name: 'Analysis context' })).toHaveLength(1)
    const request = requests.find((r) => r.url === '/analyses')!
    expect(request.body).toEqual({
      area_id: areaId,
      start_date: '2024-01-01',
      end_date_exclusive: '2024-01-02',
      metric_key: 'native_detections_v1',
      grid_id: null,
      data_mode: 'standard_only',
    })
    expect(request.key).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Exports' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare export' }))
    await screen.findByRole('button', { name: 'Download file' })
    expect(screen.getByText('Progress not supplied')).toBeVisible()
    expect(requests.find((r) => r.url.endsWith('/exports'))?.key).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Observations' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Exports' }))
    await screen.findByRole('button', { name: 'Download file' })
    expect(requests.filter((r) => r.url.endsWith('/exports'))).toHaveLength(1)
    expect(document.body.textContent).not.toContain('never-display')
  })
  it('shows missing analyses and never requests their result tiles or exports', async () => {
    const requests = installApi({ missing: true })
    mount(`?analysis=${analysisId}`)
    await screen.findByText('This resource was not found. Check its identifier.')
    expect(screen.queryByRole('button', { name: 'Prepare export' })).toBeNull()
    expect(requests.some((r) => /tiles|exports/.test(r.url))).toBe(false)
  })
  it('preserves tab keyboard, query/hash and mounted map identity', async () => {
    installApi({ ready: true })
    mount(`?analysis=${analysisId}`)
    const map = await screen.findByTestId('api-map')
    const mapTab = screen.getByRole('tab', { name: 'Map workspace' })
    mapTab.focus()
    fireEvent.keyDown(mapTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus()
    expect(screen.getByRole('status', { name: 'Current workspace URL' })).toHaveTextContent(`/analyses?analysis=${analysisId}#analysis-overview`)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Exports' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Exports' }), { key: 'Home' })
    expect(mapTab).toHaveFocus()
    expect(screen.getByRole('status', { name: 'Current workspace URL' })).toHaveTextContent(`/analyses?analysis=${analysisId}`)
    expect(screen.getByTestId('api-map')).toBe(map)
  })
  it('keeps invalid interval reasons visible without requesting an analysis', async () => {
    const requests = installApi({ ready: true })
    mount(`?area=${areaId}`)
    await screen.findByRole('heading', { name: 'TEST ONLY area' })
    const submit = screen.getByRole('button', { name: 'Request analysis' })
    expect(submit).toHaveAccessibleDescription('Select a start and end date')
    fireEvent.change(screen.getByLabelText('Start date (UTC)'), { target: { value: '2024-07-18' } })
    fireEvent.change(screen.getByLabelText('End date, exclusive (UTC)'), { target: { value: '2024-07-15' } })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription('The exclusive end must be after a valid start date')
    expect(requests.some(request => request.url === '/analyses')).toBe(false)
  })
  it('opens metadata and focuses a timezone validation error without sending a request', () => {
    const requests = installApi({ ready: true })
    mount()
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Timezone validation QA' } })
    fireEvent.change(screen.getByLabelText('GeoJSON Polygon'), { target: { value: JSON.stringify(areaFixture.geometry) } })
    fireEvent.click(screen.getByText('Area metadata · version, timezone and provenance'))
    fireEvent.change(screen.getByLabelText('Display timezone'), { target: { value: 'Invalid/Zone' } })
    fireEvent.click(screen.getByText('Area metadata · version, timezone and provenance'))
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))
    expect(screen.getByLabelText('Display timezone')).toHaveFocus()
    expect(document.getElementById('area-timezone-error')).toBeVisible()
    expect(requests.some(request => request.url === '/areas')).toBe(false)
  })
  it('reveals an empty required metadata field before native form validation', () => {
    const requests = installApi()
    mount()
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Required metadata QA' } })
    fireEvent.change(screen.getByLabelText('GeoJSON Polygon'), { target: { value: JSON.stringify(areaFixture.geometry) } })
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))
    expect(screen.getByLabelText('Version').closest('details')).toHaveAttribute('open')
    expect(requests.some(request => request.url === '/areas')).toBe(false)
  })
  it('shows API unavailability without falling back to demo results', async () => {
    api.defaults.adapter = async (config) => {
      throw new AxiosError('offline', 'ERR_NETWORK', config)
    }
    mount()
    await waitFor(() => expect(screen.getAllByText('We couldn’t connect to the server.')).toHaveLength(2))
    expect(document.body.textContent).not.toContain('synthetic records')
  })
  it.each([{ failed: true }, { expired: true }])(
    'keeps an unavailable export undownloadable: %j',
    async (state) => {
      installApi({ ready: true, ...state })
      mount(`?analysis=${analysisId}`)
      fireEvent.click(screen.getByRole('tab', { name: 'Exports' }))
      await screen.findByRole('button', { name: 'Prepare export' })
      fireEvent.click(screen.getByRole('button', { name: 'Prepare export' }))
      if (state.failed) {
        await screen.findByText(/server allows recovery/)
        expect(screen.getByRole('button', { name: 'Download file' }).hasAttribute('disabled')).toBe(
          true,
        )
      } else await screen.findByText('Export expired. Request a new export.')
    },
  )
  it('blocks duplicate area submissions while the first HTTP request is pending', async () => {
    installApi()
    const delegate = api.defaults.adapter as import('axios').AxiosAdapter
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let posts = 0
    api.defaults.adapter = async (config) => {
      if (config.url === '/areas') {
        posts++
        await pending
      }
      return delegate(config)
    }
    mount()
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Area' } })
    fireEvent.change(screen.getByLabelText('GeoJSON Polygon'), {
      target: { value: JSON.stringify(areaFixture.geometry) },
    })
    const form = screen.getByRole('button', { name: 'Save area' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(posts).toBe(1))
    await act(async () => {
      release()
    })
    await screen.findByText('Area saved. Ready for analysis.')
  })
})
