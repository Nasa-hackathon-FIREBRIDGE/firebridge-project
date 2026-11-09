// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InternalAxiosRequestConfig } from 'axios'
import api from '../../lib/axios'
import { ContextDetails } from './ContextDetails'

const original = api.defaults.adapter
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
let requests: InternalAxiosRequestConfig[] = []
afterEach(() => { cleanup(); client.clear(); api.defaults.adapter = original; requests = [] })

it('loads only opened context panels and retains their filters when switching tabs', async () => {
  api.defaults.adapter = async (config) => {
    requests.push(config)
    return { config, status: 200, statusText: 'OK', headers: {}, data: {
      request_id: 'context-test', schema_version: '1', warnings: [],
      data: config.url?.endsWith('/weather') ? { series: [], next_cursor: null } : {
        observation_coverage_status: 'unknown', coverage_fraction: null,
      },
    } }
  }
  render(<QueryClientProvider client={client}><ContextDetails analysisId="analysis" /></QueryClientProvider>)
  expect(requests).toHaveLength(0)
  fireEvent.click(screen.getByRole('tab', { name: 'Météo' }))
  await waitFor(() => expect(requests.some((request) => request.url?.endsWith('/weather'))).toBe(true))
  fireEvent.change(screen.getByLabelText('Variables (séparées par des virgules)'), { target: { value: 'temperature_2m' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Couverture' }))
  await waitFor(() => expect(requests.some((request) => request.url?.endsWith('/coverage'))).toBe(true))
  fireEvent.click(screen.getByRole('tab', { name: 'Météo' }))
  expect((screen.getByLabelText('Variables (séparées par des virgules)') as HTMLInputElement).value).toBe('temperature_2m')
  expect(requests.some((request) => /\/reports|\/cells|\/comparison/.test(request.url ?? ''))).toBe(false)
})
