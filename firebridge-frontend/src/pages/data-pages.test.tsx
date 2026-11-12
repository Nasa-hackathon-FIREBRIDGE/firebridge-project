// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import api from '../lib/axios'
import ApiAnalysisPage from './ApiAnalysisPage'
import IngestionPage from './IngestionPage'
import { DetectionsPanel, SummaryPanel } from '../components/api/NativePanels'
import { ExplanationRequestPanel } from '../components/api/ExplanationRequestPanel'
import { ApiClientError } from '../lib/axios'
import { acceptedFixture, analysisFixture } from '../services/test-fixtures'
import { MemoryRouter } from 'react-router-dom'

const original = api.defaults.adapter
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
)
afterEach(() => {
  cleanup()
  client.clear()
  api.defaults.adapter = original
  localStorage.clear()
})
function respond(payload: (url: string, params: Record<string, unknown>) => unknown) {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {
      schema_version: '1',
      request_id: 'test',
      warnings: ['Test fixture'],
      data: payload(config.url!, config.params ?? {}),
    },
  })
}
describe('Connected data screens', () => {
  it('keeps incomplete counts unknown and shows API warnings', async () => {
    respond(() => ({
      status: 'partial',
      analysis_id: 'a',
      data_release_id: 'r',
      metric_key: 'native',
      native_detections_by_source: [
        {
          source_id: 'noaa21',
          count: null,
          observed_count: '0',
          count_status: 'unknown',
          inventory_status: 'partial',
        },
      ],
      comparable_response: { value: null },
      coverage: { fraction: null },
      limitations: ['DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS'],
    }))
    render(<SummaryPanel id="a" />, { wrapper })
    await screen.findByText('noaa21')
    expect(screen.getAllByText('Unknown / not available').length).toBeGreaterThan(0)
    expect(screen.getByText('Test fixture')).toBeTruthy()
    expect(screen.getByText('DETECTIONS_ARE_NOT_UNIQUE_INCIDENTS')).toBeTruthy()
  })
  it('resets a signed cursor when the user applies new detection filters', async () => {
    const requests: Record<string, unknown>[] = []
    respond((_url, params) => {
      requests.push(params)
      return { features: [], returned: 0, next_cursor: params.cursor ? null : 'signed-page2' }
    })
    render(<DetectionsPanel id="a" />, { wrapper })
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(requests.at(-1)?.cursor).toBe('signed-page2'))
    fireEvent.change(screen.getByLabelText(/Sources \(/), { target: { value: 'terra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(requests.at(-1)?.source_ids).toBe('terra'))
    expect(requests.at(-1)?.cursor).toBeUndefined()
  })
  it('opens a saved analysis and only requests the active results tab', async () => {
    const calls: string[] = []
    respond((url) => {
      calls.push(url)
      if (url.endsWith('/summary'))
        return {
          native_detections_by_source: [],
          comparable_response: { value: null },
          coverage: { fraction: null },
        }
      if (url.endsWith('/weather')) return { series: [], returned: 0, status: 'missing' }
      return {
        ...analysisFixture,
        id: 'a3000000-0000-4000-8000-000000000001',
        status: 'partial',
        release_id: 'r',
        job: null,
      }
    })
    render(<ApiAnalysisPage />, { wrapper })
    expect(calls).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Analysis ID'), {
      target: { value: 'a3000000-0000-4000-8000-000000000001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open analysis' }))
    await screen.findByRole('region', { name: 'Analysis summary' })
    fireEvent.click(screen.getByRole('tab', { name: 'Weather' }))
    await screen.findByText('Data status:')
    expect(calls.filter((url) => url.endsWith('/weather'))).toHaveLength(1)
    expect(calls.some((url) => url.endsWith('/reports'))).toBe(false)
  })
  it('retains detection filters and avoids another request when returning to a visited results tab', async () => {
    const calls: { url: string; params: Record<string, unknown> }[] = []
    respond((url, params) => {
      calls.push({ url, params })
      if (url.endsWith('/summary'))
        return {
          native_detections_by_source: [],
          comparable_response: { value: null },
          coverage: { fraction: null },
        }
      if (url.endsWith('/detections')) return { features: [], returned: 0, next_cursor: null }
      if (url.endsWith('/weather')) return { series: [], returned: 0, status: 'missing' }
      return { ...analysisFixture, status: 'partial', job: null }
    })
    render(<ApiAnalysisPage />, { wrapper })
    fireEvent.change(screen.getByLabelText('Analysis ID'), {
      target: { value: 'a3000000-0000-4000-8000-000000000001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open analysis' }))
    await screen.findByRole('tab', { name: 'Detections' })
    fireEvent.click(screen.getByRole('tab', { name: 'Detections' }))
    fireEvent.change(screen.getByLabelText(/Sources \(/), { target: { value: 'terra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(calls.some((call) => call.params.source_ids === 'terra')).toBe(true))
    fireEvent.click(screen.getByRole('tab', { name: 'Weather' }))
    await screen.findByText('Data status:')
    fireEvent.click(screen.getByRole('tab', { name: 'Detections' }))
    expect((screen.getByLabelText(/Sources \(/) as HTMLInputElement).value).toBe('terra')
    expect(calls.filter((call) => call.params.source_ids === 'terra')).toHaveLength(1)
  })
  it('validates the UTC interval locally, focuses its error and blocks duplicate analysis submissions', async () => {
    const id = 'a3000000-0000-4000-8000-000000000001'
    let posts = 0
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    api.defaults.adapter = async (config) => {
      const post = config.method === 'post'
      if (post) {
        posts++
        await pending
      }
      const data = post
        ? { ...acceptedFixture, id }
        : config.url?.endsWith('/summary')
          ? {
              native_detections_by_source: [],
              coverage: { fraction: null },
              comparable_response: { value: null },
            }
          : { ...analysisFixture, id, status: 'partial', job: null }
      return {
        config,
        status: post ? 202 : 200,
        statusText: 'OK',
        headers: {},
        data: { schema_version: '1', request_id: 'test', warnings: [], data },
      }
    }
    render(<ApiAnalysisPage />, { wrapper })
    fireEvent.click(screen.getByText('Create a native analysis on a saved area'))
    fireEvent.change(screen.getByLabelText('Saved area (UUID)'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    })
    fireEvent.change(screen.getByLabelText('First UTC day'), { target: { value: '2024-01-03' } })
    const end = screen.getByLabelText('Exclusive UTC end')
    fireEvent.change(end, { target: { value: '2024-01-02' } })
    const form = screen.getByRole('button', { name: 'Create analysis' }).closest('form')!
    fireEvent.submit(form)
    expect(posts).toBe(0)
    expect(end.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(end)
    fireEvent.change(end, { target: { value: '2024-01-04' } })
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(posts).toBe(1))
    await act(async () => {
      release()
    })
    await screen.findByRole('tab', { name: 'Summary' })
    expect(posts).toBe(1)
  })
  it('keeps an explanation retry key and displays its fetched result', async () => {
    const keys: unknown[] = []
    const reads: string[] = []

    api.defaults.adapter = async (config) => {
      if (config.method === 'get') {
        reads.push(config.url ?? '')

        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: {
            schema_version: '1',
            request_id: 'test',
            warnings: [],
            data: {
              explanation_id: 'explanation-id',
              status: 'template_fallback',
              output: { summary: 'Test summary' },
            },
          },
        }
      }

      expect(config.method).toBe('post')
      keys.push(config.headers['Idempotency-Key'])
      if (keys.length === 1) throw new ApiClientError('Temporary failure', 'TIMEOUT')
      return {
        config,
        status: 202,
        statusText: 'Accepted',
        headers: {},
        data: {
          schema_version: '1',
          request_id: 'r',
          warnings: [],
          data: { explanation_id: 'explanation-id', job_id: 'job-id', status: 'queued' },
        },
      }
    }
    render(<ExplanationRequestPanel id="a" />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Request the summary' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Request the summary' }))
    await screen.findByText('explanation-id')
    await screen.findByText('Test summary')
    expect(reads).toEqual(['/explanations/explanation-id'])
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })
  it('gates administration, keeps its token out of cache keys and clears data on disconnect', async () => {
    let calls = 0
    api.defaults.adapter = async (config) => {
      calls++
      expect(Boolean(config.headers.Authorization)).toBe(true)
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {
          schema_version: '1',
          request_id: 'r',
          warnings: [],
          data: config.url!.endsWith('/subscriptions')
            ? { subscriptions: [], next_cursor: null }
            : { gaps: [], next_cursor: null },
        },
      }
    }
    render(<IngestionPage />, { wrapper })
    expect(calls).toBe(0)
    fireEvent.change(screen.getByLabelText('Administration token'), {
      target: { value: 'memory-only-test-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open administration' }))
    await waitFor(() => expect(calls).toBe(2))
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      ),
    ).not.toContain('memory-only-test-token')
    expect(localStorage.length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /Close the session/ }))
    await screen.findByLabelText('Administration token')
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(api.defaults.headers.common.Authorization).toBeUndefined()
  })
})
