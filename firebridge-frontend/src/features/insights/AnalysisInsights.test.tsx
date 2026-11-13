// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../../lib/axios'
import { envelope } from '../../services/test-fixtures'
import { resultFixtures } from '../../services/results.test-fixtures'
import { AnalysisInsights, InsightsRail } from './AnalysisInsights'

const original = api.defaults.adapter
let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); api.defaults.adapter = original })

function mount(children: React.ReactNode, unknown = false) {
  const source = resultFixtures.summary.native_detections_by_source[0]
  const sources = [
    { source_id: 'modis-terra-c61-standard', platform: 'Terra', product: 'modis-terra', count: '425', count_status: 'lower_bound' },
    { source_id: 'modis-terra-c6-standard', platform: 'Terra', product: 'modis-terra', count: null, count_status: 'unknown' },
    { source_id: 'modis-aqua-c61-standard', platform: 'Aqua', product: 'modis-aqua', count: '540', count_status: 'lower_bound' },
    { source_id: 'modis-aqua-c6-standard', platform: 'Aqua', product: 'modis-aqua', count: null, count_status: 'unknown' },
    { source_id: 'viirs-snpp-c2-standard', platform: 'SNPP', product: 'viirs-snpp', count: '8210', count_status: 'lower_bound' },
    { source_id: 'viirs-noaa20-c2-standard', platform: 'N20', product: 'viirs-noaa20', count: '8474', count_status: 'lower_bound' },
    { source_id: 'viirs-noaa21-c2-standard', platform: 'N21', product: 'viirs-noaa21', count: '7521', count_status: 'lower_bound' },
  ]
  const summary = { ...resultFixtures.summary, status: 'partial', inventory_status: 'partial', native_detections_by_source: sources.map((row) => ({
    ...source, ...row, observed_count: row.count ?? '0',
    ...(unknown ? { count: null, observed_count: '0', count_status: 'unknown' } : {}),
  })) }
  api.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: envelope(config.url?.endsWith('/summary') ? summary : { ...resultFixtures.calendar, periods: [] }) })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

it('shows the map total and MODIS lower bounds even with unknown older collections', async () => {
  const onOpenOverview = vi.fn()
  mount(<InsightsRail analysisId="analysis" onOpenOverview={onOpenOverview} />)
  const rail = screen.getByRole('region', { name: 'Analysis at a glance' })
  const terra = (await within(rail).findByText('Terra')).closest('li')!
  const aqua = within(rail).getByText('Aqua').closest('li')!
  expect(rail.textContent).toContain('≥ 25,170')
  expect(within(terra).getByText('≥ 425')).toBeTruthy()
  expect(within(aqua).getByText('≥ 540')).toBeTruthy()
  expect(within(terra).getByText('2%')).toBeTruthy()
  expect(within(aqua).getByText('2%')).toBeTruthy()
  expect(within(rail).queryByText('Unknown')).toBeNull()
  expect(within(rail).getByText('25.1 : 1')).toBeTruthy()
  expect(within(rail).getByText(/Shares and ratio use available records/)).toBeTruthy()
  fireEvent.click(within(rail).getByRole('button', { name: 'Open full insights' }))
  expect(onOpenOverview).toHaveBeenCalledOnce()
})

it('retains Unknown when no source has a known count', async () => {
  mount(<InsightsRail analysisId="analysis" onOpenOverview={() => {}} />, true)
  expect(await screen.findAllByText('Unknown')).toHaveLength(6)
  expect(screen.queryByText('≥ 0')).toBeNull()
  expect(screen.queryByText(/\d+%/)).toBeNull()
})

it('qualifies the full overview totals and ratios when inventory is partial', async () => {
  mount(<AnalysisInsights analysisId="analysis" />)
  expect(await screen.findByRole('heading', { name: /At least 25,170 detections from 5 satellites/ })).toBeTruthy()
  expect(screen.getByText('At least this many · inventory is incomplete')).toBeTruthy()
  expect(screen.getByText('Ratio of available records')).toBeTruthy()
  expect(screen.getByText(/Counts and shares use available records/)).toBeTruthy()
})
