// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import api from '../../lib/axios'
import CatalogPage from '../CatalogPage'
import { describeChange, groupSources, lastDayBefore, streamTitle } from './describe'
import type { CatalogSource } from '../../services/catalog.service'

const source = (source_id: string, platform: string | null, instrument: string | null, product: string, collection: string): CatalogSource =>
  ({ source_id, platform, instrument, product, collection, processing_stream: 'standard', availability_status: 'unknown' })

// Shapes copied from the live /api/v1/catalog and /api/v1/releases responses (11 Nov 2026).
const SOURCES = [
  source('modis-aqua-c61-standard', 'Aqua', 'MODIS', 'modis-aqua', '61'),
  source('modis-aqua-c6-standard', 'Aqua', 'MODIS', 'modis-aqua', '6'),
  source('modis-terra-c61-standard', 'Terra', 'MODIS', 'modis-terra', '61'),
  source('raw-viirs_noaa20_sp', null, null, 'VIIRS_NOAA20_SP', 'provider-native'),
  source('viirs-noaa20-c2-standard', 'N20', 'VIIRS', 'viirs-noaa20', '2'),
  source('viirs-snpp-c2-standard', 'SNPP', 'VIIRS', 'viirs-snpp', '2'),
]
const release = (id: string, name: string, published_at: string, observation_cutoff: string) =>
  ({ id, name, dataset_kind: 'satellite', stream: 'retrospective', scope_key: 'global', parent_release_id: null, published_at, observation_cutoff })
const STANDARD = '4d9e44c0-9b14-4037-8c11-ae77a5895f64'
const ARCHIVE = 'bd4094e7-244c-5d9f-8d1e-8d4ed1f3f574'
const CATALOG = {
  scope_key: 'global',
  sources: SOURCES,
  releases: [
    release(ARCHIVE, 'Historical archive 1b2e5fa11056', '2026-11-09T14:08:08.185Z', '2026-09-01T00:00:00.000Z'),
    release(STANDARD, `global:standard_only:${STANDARD}`, '2026-11-09T00:00:32.404Z', '2024-07-03T00:00:00.000Z'),
  ],
  release_aliases: [
    { alias: 'historical_archive', release_id: ARCHIVE, generation: '2', published_at: '2026-11-09T14:08:08.185Z', dataset_kind: 'satellite' },
    { alias: 'standard_only', release_id: STANDARD, generation: '3', published_at: '2026-11-09T00:00:32.404Z', dataset_kind: 'satellite' },
  ],
  metrics: [{ id: 'native_detections_v1', version: '1.0.0', unit: 'count', description: 'Native satellite detections count v1', requires_masks: false, requires_model: false }],
  limits: { max_aoi_vertices: 5000, max_aoi_area_km2: 250000, max_points_per_page: 5000 },
}
const partition = (series: string, day: string, rows: string) =>
  ({ series_key: `detections:${series}:global`, partition_key: day, partition_id: `${series}-${day}`, kind: 'detections', sha256: '0c42b4fa10dc4d6c9a5f9e220518a994b0242a8ad99bcb151bfc574e80ae5689', row_count: rows, serving_complete: true, validation_status: 'validated' })
function releaseView(id: string, membership: string) {
  const standard = id === STANDARD
  return {
    ...CATALOG.releases.find((r) => r.id === id),
    validation_status: 'validated',
    partition_counts: standard ? [{ kind: 'detections', partitions: 6, row_count: '452884', serving_complete: true }] : [],
    source_composition: standard
      ? [{ source_id: 'raw-viirs_noaa20_sp', role: 'input' }, { source_id: 'viirs-noaa20-c2-standard', role: 'record' }]
      : [{ source_id: 'modis-aqua-c61-standard', role: 'input' }],
    change_summary: standard ? [{ reason: 'new_data', revision_records: 2, affected_interval: { start: '2024-07-01T00:00:00.000Z', end_exclusive: '2024-07-03T00:00:00.000Z' } }] : [],
    membership: {
      kind: membership,
      items: !standard ? [] : membership === 'assets'
        ? [{ asset_id: 'a1', role: 'partition_input', source_id: 'raw-viirs_noaa20_sp', sha256: '94fc04e7270ff91bf9401c5f57aacee587200b68da424d11b5a16e00df619b6d', byte_size: '27000231', validation_status: 'accepted' }]
        : [partition('viirs-noaa20-c2-standard', '2024-07-01', '75912'), partition('viirs-snpp-c2-standard', '2024-07-02', '77742')],
      next_cursor: null,
    },
  }
}

const original = api.defaults.adapter
let client: QueryClient
beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } })
})
afterEach(() => {
  cleanup()
  api.defaults.adapter = original
})
function mount(catalog: object = CATALOG) {
  const calls: string[] = []
  api.defaults.adapter = async (config) => {
    const url = config.url!
    calls.push(`${url} ${JSON.stringify(config.params ?? {})}`)
    const id = url.split('/releases/')[1]
    const data = url === '/catalog' ? catalog : releaseView(id, (config.params as { membership?: string })?.membership ?? 'partitions')
    return { config, status: 200, statusText: 'OK', headers: {}, data: { schema_version: '1', request_id: 'test', warnings: [], data } }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><CatalogPage /></MemoryRouter></QueryClientProvider>)
  return calls
}

describe('catalogue descriptions', () => {
  it('names streams, exclusive cutoffs and changes in plain words', () => {
    expect(streamTitle(SOURCES[0])).toBe('Collection 6.1')
    expect(streamTitle(SOURCES[3])).toBe('Raw FIRMS files')
    expect(lastDayBefore('2024-07-03T00:00:00.000Z')).toBe('2 Jul 2024')
    expect(describeChange({ reason: 'new_data', revision_records: 2, affected_interval: { start: '2024-07-01T00:00:00Z', end_exclusive: '2024-07-03T00:00:00Z' } }))
      .toBe('New data, 2 revision records covering 1 Jul 2024 to 2 Jul 2024.')
  })

  it('groups streams by satellite in launch order, matching raw files by product', () => {
    const groups = groupSources(SOURCES)
    expect(groups.map((g) => g.label)).toEqual(['Terra', 'Aqua', 'Suomi-NPP', 'NOAA-20'])
    expect(groups[3].streams.map((s) => s.source_id)).toEqual(['viirs-noaa20-c2-standard', 'raw-viirs_noaa20_sp'])
    expect(groups[3].instrument).toBe('VIIRS')
  })
})

describe('Data catalogue page', () => {
  it('summarises the live catalogue and groups sources by satellite', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: '4 satellites, 6 source streams.' })).toBeInTheDocument()
    expect(screen.getByText('latest publication').parentElement).toHaveTextContent('9 Nov 2026')
    const aqua = screen.getByRole('list', { name: 'Aqua source streams' })
    expect(within(aqua).getByText('Collection 6.1')).toBeInTheDocument()
    expect(within(aqua).getByText('Collection 6')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'NOAA-20 source streams' })).getByText('Raw FIRMS files')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search catalogue sources' }), { target: { value: 'terra' } })
    expect(within(screen.getByRole('group', { name: 'Sources by satellite' })).getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'MODIS satellites' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'VIIRS satellites' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search catalogue sources' }), { target: { value: 'nothing-like-this' } })
    expect(screen.getByText('No source matches this search.')).toBeInTheDocument()
  })

  it('explains each release and opens the policy releases first', async () => {
    mount()
    const standard = await screen.findByRole('article', { name: 'Standard quality' })
    expect(within(standard).getByText(/Provisional near-real-time records are never mixed in/)).toBeInTheDocument()
    expect(within(standard).getByText('2 Jul 2024')).toBeInTheDocument()
    expect(await within(standard).findByText('452,884 in 6 daily partitions')).toBeInTheDocument()
    expect(within(standard).getByText('3rd generation')).toBeInTheDocument()
    const archive = screen.getByRole('article', { name: 'Historical archive' })
    expect(await within(archive).findByText('Prepared per analysis')).toBeInTheDocument()

    // The explorer opens the first card: its sources, history and partitions.
    expect(await screen.findByText('New data, 2 revision records covering 1 Jul 2024 to 2 Jul 2024.')).toBeInTheDocument()
    const partitions = screen.getByRole('region', { name: 'Daily partitions' })
    expect(within(partitions).getByText('75,912 rows')).toBeInTheDocument()
    expect(within(partitions).getAllByText('validated')).toHaveLength(2)
  })

  it('switches between partitions and source files, and between releases', async () => {
    const calls = mount()
    await screen.findByText('75,912 rows')
    fireEvent.click(screen.getByRole('radio', { name: 'Source files' }))
    expect(await screen.findByText('27.0 MB')).toBeInTheDocument()
    expect(calls.some((call) => call.includes('"membership":"assets"'))).toBe(true)

    fireEvent.click(within(screen.getByRole('article', { name: 'Historical archive' })).getByRole('button', { name: /Look inside/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Inspecting/ })).toBeInTheDocument())
    expect(await screen.findByText(/it is a catalogue of the archive/)).toBeInTheDocument()
  })

  it('shows the measured metric and the limits', async () => {
    mount()
    expect(await screen.findByText(/Native satellite detections count v1 \(version 1.0.0\)/)).toBeInTheDocument()
    const limits = screen.getByRole('list', { name: 'Limits per analysis' })
    expect(within(limits).getByText('250,000 km²')).toBeInTheDocument()
    expect(within(limits).getByText('10,980 days')).toBeInTheDocument()
  })
})
