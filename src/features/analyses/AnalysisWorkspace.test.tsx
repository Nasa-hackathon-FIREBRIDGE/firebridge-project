// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import api from '../../lib/axios'
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
  MapView: ({ apiAnalysisId }: { apiAnalysisId?: string }) => (
    <div data-testid="api-map">
      {apiAnalysisId ? `API layer ${apiAnalysisId}` : 'No API tiles requested'}
    </div>
  ),
}))
const original = api.defaults.adapter
const areaId = '11111111-1111-4111-8111-111111111111'
const analysisId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const clients: QueryClient[] = []
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
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
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
  it('keeps the geometry label stable and focuses invalid geometry without sending a creation request', () => {
    const requests = installApi({ ready: true })
    mount()
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Invalid draft' } })
    fireEvent.change(screen.getByLabelText('GeoJSON Polygon'), { target: { value: 'not JSON' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))
    const geometry = screen.getByLabelText('GeoJSON Polygon')
    expect(geometry.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(geometry)
    expect(requests.some((request) => request.url === '/areas')).toBe(false)
  })
  it('keeps liveness independent of unavailable catalogue and shows an honest empty workflow', async () => {
    const requests = installApi()
    mount()
    await screen.findByText('alive')
    expect(screen.getByText('not ready')).toBeTruthy()
    expect(screen.getByText(/data dependencies are not ready/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Request analysis' }).hasAttribute('disabled')).toBe(
      false,
    ) // Disabled through the fieldset.
    expect(
      screen.getByRole('button', { name: 'Request analysis' }).closest('fieldset')?.disabled,
    ).toBe(true)
    expect(requests.every((r) => r.url.startsWith('/health/'))).toBe(true)
    expect(await screen.findByText('No API tiles requested')).toBeTruthy()
  })
  it('creates an area, submits the exact analysis defaults, shows partial components and queues an export', async () => {
    const requests = installApi({ ready: true })
    mount()
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
