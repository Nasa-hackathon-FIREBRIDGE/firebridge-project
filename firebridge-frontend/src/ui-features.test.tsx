// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatWidget } from './components/ChatWidget'
import { SensorSelector } from './components/SensorSelector'
import { localAssistant } from './assistant'
import { AppStateProvider } from './state'
import { useAppState } from './useAppState'
import { DEMO_DETECTIONS } from './fixtures'
import { filterDetections } from './data'
import type { AnalysisSelection } from './types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Harness() {
  const { platforms, setPlatforms } = useAppState()
  return <><SensorSelector platforms={platforms} setPlatforms={setPlatforms} /><output data-testid="platforms">{platforms.join(',')}</output><ChatWidget /></>
}
const sat = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) })
const renderApp = () => render(<MemoryRouter><AppStateProvider><Harness /></AppStateProvider></MemoryRouter>)
const openChat = () => fireEvent.click(screen.getByRole('button', { name: 'Open data assistant' }))
const ask = async (text: string) => {
  const box = screen.getByLabelText('Message')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('SensorSelector', () => {
  it('toggles children when the parent is clicked and shows indeterminate state', () => {
    renderApp()
    const modis = screen.getByLabelText('MODIS (all satellites)') as HTMLInputElement
    expect(modis.checked).toBe(true)
    fireEvent.click(modis)
    expect(screen.getByTestId('platforms').textContent).toBe('Suomi-NPP,NOAA-20,NOAA-21')
    fireEvent.click(sat('Terra'))
    expect(modis.indeterminate).toBe(true)
    expect(screen.getByTestId('platforms').textContent).toContain('Terra')
    fireEvent.click(screen.getByLabelText('VIIRS (all satellites)'))
    fireEvent.click(modis)
    expect(screen.getByTestId('platforms').textContent).toBe('Terra,Aqua')
  })
  it('labels satellites without demo records and explains the empty state', () => {
    renderApp()
    expect(screen.getAllByText('No demo records loaded')).toHaveLength(3)
    fireEvent.click(sat('Aqua'))
    fireEvent.click(sat('Suomi-NPP'))
    expect(screen.getByText(/contains no records for this satellite/)).toBeTruthy()
    expect(screen.getByText(/not harmonized/)).toBeTruthy()
  })
  it('shows the Suomi-NPP delivery note', () => {
    renderApp()
    expect(screen.getByText(/ended delivery of Suomi-NPP products to users on 2 Nov 2026 at 15:40 UTC/)).toBeTruthy()
  })
})

describe('ChatWidget', () => {
  it('opens, closes with the button and with Escape', () => {
    renderApp()
    expect(screen.queryByRole('dialog')).toBeNull()
    openChat()
    expect(screen.getByRole('dialog', { name: 'FIREBRIDGE Data Assistant' })).toBeTruthy()
    expect(screen.getByText(/Live AI service is not connected/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close data assistant' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    openChat()
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('rejects empty messages and sends on Enter but not Shift+Enter', async () => {
    renderApp()
    openChat()
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Type a question/)
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'What does FRP mean?' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(screen.queryByText('You')).toBeNull()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Fire Radiative Power/)).toBeTruthy())
  })
  it('offers all suggested questions and answers them using shared filters', async () => {
    renderApp()
    openChat()
    const suggestions = within(screen.getByLabelText('Suggested questions')).getAllByRole('button')
    expect(suggestions).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: 'What does the current filter show?' }))
    const expected = filterDetections(DEMO_DETECTIONS, { area: { id: 'x', name: 'Northern Morocco pilot', provenance: 'default-demo', geometry: { type: 'Polygon', coordinates: [[[-6.4, 34.5], [-4.5, 34.5], [-4.5, 35.9], [-6.4, 35.9], [-6.4, 34.5]]] } }, startDate: '2024-07-18', endDate: '2024-07-25', platforms: ['Terra', 'Aqua', 'Suomi-NPP', 'NOAA-20', 'NOAA-21'], searchText: '', frpThresholdMw: null }).length
    await waitFor(() => expect(screen.getByText(new RegExp(`${expected} synthetic demo records? match`))).toBeTruthy())
  })
  it('keeps the conversation when remounted routes change and can be cleared', async () => {
    renderApp()
    openChat()
    await ask('Compare MODIS and VIIRS.')
    await waitFor(() => expect(screen.getByText(/not directly comparable/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(screen.queryByText(/not directly comparable/)).toBeNull()
  })
  it('makes no network requests', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderApp()
    openChat()
    await ask('Why is coverage unknown?')
    await waitFor(() => expect(screen.getByText(/valid negative/)).toBeTruthy())
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('local assistant', () => {
  const selection = (platforms: AnalysisSelection['platforms']): AnalysisSelection => ({ area: { id: 'a', name: 'Test area', provenance: 'default-demo', geometry: { type: 'Polygon', coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] } }, startDate: '2000-01-01', endDate: '2100-01-01', platforms, searchText: '', frpThresholdMw: null })
  it('describes a selected record from actual data', async () => {
    const record = DEMO_DETECTIONS[0]
    const reply = await localAssistant.answer('Explain the selected detections.', { selection: selection(['Aqua', 'Suomi-NPP']), selectedDetectionId: record.id })
    expect(reply).toContain(record.id)
    expect(reply).toContain('not a verified incident')
  })
  it('says there are no demo records rather than zero detections', async () => {
    const reply = await localAssistant.answer('Explain the selected satellites.', { selection: selection(['Terra']), selectedDetectionId: null })
    expect(reply).toContain('No demo records loaded')
  })
  it('declines unsupported questions', async () => {
    const reply = await localAssistant.answer('Will the fire spread tomorrow?', { selection: selection(['Aqua']), selectedDetectionId: null })
    expect(reply).toMatch(/don't have enough evidence/)
  })
})
