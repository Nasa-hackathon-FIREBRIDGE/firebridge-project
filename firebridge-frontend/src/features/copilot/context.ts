import { createContext, useContext } from 'react'
import type { ExplainerAnswer, ExplainerSummary } from '../../services/explainer.service'
import type { CopilotNav } from './actions'

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  answer?: ExplainerAnswer
  pending?: boolean
  error?: string
}

export interface Briefing {
  status: 'loading' | 'ready' | 'error'
  summary?: ExplainerSummary
  step: number
  follow: boolean
  error?: string
}

export interface CopilotView {
  section: string
  label: string
  month: string | null
}

export interface CopilotState {
  open: boolean
  setOpen: (open: boolean) => void
  /** Open the copilot and ask, optionally about a specific month. */
  ask: (question: string, about?: { month?: string }) => void
  brief: () => void
  setBriefing: (update: (current: Briefing) => Briefing) => void
  briefing: Briefing | null
  messages: CopilotMessage[]
  busy: boolean
  available: boolean | null
  language: string
  setLanguage: (language: string) => void
  view: CopilotView
  facts: Record<string, string>
  nav: CopilotNav
  /** The fire calendar reports the month it shows, and receives months to show. */
  reportMonth: (month: string | null) => void
  monthRequest: { month: string; nonce: number } | null
  restart: () => void
}

export const CopilotContext = createContext<CopilotState | null>(null)

/** The copilot when the workspace provides one; null elsewhere (components stay usable alone). */
export const useCopilot = () => useContext(CopilotContext)

export const SECTION_LABELS: Record<string, string> = {
  'workspace-top': 'Map workspace',
  'analysis-overview': 'Overview',
  'fire-calendar': 'Fire calendar',
  'fire-drivers': 'Fire drivers',
  'sensor-bridge': 'Sensor bridge',
  'observation-records': 'Observations',
  'temporal-analysis': 'Timeline',
  'source-comparison': 'Compare sources',
  'data-provenance': 'Data & provenance',
  'analysis-context': 'Context & notes',
  'export-results': 'Exports',
}
