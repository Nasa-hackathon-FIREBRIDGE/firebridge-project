import type { ApiEnvelope } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
import { checked, isRecord } from '../lib/api.validation'

/** What an answer or a finding is about, in terms the workspace can act on. */
export interface ExplainerRefs {
  months: string[]
  days: string[]
  episodes: { start: string; end: string }[]
  sections: string[]
}

export interface Verification {
  status: 'verified' | 'unverified_numbers'
  numbers_checked: number
  unsupported_numbers: string[]
}

export interface ExplainerAnswer {
  message_id: number
  answer: string
  generated_from: 'llm' | 'fallback' | 'refusal'
  model: string | null
  citations: { id: string; text: string }[]
  verification: Verification
  tool_calls: { name: string; arguments: string; model?: string }[]
  attempts: { model: string; outcome: string; detail?: string }[]
  references: ExplainerRefs
  retry_after: number | null
}

export interface ExplainerSummary {
  headline: string
  findings: { title: string; detail: string; facts: string[]; refs: ExplainerRefs }[]
  caveats: string[]
  follow_up_questions: string[]
  generated_from: 'llm' | 'template'
  model: string | null
  verification: Verification
}

export interface ExplainerFact {
  id: string
  topic: string
  text: string
  priority: number
}

export interface ExplainerAnalysis {
  analysis_id: string
  title: string
  sources: string[]
  facts: ExplainerFact[]
}

export interface ExplainerSession {
  id: string
  analysis_id: string
  language: string
  messages?: { id: number; role: 'user' | 'assistant'; content: string; meta: Record<string, unknown> }[]
}

export interface ExplainerContext {
  view?: string
  label?: string
  month?: string
}

const SLOW = { timeout: 180_000 }
const text = (v: unknown) => typeof v === 'string'
const emptyRefs: ExplainerRefs = { months: [], days: [], episodes: [], sections: [] }

export function refsOf(value: unknown): ExplainerRefs {
  if (!isRecord(value)) return emptyRefs
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter(text) as string[] : [])
  return {
    months: strings(value.months).filter((m) => /^\d{4}-\d{2}$/.test(m)),
    days: strings(value.days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    episodes: Array.isArray(value.episodes) ? value.episodes.filter((e): e is { start: string; end: string } => isRecord(e) && text(e.start) && text(e.end)) : [],
    sections: strings(value.sections),
  }
}

/** An answer in the shape the copilot renders, whatever the agent left out (a refusal carries no
 *  references, an old history entry no attempts). */
export function answerOf(value: Record<string, unknown>): ExplainerAnswer {
  const list = <T,>(v: unknown, keep: (item: unknown) => boolean = isRecord) => (Array.isArray(v) ? (v.filter(keep) as T[]) : [])
  const verification = isRecord(value.verification) ? value.verification : {}
  const from = value.generated_from
  return {
    message_id: typeof value.message_id === 'number' ? value.message_id : 0,
    answer: typeof value.answer === 'string' ? value.answer : '',
    generated_from: from === 'fallback' || from === 'refusal' ? from : 'llm',
    model: typeof value.model === 'string' ? value.model : null,
    citations: list<{ id: string; text: string }>(value.citations).filter((c) => text(c.id)).map((c) => ({ id: c.id, text: text(c.text) ? c.text : '' })),
    verification: {
      status: verification.status === 'unverified_numbers' ? 'unverified_numbers' : 'verified',
      numbers_checked: typeof verification.numbers_checked === 'number' ? verification.numbers_checked : 0,
      unsupported_numbers: list<string>(verification.unsupported_numbers, text),
    },
    tool_calls: list<ExplainerAnswer['tool_calls'][number]>(value.tool_calls).filter((c) => text(c.name)),
    attempts: list<ExplainerAnswer['attempts'][number]>(value.attempts),
    references: refsOf(value.references),
    retry_after: typeof value.retry_after === 'number' ? value.retry_after : null,
  }
}

async function post<T>(path: string, body: unknown, valid: (v: Record<string, unknown>) => boolean): Promise<T> {
  const response = await api.post<ApiEnvelope<T>>(`/explainer${path}`, body, SLOW)
  return checked(unwrap(response.data), valid)
}

export const explainer = {
  async status(signal?: AbortSignal): Promise<{ available: boolean }> {
    const response = await api.get<ApiEnvelope<{ available: boolean }>>('/explainer/status', { signal, timeout: 8000 })
    return checked(unwrap(response.data), (v) => typeof v.available === 'boolean')
  },
  /** The analysis as the agent already knows it, or null when it has never been loaded. */
  async known(analysisId: string): Promise<ExplainerAnalysis | null> {
    const response = await api.get<ApiEnvelope<ExplainerAnalysis>>(`/explainer/analyses/${encodeURIComponent(analysisId)}`, { timeout: 15_000 })
    const data = checked(unwrap(response.data), (v) => text(v.analysis_id) && Array.isArray(v.facts) && Array.isArray(v.sources))
    return data.sources.length ? data : null
  },
  analysis: (analysisId: string, report: unknown) =>
    post<ExplainerAnalysis>('/analyses', { analysis_id: analysisId, ...(report ? { report } : {}) }, (v) => text(v.analysis_id) && Array.isArray(v.facts)),
  summary: (analysisId: string, language: string) =>
    post<ExplainerSummary>(`/analyses/${encodeURIComponent(analysisId)}/summary`, { language }, (v) => text(v.headline) && Array.isArray(v.findings)),
  createSession: (analysisId: string, clientId: string, language: string) =>
    post<ExplainerSession>('/sessions', { analysis_id: analysisId, client_id: clientId, language }, (v) => text(v.id)),
  async session(sessionId: string): Promise<ExplainerSession> {
    const response = await api.get<ApiEnvelope<ExplainerSession>>(`/explainer/sessions/${encodeURIComponent(sessionId)}`, { timeout: 15_000 })
    return checked(unwrap(response.data), (v) => text(v.id) && Array.isArray(v.messages))
  },
  ask: async (sessionId: string, content: string, context: ExplainerContext) =>
    answerOf(await post<Record<string, unknown>>(`/sessions/${encodeURIComponent(sessionId)}/messages`, { content, context }, (v) => text(v.answer))),
}
