import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ApiClientError } from '../../lib/axios'
import { answerOf, explainer, type ExplainerAnswer, type ExplainerContext } from '../../services/explainer.service'
import { useBridgeReport } from '../bridge/useBridgeReport'
import type { CopilotNav } from './actions'
import { CopilotContext, SECTION_LABELS, type Briefing, type CopilotMessage, type CopilotState } from './context'
import { CopilotDock } from './CopilotDock'
import { explainerReport } from './trimReport'

const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, value)
    } catch {
      /* private mode: the copilot still works for this page */
    }
  },
}

function clientId(): string {
  const existing = store.get('fb-copilot-client')
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing
  const id = crypto.randomUUID()
  store.set('fb-copilot-client', id)
  return id
}

const sessionKey = (analysisId: string, language: string) => `fb-copilot-session:${analysisId}:${language}`
let counter = 0
const localId = () => `m${++counter}`

function messageFromHistory(m: { id: number; role: 'user' | 'assistant'; content: string; meta: Record<string, unknown> }): CopilotMessage {
  if (m.role === 'user') return { id: `h${m.id}`, role: 'user', content: m.content }
  // History keeps cited fact ids only; their text comes from the analysis facts.
  const citations = Array.isArray(m.meta.citations) ? m.meta.citations.filter((id) => typeof id === 'string').map((id) => ({ id, text: '' })) : []
  const answer = answerOf({ ...m.meta, message_id: m.id, answer: m.content, citations, attempts: [], retry_after: null })
  return { id: `h${m.id}`, role: 'assistant', content: m.content, answer }
}

/**
 * The FIREBRIDGE copilot for one analysis. Nothing is loaded until it is first used: then the
 * sensor-bridge report computed in this browser is handed to the explainer agent (through the
 * FIREBRIDGE API, which holds the agent's key), and a conversation starts or resumes.
 */
export function CopilotProvider({ analysisId, releaseId, section, nav, children }: { analysisId?: string; releaseId?: string; section: string; nav: Omit<CopilotNav, 'focusMonth'>; children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [activated, setActivated] = useState(false)
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [briefing, setBriefingState] = useState<Briefing | null>(null)
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [language, setLanguageState] = useState(() => store.get('fb-copilot-language') || 'en')
  const [facts, setFacts] = useState<Record<string, string>>({})
  const [calendarMonth, setCalendarMonth] = useState<string | null>(null)
  const [monthRequest, setMonthRequest] = useState<{ month: string; nonce: number } | null>(null)

  // The bridge report is computed only once the copilot is used (it loads every detection).
  const bridge = useBridgeReport(activated ? analysisId : undefined)
  const bridgeRef = useRef(bridge)
  const waiters = useRef<((report: unknown) => void)[]>([])
  useEffect(() => {
    bridgeRef.current = bridge
    if (bridge.status === 'ready' || bridge.status === 'error' || bridge.status === 'too-large') {
      const report = bridge.status === 'ready' && analysisId ? explainerReport(bridge.report, analysisId, releaseId) : null
      waiters.current.splice(0).forEach((resolve) => resolve(report))
    }
  }, [bridge, analysisId, releaseId])

  const ready = useRef(new Map<string, Promise<string>>())
  const analysisReady = useRef(new Map<string, Promise<void>>())

  // Reset everything when the analysis changes.
  const [shownFor, setShownFor] = useState(analysisId)
  if (shownFor !== analysisId) {
    setShownFor(analysisId)
    setMessages([])
    setBriefingState(null)
    setFacts({})
    setOpenState(false)
  }

  useEffect(() => {
    if (!analysisId) return
    const controller = new AbortController()
    explainer.status(controller.signal).then((s) => setAvailable(s.available), () => setAvailable(false))
    return () => controller.abort()
  }, [analysisId])

  const waitForReport = useCallback(() => {
    const state = bridgeRef.current
    if (state.status === 'ready' && analysisId) return Promise.resolve(explainerReport(state.report, analysisId, releaseId))
    if (state.status === 'error' || state.status === 'too-large') return Promise.resolve(null)
    return new Promise<unknown>((resolve) => {
      waiters.current.push(resolve)
      // Never hold the conversation hostage to a slow report: continue with native records only.
      window.setTimeout(() => resolve(null), 60_000)
    })
  }, [analysisId, releaseId])

  const ensureAnalysis = useCallback((): Promise<void> => {
    if (!analysisId) return Promise.reject(new Error('No analysis selected.'))
    const existing = analysisReady.current.get(analysisId)
    if (existing) return existing
    const task = (async () => {
      const report = await waitForReport()
      let known = await explainer.known(analysisId).catch(() => null)
      if (!known || (report && !known.sources.includes('bridge_report'))) known = await explainer.analysis(analysisId, report)
      setFacts(Object.fromEntries(known.facts.map((f) => [f.id, f.text])))
    })()
    task.catch(() => analysisReady.current.delete(analysisId))
    analysisReady.current.set(analysisId, task)
    return task
  }, [analysisId, waitForReport])

  const ensureSession = useCallback((): Promise<string> => {
    if (!analysisId) return Promise.reject(new Error('No analysis selected.'))
    const key = sessionKey(analysisId, language)
    const existing = ready.current.get(key)
    if (existing) return existing
    const task = (async () => {
      await ensureAnalysis()
      const stored = store.get(key)
      if (stored) {
        try {
          const session = await explainer.session(stored)
          setMessages((current) => (current.length ? current : (session.messages ?? []).map(messageFromHistory)))
          return stored
        } catch {
          store.set(key, null)
        }
      }
      const session = await explainer.createSession(analysisId, clientId(), language)
      store.set(key, session.id)
      return session.id
    })()
    task.catch(() => ready.current.delete(key))
    ready.current.set(key, task)
    return task
  }, [analysisId, language, ensureAnalysis])

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value)
    if (value) setActivated(true)
  }, [])

  useEffect(() => {
    if (open && analysisId) void ensureSession().catch(() => undefined)
  }, [open, analysisId, ensureSession])

  const view = useMemo(() => ({ section, label: SECTION_LABELS[section] ?? section, month: section === 'fire-calendar' ? calendarMonth : null }), [section, calendarMonth])
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const ask = useCallback(
    (question: string, about?: { month?: string }) => {
      const content = question.trim()
      if (!content || !analysisId) return
      setOpen(true)
      const pendingId = localId()
      setMessages((current) => [...current, { id: localId(), role: 'user', content }, { id: pendingId, role: 'assistant', content: '', pending: true }])
      setBusy(true)
      const current = viewRef.current
      const context: ExplainerContext = { view: current.section, label: current.label, ...((about?.month ?? current.month) ? { month: about?.month ?? current.month! } : {}) }
      const run = async (retry: boolean): Promise<ExplainerAnswer> => {
        const sessionId = await ensureSession()
        try {
          return await explainer.ask(sessionId, content, context)
        } catch (error) {
          // A session deleted on the server: start a fresh one once.
          if (retry && error instanceof ApiClientError && error.status === 404) {
            store.set(sessionKey(analysisId, language), null)
            ready.current.delete(sessionKey(analysisId, language))
            return run(false)
          }
          throw error
        }
      }
      run(true)
        .then((answer) => setMessages((list) => list.map((m) => (m.id === pendingId ? { ...m, pending: false, content: answer.answer, answer } : m))))
        .catch((error: unknown) => {
          const unavailable = error instanceof ApiClientError && (error.status === 503 || error.code === 'NETWORK_ERROR')
          const message = unavailable ? 'The AI explainer is offline right now. The analysis itself is unaffected.' : error instanceof Error ? error.message : 'The question could not be answered.'
          setMessages((list) => list.map((m) => (m.id === pendingId ? { ...m, pending: false, error: message } : m)))
          if (unavailable) setAvailable(false)
        })
        .finally(() => setBusy(false))
    },
    [analysisId, ensureSession, language, setOpen],
  )

  const brief = useCallback(() => {
    if (!analysisId) return
    setOpen(true)
    setBriefingState({ status: 'loading', step: 0, follow: true })
    ensureAnalysis()
      .then(() => explainer.summary(analysisId, language))
      .then((summary) => setBriefingState((b) => ({ status: 'ready', summary, step: 0, follow: b?.follow ?? true })))
      .catch((error: unknown) => setBriefingState({ status: 'error', step: 0, follow: true, error: error instanceof ApiClientError && error.status === 503 ? 'The AI explainer is offline right now.' : 'The briefing could not be prepared.' }))
  }, [analysisId, ensureAnalysis, language, setOpen])

  const setBriefing = useCallback((update: (current: Briefing) => Briefing) => setBriefingState((b) => (b ? update(b) : b)), [])

  const setLanguage = useCallback((value: string) => {
    store.set('fb-copilot-language', value)
    setLanguageState(value)
    setMessages([])
    setBriefingState(null)
  }, [])

  const restart = useCallback(() => {
    if (!analysisId) return
    store.set(sessionKey(analysisId, language), null)
    ready.current.delete(sessionKey(analysisId, language))
    setMessages([])
    setBriefingState(null)
  }, [analysisId, language])

  const fullNav = useMemo<CopilotNav>(
    () => ({
      ...nav,
      focusMonth: (month: string) => {
        setMonthRequest((r) => ({ month, nonce: (r?.nonce ?? 0) + 1 }))
        nav.openSection('fire-calendar', 'case-file-title')
      },
    }),
    [nav],
  )

  const value = useMemo<CopilotState>(
    () => ({ open, setOpen, ask, brief, briefing, setBriefing, messages, busy, available, language, setLanguage, view, facts, nav: fullNav, reportMonth: setCalendarMonth, monthRequest, restart }),
    [open, setOpen, ask, brief, briefing, setBriefing, messages, busy, available, language, setLanguage, view, facts, fullNav, monthRequest, restart],
  )

  // Wide screens: the workspace makes room and the copilot sits beside it, not over it.
  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 320)
    return () => window.clearTimeout(timer)
  }, [open, section])

  return (
    <CopilotContext.Provider value={value}>
      {/* The map keeps its full width: there the copilot overlays the side column instead. */}
      <div className={`transition-[padding] duration-300 ${open && analysisId && section !== 'workspace-top' ? 'min-[1280px]:pr-[440px]' : ''}`}>{children}</div>
      {/* Portalled: transformed layout ancestors would otherwise turn "fixed" into "absolute". */}
      {analysisId && createPortal(<CopilotDock />, document.body)}
    </CopilotContext.Provider>
  )
}
