// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBridge } from '../bridge/engine/index.ts'
import { driftingSeasons } from '../bridge/test-fixtures'
import type { BridgeState } from '../bridge/useBridgeReport'
import type { ExplainerAnswer, ExplainerSummary } from '../../services/explainer.service'

const ANALYSIS = '13ad2e0c-cd43-4ee9-bcc6-fd8b273beb70'
const report = runBridge({ detections: driftingSeasons(), start: '2019-01-01', endExclusive: '2025-01-01' })
const bridgeState: BridgeState = { status: 'ready', report }
vi.mock('../bridge/useBridgeReport', () => ({ MAX_BRIDGE_DETECTIONS: 150_000, useBridgeReport: (id?: string) => (id ? bridgeState : { status: 'idle' }) }))

const refs = (patch: Partial<ExplainerAnswer['references']> = {}) => ({ months: [], days: [], episodes: [], sections: [], ...patch })
const answer = (patch: Partial<ExplainerAnswer> = {}): ExplainerAnswer => ({
  message_id: 7,
  answer: '**July 2022** stands out: 29 against a usual 1.5 [F25].\n\n- Four satellites agree\n- <img src=x onerror=alert(1)>',
  generated_from: 'llm',
  model: 'openai/gpt-oss-120b',
  citations: [{ id: 'F25', text: 'July 2022 was unusually high.' }],
  verification: { status: 'verified', numbers_checked: 3, unsupported_numbers: [] },
  tool_calls: [{ name: 'get_month', arguments: '{"month":"2022-07"}' }],
  attempts: [{ model: 'qwen/qwen3.8-27b', outcome: 'rate_limited' }, { model: 'openai/gpt-oss-120b', outcome: 'ok' }],
  references: refs({ months: ['2022-07'], days: ['2022-07-15'], sections: ['rehearsal'] }),
  retry_after: null,
  ...patch,
})
const summary: ExplainerSummary = {
  headline: 'July 2022 was the most unusual month, and all satellites agree.',
  findings: [
    { title: 'Unusual July', detail: '29 cell-days against a usual 1.5 [F25].', facts: ['F25'], refs: refs({ months: ['2022-07'] }) },
    { title: 'Aqua drifted', detail: 'From 13:15 to 15:18 [F19].', facts: ['F19'], refs: refs({ sections: ['regime'] }) },
  ],
  caveats: [],
  follow_up_questions: [],
  generated_from: 'llm',
  model: 'qwen/qwen3.8-27b',
  verification: { status: 'verified', numbers_checked: 6, unsupported_numbers: [] },
}

const api = vi.hoisted(() => ({
  status: vi.fn(),
  known: vi.fn(),
  analysis: vi.fn(),
  summary: vi.fn(),
  createSession: vi.fn(),
  session: vi.fn(),
  ask: vi.fn(),
}))
vi.mock('../../services/explainer.service', async (original) => ({ ...(await original<object>()), explainer: api }))

const { CopilotProvider } = await import('./CopilotProvider')
const { AskWhy } = await import('./AskWhy')
const { Markdown } = await import('./Markdown')

const nav = { openSection: vi.fn(), showInterval: vi.fn() }

function renderCopilot(section = 'fire-calendar') {
  return render(
    <CopilotProvider analysisId={ANALYSIS} releaseId="rel" section={section} nav={nav}>
      <AskWhy question="Why is July 2022 marked unusual?" month="2022-07" />
    </CopilotProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  api.status.mockResolvedValue({ available: true })
  api.known.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
  api.analysis.mockResolvedValue({ analysis_id: ANALYSIS, title: 't', sources: ['firebridge_api', 'bridge_report'], facts: [{ id: 'F19', topic: 'drift', text: 'Aqua drifted.', priority: 1 }] })
  api.createSession.mockResolvedValue({ id: 's'.repeat(32), analysis_id: ANALYSIS, language: 'en' })
  api.ask.mockResolvedValue(answer())
  api.summary.mockResolvedValue(summary)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FIREBRIDGE copilot', () => {
  it('answers with evidence, a trust line and buttons that move the workspace', async () => {
    renderCopilot()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask FIREBRIDGE about this analysis' }))
    const panel = screen.getByRole('dialog', { name: 'FIREBRIDGE copilot' })
    fireEvent.change(within(panel).getByLabelText('Ask about this analysis'), { target: { value: 'Why July?' } })
    fireEvent.keyDown(within(panel).getByLabelText('Ask about this analysis'), { key: 'Enter' })

    expect(await within(panel).findByText('July 2022', { selector: 'strong' })).toBeInTheDocument()
    expect(within(panel).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument() // text, never HTML
    expect(within(panel).getByText('3 numbers checked against the evidence')).toBeInTheDocument()
    expect(within(panel).getByText(/answered by gpt-oss-120b · rerouted around qwen3.8-27b/)).toBeInTheDocument()
    expect(within(panel).getByText('Looked up month 2022-07')).toBeInTheDocument()

    // The analysis was handed to the agent once, with the report this browser computed.
    expect(api.analysis).toHaveBeenCalledTimes(1)
    expect(api.analysis.mock.calls[0][1].report.months).toHaveLength(report.months.length)
    expect(api.analysis.mock.calls[0][1].report.episodes.all).toBeUndefined()
    expect(api.ask).toHaveBeenCalledWith('s'.repeat(32), 'Why July?', { view: 'fire-calendar', label: 'Fire calendar' })

    fireEvent.click(within(panel).getByRole('button', { name: 'F25' }))
    expect(within(panel).getByText('July 2022 was unusually high.', { exact: false })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'July 2022 in the calendar' }))
    expect(nav.openSection).toHaveBeenCalledWith('fire-calendar', 'calendar-grid-heading')
    fireEvent.click(within(panel).getByRole('button', { name: '15 Jul 2022 on the map' }))
    expect(nav.showInterval).toHaveBeenCalledWith('2022-07-15', '2022-07-16')
    fireEvent.click(within(panel).getByRole('button', { name: 'Open the handover rehearsal' }))
    expect(nav.openSection).toHaveBeenCalledWith('sensor-bridge', 'bridge-act-5')
  })

  it('briefs as a guided tour that the workspace follows', async () => {
    renderCopilot('analysis-overview')
    fireEvent.click(await screen.findByRole('button', { name: 'Ask FIREBRIDGE about this analysis' }))
    fireEvent.click(screen.getByRole('button', { name: /Brief me/ }))
    const briefing = await screen.findByRole('region', { name: 'Briefing' })
    expect(within(briefing).getByText(summary.headline)).toBeInTheDocument()
    expect(within(briefing).getByText('Briefing · 1/2')).toBeInTheDocument()
    await waitFor(() => expect(nav.openSection).toHaveBeenCalledWith('fire-calendar', 'calendar-grid-heading'))
    fireEvent.click(within(briefing).getByRole('button', { name: 'Next finding' }))
    expect(within(briefing).getByText('Aqua drifted')).toBeInTheDocument()
    await waitFor(() => expect(nav.openSection).toHaveBeenCalledWith('sensor-bridge', 'bridge-act-2'))
  })

  it('asks why from a finding, about that month', async () => {
    renderCopilot('fire-calendar')
    fireEvent.click(await screen.findByRole('button', { name: /Ask why/ }))
    await waitFor(() => expect(api.ask).toHaveBeenCalledWith('s'.repeat(32), 'Why is July 2022 marked unusual?', { view: 'fire-calendar', label: 'Fire calendar', month: '2022-07' }))
    expect(screen.getByRole('dialog', { name: 'FIREBRIDGE copilot' })).toBeInTheDocument()
  })

  it('does not upload an analysis the agent already has, and resumes the conversation', async () => {
    api.known.mockResolvedValue({ analysis_id: ANALYSIS, title: 't', sources: ['firebridge_api', 'bridge_report'], facts: [] })
    window.localStorage.setItem(`fb-copilot-session:${ANALYSIS}:en`, 'r'.repeat(32))
    api.session.mockResolvedValue({ id: 'r'.repeat(32), analysis_id: ANALYSIS, language: 'en', messages: [{ id: 1, role: 'user', content: 'Earlier question', meta: {} }, { id: 2, role: 'assistant', content: 'Earlier answer [F19]', meta: { references: { months: ['2022-07'] }, verification: { status: 'verified', numbers_checked: 0, unsupported_numbers: [] } } }] })
    renderCopilot()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask FIREBRIDGE about this analysis' }))
    expect(await screen.findByText('Earlier question')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'July 2022 in the calendar' })).toBeInTheDocument()
    expect(api.analysis).not.toHaveBeenCalled()
    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('stays out of the way when the explainer is offline', async () => {
    api.status.mockResolvedValue({ available: false })
    renderCopilot()
    expect(await screen.findByRole('button', { name: 'FIREBRIDGE copilot (offline)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ask why/ })).toBeNull()
  })

  it('opens with the slash key but not while typing', async () => {
    render(
      <CopilotProvider analysisId={ANALYSIS} section="workspace-top" nav={nav}>
        <input aria-label="Other field" />
      </CopilotProvider>,
    )
    await screen.findByRole('button', { name: 'Ask FIREBRIDGE about this analysis' })
    fireEvent.keyDown(screen.getByLabelText('Other field'), { key: '/' })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }))
    })
    expect(screen.getByRole('dialog', { name: 'FIREBRIDGE copilot' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What was the largest fire episode?' })).toBeInTheDocument()
  })
})

describe('Markdown answers', () => {
  it('renders lists, tables and citations without HTML', () => {
    render(<Markdown text={'## Heading\n| Year | Total |\n|---|---|\n| 2021 | 830 |\n1. First [F2, F3]\n2. Second'} facts={{ F2: 'two', F3: 'three' }} />)
    expect(screen.getByText('Heading')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('2021830')
    expect(screen.getByRole('button', { name: 'F2 · F3' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
