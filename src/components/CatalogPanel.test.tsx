// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InternalAxiosRequestConfig } from 'axios'
import api from '../lib/axios'
import { CatalogPanel } from './CatalogPanel'

const original = api.defaults.adapter
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
let requests: InternalAxiosRequestConfig[] = []

afterEach(() => {
  cleanup()
  client.clear()
  api.defaults.adapter = original
  requests = []
})

function mount(withRelease = false) {
  api.defaults.adapter = async (config) => {
    requests.push(config)
    const source = config.url?.includes('/sources/')
      ? decodeURIComponent(config.url.split('/')[2])
      : null
    const release = { id: '22222222-2222-4222-8222-222222222222', name: 'Published test version', scope_key: 'selected-scope', dataset_kind: 'satellite', published_at: '2024-01-20T12:00:00Z', parent_release_id: null }
    const data = config.url === '/catalog'
      ? {
          scope_key: 'selected-scope',
          sources: ['Aqua', 'Terra'].map((platform) => ({
            source_id: `sensor/${platform.toLowerCase()}`,
            platform,
            instrument: 'MODIS',
            product: 'MCD14ML',
            collection: '6.1',
            processing_stream: 'standard',
            availability_status: 'unknown',
          })),
          releases: withRelease ? [release] : [],
        }
      : config.url?.startsWith('/releases/')
        ? { ...release, source_composition: [], membership: { kind: 'partitions', items: [], next_cursor: null }, validation_status: 'validated' }
      : source
        ? {
            source_id: source,
            scope_key: 'selected-scope',
            provider_status: 'unknown',
            ingestion_completeness: 'not_proven',
            observation_coverage: null,
            stale: true,
            stale_reason: 'NO_SUCCESSFUL_FETCH',
            last_attempt_at: '2024-01-20T12:00:00Z',
            last_success_at: null,
            queried_through: null,
            latest_observation_at: null,
            published_at: null,
            next_check_at: null,
            gaps: [],
            gaps_truncated: false,
            feeds: [],
          }
        : {
            scope_key: 'selected-scope',
            comparison: config.params?.after_release_id ? 'compared' : 'baseline_not_provided',
            has_updates: false,
            history_complete: true,
            current: [],
            changes: [],
            checked_at: '2024-01-20T12:00:00Z',
          }
    return {
      config, status: 200, statusText: 'OK', headers: {},
      data: { request_id: 'catalogue-test', schema_version: '1', warnings: [], data },
    }
  }
  render(<QueryClientProvider client={client}><CatalogPanel /></QueryClientProvider>)
}

it('loads availability only for the inspected source, preserves opaque identifiers and sends its scope publicly', async () => {
  mount()
  const aqua = await screen.findByRole('button', { name: 'Inspect source sensor/aqua' })
  expect(requests.some((request) => request.url?.includes('/availability'))).toBe(false)

  fireEvent.click(aqua)
  await screen.findByText('NO_SUCCESSFUL_FETCH')
  const request = requests.find((entry) => entry.url?.endsWith('/availability'))!
  expect(request.url).toBe('/sources/sensor%2Faqua/availability')
  expect(request.params).toEqual({ scope_key: 'selected-scope' })
  expect(request.headers.has('Authorization')).toBe(false)
  expect(aqua.getAttribute('aria-expanded')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Inspect source sensor/terra' }))
  await waitFor(() => expect(requests.some((entry) => entry.url === '/sources/sensor%2Fterra/availability')).toBe(true))
  const details = screen.getByRole('complementary', { name: 'Selected catalogue source' })
  await waitFor(() => expect(within(details).getAllByText('sensor/terra').length).toBeGreaterThan(0))
  expect(within(details).queryByText('sensor/aqua')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close source details' }))
  expect(screen.queryByRole('complementary', { name: 'Selected catalogue source' })).toBeNull()
})

it('keeps absent acquisition and coverage values unknown, and does not equate an empty gap list with a complete inventory', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect source sensor/aqua' }))
  await screen.findByText('NO_SUCCESSFUL_FETCH')
  const details = screen.getByRole('complementary', { name: 'Selected catalogue source' })
  for (const label of ['Couverture d’observation', 'Dernier import réussi', 'Dernière observation reçue']) {
    const field = within(details).getByText(label).closest('div')!
    expect(within(field).getByText('Inconnu / non disponible')).toBeTruthy()
  }
  expect(within(details).getByText('not_proven')).toBeTruthy()
  expect(within(details).getByText('Aucune lacune d’import signalée pour cette sélection.')).toBeTruthy()
  expect(within(details).getByText('L’absence de lacune signalée ne prouve pas que l’inventaire est complet.')).toBeTruthy()
})

it('uses a published version as the comparison baseline without requiring a copied UUID', async () => {
  mount(true)
  fireEvent.click(await screen.findByRole('button', { name: 'Utiliser cette version comme référence' }))
  await screen.findByText('Aucune nouvelle version signalée par rapport à cette référence.')
  expect((screen.getByLabelText('Version de référence (facultative)') as HTMLInputElement).value).toBe('22222222-2222-4222-8222-222222222222')
  expect(requests.some((request) => request.url === '/updates' && request.params?.after_release_id === '22222222-2222-4222-8222-222222222222' && request.params?.scope_key === 'selected-scope')).toBe(true)
})
