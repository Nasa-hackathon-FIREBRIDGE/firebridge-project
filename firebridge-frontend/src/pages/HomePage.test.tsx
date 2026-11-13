// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import api from '../lib/axios'
import { areaFixture, envelope } from '../services/test-fixtures'
import HomePage from './HomePage'

const listedAreaId = '11111111-1111-4111-8111-111111111111'
const unlistedAreaId = '44444444-4444-4444-8444-444444444444'
const analysis = (id: string, areaId: string, start: string) => ({
  id,
  area_id: areaId,
  release_id: 'release',
  status: 'partial',
  metric_key: 'native_detections_v1',
  data_mode: 'standard_only',
  grid_id: null,
  start_date: start,
  end_date_exclusive: '2025-01-01',
  time_basis: 'utc',
  created_at: '2026-11-07T10:00:00Z',
  completed_at: '2026-11-07T10:01:00Z',
})

beforeAll(() => {
  // Reveal animates on scroll; jsdom has no IntersectionObserver.
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } })
})

const original = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  api.defaults.adapter = original
})

function mount() {
  const calls: string[] = []
  api.defaults.adapter = async (config) => {
    calls.push(config.url!)
    const data =
      config.url === '/analyses'
        ? { analyses: [analysis('22222222-2222-4222-8222-222222222222', listedAreaId, '2024-01-01'), analysis('33333333-3333-4333-8333-333333333333', unlistedAreaId, '2023-03-01')], nextCursor: null }
        : config.url === '/areas'
          ? { areas: [{ ...areaFixture, id: listedAreaId, name: 'Fez-Meknes, Morocco' }], nextCursor: 'more' }
          : config.url === `/areas/${unlistedAreaId}`
            ? { ...areaFixture, id: unlistedAreaId, name: 'Skikda, Algeria' }
            : config.url === '/catalog'
              ? { scope_key: 'public', sources: [], releases: [] }
              : {}
    return { config, status: 200, statusText: 'OK', headers: {}, data: envelope(data) }
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return calls
}

describe('Home page', () => {
  it('states the challenge and its answer, with the Earth illustration', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1, name: /MODIS is going dark\. The fire record doesn’t have to\./ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Harmonization of MODIS and VIIRS hot spots/ })).toHaveAttribute('href', 'https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/')
    expect(screen.getByRole('img', { name: /Illustration: the Earth turning under the five fire satellites/ })).toBeInTheDocument()
    expect(screen.getByText('666,856,483')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The same fire, counted three different ways.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /MODIS on Terra \(from 2000\) and Aqua \(from 2002\) fade out today/ })).toBeInTheDocument()
  })

  it('opens each question at the tab of a live analysis that answers it', async () => {
    mount()
    const list = (await screen.findByRole('heading', { name: 'Draw a place. Then ask it five questions.' })).closest('section')!
    await waitFor(() => expect(within(list).getByRole('link', { name: /When was burning unusual/ })).toHaveAttribute('href', '/analyses?analysis=22222222-2222-4222-8222-222222222222#fire-calendar'))
    expect(within(list).getByRole('link', { name: /Why and where did it burn/ })).toHaveAttribute('href', expect.stringMatching(/#fire-drivers$/))
    expect(within(list).getAllByRole('link')).toHaveLength(5)
  })

  it('names every featured place, reading areas the first list page does not hold', async () => {
    const calls = mount()
    const places = (await screen.findByRole('heading', { name: 'The places glowing on the Earth above.' })).closest('section')!
    expect(await within(places).findByText('Fez-Meknes, Morocco')).toBeInTheDocument()
    expect(await within(places).findByText('Skikda, Algeria')).toBeInTheDocument()
    expect(calls).toContain(`/areas/${unlistedAreaId}`)
    expect(calls).not.toContain(`/areas/${listedAreaId}`)
  })
})
