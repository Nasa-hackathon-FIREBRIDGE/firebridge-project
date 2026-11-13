// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useWorkspaceAnalyses, useWorkspaceAreas, useWorkspaceJobs } from '../hooks/useWorkspace'
import { useCatalog } from '../hooks/useCatalog'
import { areaFixture, analysisFixture, jobFixture } from '../services/test-fixtures'
import { resultFixtures } from '../services/results.test-fixtures'
import { ApiClientError } from '../lib/axios'
import DashboardPage from './DashboardPage'
import { formatAnalysisInterval, isExplicitSyntheticRelease, relativeJobTime, utcDate } from './dashboard.presentation'

vi.mock('../hooks/useWorkspace', () => ({ useWorkspaceAnalyses: vi.fn(), useWorkspaceAreas: vi.fn(), useWorkspaceJobs: vi.fn() }))
vi.mock('../hooks/useCatalog', () => ({ useCatalog: vi.fn() }))
vi.mock('../features/analyses/HealthStatus', () => ({ HealthStatus: () => <div>Health status remains separate</div> }))
const statuses = ['ready', 'partial', 'queued', 'running', 'failed', 'unsupported'] as const
const release = resultFixtures.catalogue.releases[0]
const analyses = statuses.map((status, i) => ({ ...analysisFixture, status, id: `analysis-${i}`, area_id: 'qa-area', release_id: release.id, start_date: '2024-07-15', end_date_exclusive: '2024-07-18' }))
const query = <T,>(items: T[]) => ({ data: { pages: [{ items: [...items], nextCursor: null }] }, dataUpdatedAt: Date.parse('2026-11-08T10:00:00Z'), isPending: false, isError: false, isFetching: false, hasNextPage: false, error: null, refetch: vi.fn(), fetchNextPage: vi.fn(), isFetchingNextPage: false })
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

function setup() {
  const analysisQuery = query(analyses), areaQuery = query([{ ...areaFixture, id: 'qa-area', name: 'TEST ONLY area' }]), jobQuery = query([jobFixture])
  const catalogQuery = { ...query([]), data: resultFixtures.catalogue }
  vi.mocked(useWorkspaceAnalyses).mockReturnValue(analysisQuery as unknown as ReturnType<typeof useWorkspaceAnalyses>)
  vi.mocked(useWorkspaceAreas).mockReturnValue(areaQuery as unknown as ReturnType<typeof useWorkspaceAreas>)
  vi.mocked(useWorkspaceJobs).mockReturnValue(jobQuery as unknown as ReturnType<typeof useWorkspaceJobs>)
  vi.mocked(useCatalog).mockReturnValue(catalogQuery as unknown as ReturnType<typeof useCatalog>)
  return { analysisQuery, areaQuery, jobQuery, catalogQuery }
}
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
function mount() { return render(<MemoryRouter><DashboardPage /><Location /></MemoryRouter>) }
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  setup()
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('Dashboard display formatters', () => {
  it.each([
    ['2024-07-15', '2024-07-18', '2024-07-15 → 2024-07-18'],
    ['2024-02-29', '2024-03-01', '2024-02-29 → 2024-03-01'],
    ['2024-12-31', '2025-01-01', '2024-12-31 → 2025-01-01'],
  ])('retains the exclusive boundary %s → %s', (start, end, label) => {
    const interval = formatAnalysisInterval(start, end)
    expect(interval.label).toBe(label)
    expect(interval.note).toBe('end excluded · UTC')
    expect(interval.exact).toContain(`${end} 00:00:00 UTC · end excluded`)
  })
  it('retains exact UTC time in details and handles unknown dates without invention', () => {
    expect(utcDate('2024-07-18T02:30:00+02:00')).toBe('2024-07-18 00:30:00 UTC')
    expect(utcDate('invalid')).toBe('Date unavailable')
    expect(relativeJobTime('invalid')).toBe('Date unavailable')
    expect(relativeJobTime('2026-11-08T08:00:00Z', Date.parse('2026-11-08T10:00:00Z'))).toBe('2 hr. ago')
  })
  it('recognizes explicit synthetic metadata without turning a negated label into a claim', () => {
    expect(isExplicitSyntheticRelease(release.name)).toBe(true)
    expect(isExplicitSyntheticRelease('Not synthetic — QA metadata')).toBe(false)
    expect(isExplicitSyntheticRelease('Published release — unknown authenticity')).toBe(false)
  })
})

describe('Dashboard presentation', () => {
  it('shows one synthetic banner and one full metadata detail, with short visible row tags', () => {
    mount()
    const banner = screen.getByRole('note')
    expect(banner).toHaveTextContent('Test release: synthetic data, not NASA observations')
    expect(screen.getAllByText(release.name, { exact: true })).toHaveLength(1)
    const register = screen.getByRole('region', { name: 'Saved analyses' })
    expect(within(register).queryByText(release.name, { exact: true })).not.toBeInTheDocument()
    expect(within(register).getAllByRole('button', { name: 'Synthetic' })).toHaveLength(6)
    expect(screen.getByText(/Public server records/)).toBeVisible()
  })
  it('uses a neutral mixed-data banner and preserves synthetic and unknown item identity', () => {
    const state = setup()
    state.analysisQuery.data.pages[0].items[1] = { ...analyses[1], release_id: 'missing-release' }
    mount()
    expect(screen.getByRole('note')).toHaveTextContent('Mixed releases in the loaded selection')
    expect(screen.getByRole('note')).toHaveTextContent('Includes synthetic test data, not NASA observations')
    expect(screen.getByRole('note')).toHaveTextContent('Some release metadata is unavailable')
    expect(screen.getByRole('button', { name: 'Metadata unavailable' })).toBeVisible()
  })
  it('shows unknown metadata and never labels unverified server records real observations', () => {
    const state = setup()
    state.catalogQuery.data = { ...resultFixtures.catalogue, releases: [] }
    mount()
    expect(within(screen.getByRole('note')).getAllByText('Release metadata unavailable', { exact: true })[0]).toBeVisible()
    expect(screen.queryByText(/real observations/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Synthetic' })).not.toBeInTheDocument()
  })
  it('leaves an unmarked published release neutral', () => {
    const state = setup()
    state.catalogQuery.data = { ...resultFixtures.catalogue, releases: [{ ...release, name: 'QA published release' }] }
    mount()
    expect(screen.getByRole('note')).toHaveTextContent('Published release metadata')
    expect(screen.queryByText(/real observations/i)).not.toBeInTheDocument()
  })
  it('keeps human area/date primary, an operable native link, and exact UTC details', async () => {
    const user = userEvent.setup()
    mount()
    const primary = screen.getAllByRole('link', { name: /TEST ONLY area.*2024-07-15.*2024-07-18.*end excluded/ })[0]
    expect(primary).toHaveAttribute('href', '/analyses?analysis=analysis-0')
    const record = primary.closest('li')!
    fireEvent.click(within(record).getByText('Record details'))
    expect(within(record).getByText('2024-07-15 00:00:00 UTC → 2024-07-18 00:00:00 UTC · end excluded')).toBeVisible()
    primary.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/analyses?analysis=analysis-0')
  })
  it('matches the unchanged KPI definitions and all six status counts to loaded records', () => {
    mount()
    const stats = screen.getByRole('region', { name: 'Analysis statistics for loaded records' })
    expect(within(stats).getAllByRole('definition').map(node => node.textContent)).toEqual(['66', '22', '22', '22'])
    const summary = screen.getByRole('region', { name: 'Status of loaded analyses' })
    expect(within(summary).getAllByRole('listitem')).toHaveLength(6)
    for (const item of within(summary).getAllByRole('listitem')) expect(item.querySelector('strong')).toHaveTextContent('1')
    expect(screen.queryByText('Analysis availability')).not.toBeInTheDocument()
    expect(screen.getByText(/not server-wide totals/)).toBeVisible()
  })
  it.each([{}, { percent: -1 }, { percent: 101 }, { percent: Infinity }])('keeps unavailable/invalid progress honest: %j', progress => {
    const state = setup()
    state.jobQuery.data.pages[0].items = [{ ...jobFixture, progress }]
    mount()
    const activity = screen.getByRole('region', { name: 'Processing activity' })
    expect(within(activity).getByText('Progress not supplied')).toBeVisible()
    expect(within(activity).queryByRole('progressbar')).not.toBeInTheDocument()
  })
  it('renders actual reported progress, not an inferred completion percentage', () => {
    const state = setup()
    state.jobQuery.data.pages[0].items = [{ ...jobFixture, progress: { percent: 37 } }]
    mount()
    expect(screen.getByText('Reported progress 37%')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '37')
  })
  it('draws only geometry already supplied by the loaded area list', () => {
    mount()
    expect(screen.getByRole('img', { name: 'Loaded area geometry preview, not a basemap' })).toBeVisible()
    expect(screen.getByText('1 · 1 km²')).toBeVisible()
    expect(screen.queryByText(/last used/i)).not.toBeInTheDocument()
  })
  it('uses a neutral placeholder if loaded geometry is not supplied', () => {
    const state = setup()
    Object.assign(state.areaQuery.data.pages[0].items[0], { geometry: undefined })
    mount()
    expect(screen.queryByRole('img', { name: 'Loaded area geometry preview, not a basemap' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Saved areas' })).toHaveTextContent('TEST ONLY area')
  })
  it('preserves visible stale-refresh warnings with records usable', () => {
    const state = setup()
    Object.assign(state.analysisQuery, { isError: true, error: new ApiClientError('', 'NETWORK_ERROR') })
    mount()
    expect(screen.getByText(/Previously loaded records are shown; the latest refresh failed/)).toBeVisible()
    expect(screen.getAllByRole('link', { name: /TEST ONLY area.*2024-07-15/ })).toHaveLength(6)
    expect(screen.getByRole('alert')).toBeVisible()
  })
  it('reserves loading placeholders and never substitutes zero or an empty state for pending data', () => {
    const state = setup()
    Object.assign(state.analysisQuery, { data: undefined, isPending: true })
    mount()
    expect(screen.getByText('Loading saved analyses…')).toBeInTheDocument()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(4)
    expect(screen.queryByText('A clear starting point')).not.toBeInTheDocument()
    const statusSummary = screen.getByRole('region', { name: 'Status of loaded analyses' })
    expect(within(statusSummary).getAllByRole('listitem').every(item => item.querySelector('strong')?.textContent === '—')).toBe(true)
  })
})
