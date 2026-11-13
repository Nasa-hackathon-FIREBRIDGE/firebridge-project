// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBridge } from './engine/index.ts'
import { driftingSeasons, syntheticSeasons } from './test-fixtures'
import type { BridgeState } from './useBridgeReport'

// Charts render on canvas; their data are covered by the engine tests and the visible tables.
vi.mock('./BridgeCharts', () => ({
  OverpassChart: () => null,
  FrpChart: () => null,
  ResponseChart: () => null,
  ReplayChart: () => <div data-testid="replay-chart" />,
  IndexedYearsChart: () => null,
  MonthlyBridgeChart: () => null,
  FingerprintChart: () => null,
  HandoverChart: () => <div data-testid="handover-chart" />,
}))

// Weather comes from NASA POWER over the network; the calendar must work without it.
let weatherEvidence: unknown = null
vi.mock('../science/weather', async (original) => ({ ...(await original<typeof import('../science/weather')>()), useWeatherEvidence: () => ({ evidence: weatherEvidence, status: weatherEvidence ? 'success' : 'pending', error: null }) }))

const report = runBridge({ detections: syntheticSeasons(), start: '2019-01-01', endExclusive: '2022-01-01' })
const drifting = runBridge({ detections: driftingSeasons(), start: '2019-01-01', endExclusive: '2025-01-01' })
let state: BridgeState = { status: 'ready', report }
vi.mock('./useBridgeReport', () => ({ MAX_BRIDGE_DETECTIONS: 150_000, useBridgeReport: () => state }))

const { BridgePanel } = await import('./BridgePanel')
const { EpisodesCard } = await import('./EpisodesCard')
const { CalendarPanel } = await import('./CalendarPanel')
const { VerdictCard } = await import('./VerdictCard')
const { DriversPanel } = await import('../drivers/DriversPanel')
const { weatherEvidence: buildWeather } = await import('../science/weather')

afterEach(cleanup)
// jsdom has no layout engine; the calendar scrolls an inspected month into view.
Element.prototype.scrollIntoView = vi.fn()

describe('Sensor bridge panel', () => {
  it('tells the harmonization story in six acts with reproducible method', () => {
    state = { status: 'ready', report }
    render(<BridgePanel analysisId="a1" releaseId="r1" />)
    expect(screen.getByRole('heading', { name: 'How much of the difference is the satellite?' })).toBeVisible()
    for (const title of [/^Why Suomi-NPP records .* as many detections as Aqua$/, 'When each satellite actually looked', 'The detection floor, measured here', 'Hide Aqua. Predict it from Suomi-NPP. Reveal.', 'The day Aqua goes dark, rehearsed', 'One comparable record across changing satellites', 'Every number above is recomputable'])
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'VIIRS platform' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Full report \(JSON\)/ })).toBeEnabled()
  })

  it('reveals the withheld reference before scoring the models', () => {
    state = { status: 'ready', report }
    render(<BridgePanel analysisId="a1" />)
    const act = screen.getByRole('heading', { name: /Hide Aqua\. Predict it from/ }).closest('section')!
    expect(within(act).getByText(/Scores appear when Aqua is revealed/)).toBeInTheDocument()
    expect(within(act).queryByRole('table')).toBeNull()
    fireEvent.click(within(act).getByRole('button', { name: /3\. Reveal Aqua/ }))
    const table = within(act).getByRole('table', { name: /Scored against the revealed Aqua record/ })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('adopted')).toBeInTheDocument()
    expect(within(act).getByText(/Largest miss/)).toBeInTheDocument()
  })

  it('separates the satellite-fleet effect from real change when comparing years', () => {
    state = { status: 'ready', report }
    render(<BridgePanel analysisId="a1" />)
    fireEvent.change(screen.getByLabelText('First year'), { target: { value: '2019' } })
    fireEvent.change(screen.getByLabelText('Second year'), { target: { value: '2021' } })
    expect(screen.getByText(/NOAA-21 contributes .* detections in 2021 and none in 2019/)).toBeInTheDocument()
    expect(screen.getByText('Suomi-NPP only, same sensor')).toBeInTheDocument()
  })

  it('reports loading progress and oversize selections plainly', () => {
    state = { status: 'loading', phase: 'detections', loaded: 5000, total: 12000 }
    const { unmount } = render(<BridgePanel analysisId="a1" />)
    expect(screen.getByRole('status')).toHaveTextContent('5,000 of 12,000')
    unmount()
    state = { status: 'too-large', total: 400_000 }
    render(<BridgePanel analysisId="a1" />)
    expect(screen.getByText(/400,000 detections/)).toBeInTheDocument()
  })
})

describe('Fire episodes card', () => {
  it('turns detections into clusters and links episodes to the map', () => {
    state = { status: 'ready', report }
    const onShow = vi.fn()
    render(<EpisodesCard analysisId="a1" onShowEpisode={onShow} />)
    expect(screen.getByRole('heading', { name: /^Fire episodes: [\d,]+ detections, [\d,]+ clusters/ })).toBeVisible()
    expect(screen.getByText('Detection clusters')).toBeInTheDocument()
    const [first] = screen.getAllByRole('button', { name: /^Show episode of .* on the map$/ })
    fireEvent.click(first)
    const [start, endExclusive] = onShow.mock.calls[0]
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(endExclusive > start).toBe(true)
  })
})

describe('Handover rehearsal', () => {
  it('switches Aqua off, scores the continuation and counts false alarms', () => {
    state = { status: 'ready', report: drifting }
    render(<BridgePanel analysisId="a1" />)
    const act = screen.getByRole('heading', { name: 'The day Aqua goes dark, rehearsed' }).closest('section')!
    const years = within(act).getByRole('radiogroup', { name: 'Switch-off year' })
    expect(within(years).getAllByRole('radio').map((r) => r.textContent)).toEqual(['2021', '2022'])
    expect(within(act).getByText('False alarms after the switch').parentElement).toHaveTextContent('3 → 0')
    expect(within(act).getByTestId('handover-chart')).toBeInTheDocument()
    fireEvent.click(within(years).getByRole('radio', { name: '2022' }))
    expect(within(years).getByRole('radio', { name: '2022' })).toHaveAttribute('aria-checked', 'true')
    expect(within(act).getByText('False alarms after the switch').parentElement).toHaveTextContent('2 → 0')
    const table = within(act).getByRole('table', { name: /Every rehearsal with Suomi-NPP/ })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('shows the drift fingerprint when Aqua leaves its original overpass', () => {
    state = { status: 'ready', report: drifting }
    render(<BridgePanel analysisId="a1" />)
    expect(screen.getByText('What the drift changed in Aqua’s record')).toBeInTheDocument()
    expect(screen.getByText(/The 90% intervals do not overlap/)).toBeInTheDocument()
  })
})

describe('Fire calendar', () => {
  it('opens on the most unusual month and reads each satellite’s testimony', () => {
    state = { status: 'ready', report: drifting }
    const onShow = vi.fn()
    render(<CalendarPanel analysisId="a1" onShowEpisode={onShow} />)
    expect(screen.getByRole('heading', { name: 'When was burning unusual, and do the satellites agree?' })).toBeVisible()
    expect(screen.getByText('Most unusual month').parentElement).toHaveTextContent('Jul 2022')
    const july = screen.getByRole('button', { name: /^July 2022:/ })
    expect(july).toHaveAttribute('aria-pressed', 'true')
    expect(july).toHaveAccessibleName(/Unusually high/)
    expect(screen.getByText('The jury: each satellite against its own past Julys')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Show the .* cluster on the map$/ }))
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('moves between months with the arrow keys and inspects flagged months', () => {
    state = { status: 'ready', report: drifting }
    render(<CalendarPanel analysisId="a1" />)
    fireEvent.keyDown(screen.getByRole('button', { name: /^July 2022:/ }), { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: /^August 2022:/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^August 2022:/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: /^August 2022:/ }), { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: /^August 2021:/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect July 2022' }))
    expect(screen.getByRole('button', { name: /^July 2022:/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to the raw all-satellite reading', () => {
    state = { status: 'ready', report: drifting }
    render(<CalendarPanel analysisId="a1" />)
    fireEvent.click(screen.getByRole('radio', { name: 'Raw, all satellites' }))
    expect(screen.getByRole('heading', { name: 'All satellites, raw detections' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^July 2022: [\d,]+ native detections/ })).toBeInTheDocument()
  })

  it('explains when a record is too short to judge', () => {
    state = { status: 'ready', report }
    render(<CalendarPanel analysisId="a1" />)
    expect(screen.getByText(/too short to judge unusual months/)).toBeInTheDocument()
  })
})

describe('Verdict card', () => {
  it('states the findings and opens the calendar and the bridge', () => {
    state = { status: 'ready', report: drifting }
    const onCalendar = vi.fn()
    const onBridge = vi.fn()
    render(<VerdictCard analysisId="a1" onOpenCalendar={onCalendar} onOpenBridge={onBridge} />)
    expect(screen.getByRole('heading', { name: 'July 2022 was the most unusual month in this record, and both satellites agree.' })).toBeVisible()
    expect(screen.getByText(/If Aqua had gone dark on 1 January 2021/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open the fire calendar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'How the satellites were bridged' }))
    expect(onCalendar).toHaveBeenCalledTimes(1)
    expect(onBridge).toHaveBeenCalledTimes(1)
  })
})

/** Synthetic weather: July 2022, the busy month, is hot and dry; every other month is ordinary. */
function syntheticWeather() {
  const months = []
  for (let year = 2018; year <= 2024; year++)
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, '0')}`
      const summer = m >= 6 && m <= 9
      months.push({ month, tmax: (summer ? 33 : 18) + (month === '2022-07' ? 3 : (year % 3) * 0.2), rain: summer ? (month === '2022-07' ? 1 : 8) : 60 + (year % 2) * 10 })
    }
  return months
}

describe('Fire drivers and the weather check', () => {
  it('reads each month against NASA weather and says whether the weather fits', () => {
    state = { status: 'ready', report: drifting }
    weatherEvidence = buildWeather(drifting, syntheticWeather(), { lat: 35.1, lon: -5.5 })
    render(<CalendarPanel analysisId="a1" />)
    expect(screen.getByText('Weather that month · NASA POWER')).toBeInTheDocument()
    expect(screen.getByText(/Hot or dry: the weather fits the burst/)).toBeInTheDocument()
    expect(screen.getByText('Fire follows the weather: hotter, drier months burned more')).toBeInTheDocument()
    expect(screen.getByText('How solid is each verdict?')).toBeInTheDocument()
    weatherEvidence = null
  })

  it('shows where it burns and the weekly rhythm, with sources', () => {
    state = { status: 'ready', report: drifting }
    weatherEvidence = buildWeather(drifting, syntheticWeather(), { lat: 35.1, lon: -5.5 })
    render(<DriversPanel analysisId="a1" />)
    expect(screen.getByRole('heading', { name: 'Why and where did it burn?' })).toBeVisible()
    expect(screen.getByRole('img', { name: /Monthly fire anomaly above NASA POWER heat and rain anomalies/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Fire season · .*burning cells of 5 km$/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Detection clusters by weekday/ })).toBeInTheDocument()
    expect(screen.getByText(/Earl, N\., Simmonds, I\., Tapper, N\./)).toBeInTheDocument()
    weatherEvidence = null
  })

  it('keeps the page useful while NASA POWER is unavailable', () => {
    state = { status: 'ready', report: drifting }
    weatherEvidence = null
    render(<DriversPanel analysisId="a1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Reading NASA POWER daily weather')
    expect(screen.getByText('Fire returns to the same places, and the off-season burns elsewhere')).toBeInTheDocument()
  })
})
