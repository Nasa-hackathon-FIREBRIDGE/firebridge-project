import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, CalendarSearch, Eye, MapPinned, Navigation, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { ExplainerAnswer } from '../../services/explainer.service'
import { fmtMonth } from '../bridge/format'
import { actionsFor, type CopilotAction } from './actions'
import { useCopilot, type CopilotMessage, type CopilotState } from './context'
import { suggestionsFor } from './suggestions'
import { Markdown } from './Markdown'

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'ar', label: 'ع' },
]

const THINKING = ['Reading the evidence', 'Consulting the satellite records', 'Checking every number against the evidence', 'Routing to an available model']

function toolSummary(calls: ExplainerAnswer['tool_calls']): string | null {
  const parts = calls.map((call) => {
    let args: Record<string, string> = {}
    try {
      args = JSON.parse(call.arguments || '{}')
    } catch {
      /* shown without detail */
    }
    switch (call.name) {
      case 'get_month':
        return `month ${args.month ?? ''}`.trim()
      case 'get_day':
        return `day ${args.date ?? ''}`.trim()
      case 'compare_periods':
        return `compared ${args.first ?? '?'} with ${args.second ?? '?'}`
      case 'unusual_months':
        return 'the satellite jury'
      case 'largest_episodes':
        return 'the largest fire episodes'
      case 'handover_rehearsals':
        return 'the handover rehearsals'
      case 'top_months':
        return 'the busiest months'
      default:
        return 'searched the evidence'
    }
  })
  return parts.length ? `Looked up ${[...new Set(parts)].join(', ')}` : null
}

const shortModel = (model: string | null) => (model ? model.split('/').pop()! : 'no model')

function ActionButtons({ actions }: { actions: CopilotAction[] }) {
  if (!actions.length) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Show me in the analysis">
      {actions.map((action) => {
        const Icon = action.kind === 'calendar' ? CalendarSearch : action.kind === 'map' ? MapPinned : Navigation
        return (
          <button key={action.key} type="button" onClick={action.run} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-ember-400/40 hover:bg-ember-500/10">
            <Icon size={13} className="text-ember-300" aria-hidden="true" />
            {action.label}
          </button>
        )
      })}
    </div>
  )
}

function Trust({ answer }: { answer: ExplainerAnswer }) {
  const rerouted = answer.attempts.filter((a) => a.outcome !== 'ok').map((a) => shortModel(a.model))
  const tools = toolSummary(answer.tool_calls)
  const verified = answer.verification.status === 'verified'
  return (
    <div className="mt-2.5 flex flex-col gap-1 text-[11px] leading-snug text-fg-3">
      {answer.generated_from === 'llm' && (
        <span className={`inline-flex items-center gap-1.5 ${verified ? 'text-ok' : 'text-warn'}`}>
          {verified ? <ShieldCheck size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
          {verified
            ? `${answer.verification.numbers_checked} number${answer.verification.numbers_checked === 1 ? '' : 's'} checked against the evidence`
            : `Not found in the evidence: ${answer.verification.unsupported_numbers.join(', ')}`}
        </span>
      )}
      {tools && <span>{tools}</span>}
      <span className="font-mono">
        {answer.generated_from === 'fallback' ? 'evidence only · every model at its limit' : `answered by ${shortModel(answer.model)}`}
        {rerouted.length > 0 && answer.generated_from === 'llm' && ` · rerouted around ${[...new Set(rerouted)].join(', ')}`}
      </span>
    </div>
  )
}

function Message({ message, copilot }: { message: CopilotMessage; copilot: CopilotState }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!message.pending) return
    const timer = window.setInterval(() => setStep((s) => (s + 1) % THINKING.length), 1800)
    return () => window.clearInterval(timer)
  }, [message.pending])
  if (message.role === 'user')
    return (
      <div className="flex justify-end">
        <p dir="auto" className="m-0 max-w-[85%] rounded-2xl rounded-br-md bg-ember-500/15 px-3.5 py-2 text-[13.5px] leading-relaxed text-fg">{message.content}</p>
      </div>
    )
  if (message.pending)
    return (
      <div className="flex items-center gap-2.5 text-[12.5px] text-fg-3" role="status">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-ember-400" style={{ animationDelay: `${i * 160}ms` }} />)}
        </span>
        {THINKING[step]}…
      </div>
    )
  if (message.error)
    return <p className="m-0 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-fg-2" role="alert">{message.error}</p>
  const answer = message.answer!
  const facts = { ...copilot.facts, ...Object.fromEntries(answer.citations.filter((c) => c.text).map((c) => [c.id, c.text])) }
  return (
    <div dir="auto" className="min-w-0">
      <Markdown text={message.content} facts={facts} />
      <ActionButtons actions={actionsFor(answer.references, copilot.nav)} />
      <Trust answer={answer} />
    </div>
  )
}

function BriefingCard({ copilot }: { copilot: CopilotState }) {
  const briefing = copilot.briefing!
  const summary = briefing.summary
  const finding = summary?.findings[briefing.step]
  const actions = useMemo(() => (finding ? actionsFor(finding.refs, copilot.nav, 3) : []), [finding, copilot.nav])
  const lastRun = useRef<string | null>(null)
  // Follow along: the workspace moves to the evidence of each step as the briefing advances.
  useEffect(() => {
    const key = finding ? `${briefing.step}:${finding.title}` : null
    if (!key || !briefing.follow || lastRun.current === key) return
    lastRun.current = key
    actions[0]?.run()
  }, [briefing.step, briefing.follow, finding, actions])

  if (briefing.status === 'loading')
    return (
      <div className="rounded-2xl border border-ember-400/20 bg-ember-500/[0.06] p-4" role="status">
        <p className="m-0 flex items-center gap-2 text-[13px] text-ember-200"><Sparkles size={14} className="animate-pulse" aria-hidden="true" /> Preparing your briefing from the evidence…</p>
      </div>
    )
  if (briefing.status === 'error' || !summary || !finding)
    return <p className="m-0 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-fg-2" role="alert">{briefing.error ?? 'The briefing could not be prepared.'}</p>
  const total = summary.findings.length
  const go = (step: number) => copilot.setBriefing((b) => ({ ...b, step }))
  return (
    <section className="rounded-2xl border border-ember-400/25 bg-gradient-to-b from-ember-500/[0.09] to-transparent p-4" aria-label="Briefing">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ember-300">Briefing · {briefing.step + 1}/{total}</p>
        <label className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
          <input type="checkbox" className="!m-0 !min-h-0 !w-auto accent-[#ff7c40]" checked={briefing.follow} onChange={(e) => copilot.setBriefing((b) => ({ ...b, follow: e.target.checked }))} />
          Follow along
        </label>
      </div>
      {briefing.step === 0 && <p dir="auto" className="m-0 mb-2 text-[15px] font-semibold leading-snug text-fg">{summary.headline}</p>}
      <p dir="auto" className="m-0 text-[13px] font-semibold text-fg">{finding.title}</p>
      <div dir="auto"><Markdown text={finding.detail} facts={copilot.facts} /></div>
      {finding.facts.length > 0 && <p className="m-0 mt-1 font-mono text-[10.5px] text-fg-3">Evidence: {finding.facts.join(' · ')}</p>}
      <ActionButtons actions={actions} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button type="button" disabled={briefing.step === 0} onClick={() => go(briefing.step - 1)} aria-label="Previous finding" className="grid size-8 place-items-center rounded-lg border border-white/10 bg-transparent text-fg-2 enabled:hover:text-fg disabled:opacity-30"><ArrowLeft size={14} /></button>
          <button type="button" disabled={briefing.step === total - 1} onClick={() => go(briefing.step + 1)} aria-label="Next finding" className="inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-ember-500/20 px-3 text-[12px] font-medium text-ember-100 enabled:hover:bg-ember-500/30 disabled:opacity-30">Next <ArrowRight size={13} /></button>
        </div>
        <button type="button" onClick={() => copilot.ask(`Tell me more about this: ${finding.title}`)} className="border-0 bg-transparent p-0 text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline">Ask about this</button>
      </div>
      <p className="m-0 mt-2 text-[10.5px] text-fg-3">
        {summary.generated_from === 'template' ? 'Every model is at its limit: these are the key facts, without generated text.' : `${summary.verification.numbers_checked} numbers checked · ${shortModel(summary.model)}`}
      </p>
    </section>
  )
}

export function CopilotDock() {
  const copilot = useCopilot()!
  const { open, setOpen, view, messages, busy, available, briefing, language, setLanguage, ask, brief, restart } = copilot
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)

  // "/" opens the copilot from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
  }, [open])
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [messages, briefing?.status, briefing?.step])

  const send = () => {
    if (!draft.trim() || busy) return
    ask(draft)
    setDraft('')
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }
  const suggestions = suggestionsFor(view)
  const offline = available === false

  if (!open)
    return (
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={offline ? 'FIREBRIDGE copilot (offline)' : 'Ask FIREBRIDGE about this analysis'}
        className="group fixed bottom-5 right-5 z-[70] flex items-center gap-2.5 rounded-full border-0 bg-transparent p-0 font-sans sm:bottom-6 sm:right-6"
      >
        <span className="pointer-events-none hidden rounded-full border border-white/10 bg-ink-900/90 px-3 py-1.5 text-[12.5px] text-fg-2 opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
          {offline ? 'AI explainer offline' : <>Ask FIREBRIDGE <kbd className="ml-1 rounded border border-white/15 px-1 font-mono text-[10.5px] text-fg-3">/</kbd></>}
        </span>
        <span className="relative grid size-14 place-items-center">
          {!offline && <span className="absolute inset-0 animate-[spin_9s_linear_infinite] rounded-full opacity-80" style={{ background: 'conic-gradient(from 0deg, transparent 0 55%, #ff7c40 75%, #ffc5a3 85%, transparent 100%)' }} aria-hidden="true" />}
          <span className={`absolute inset-[3px] grid place-items-center rounded-full shadow-[0_10px_30px_-8px_rgba(255,95,31,0.6)] ${offline ? 'bg-ink-700' : 'bg-ember-gradient'}`}>
            <Sparkles size={22} className={offline ? 'text-fg-3' : 'text-ink-950'} aria-hidden="true" />
          </span>
        </span>
      </button>
    )

  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="copilot-title" className="fixed inset-0 z-[70] flex flex-col border-l border-white/[0.08] bg-ink-900 font-sans shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[440px]" onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), launcher.current?.focus())}>
      <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ember-gradient" aria-hidden="true"><Sparkles size={17} className="text-ink-950" /></span>
          <div className="min-w-0">
            <h2 id="copilot-title" className="m-0 text-[15px] font-semibold text-fg">FIREBRIDGE copilot</h2>
            <p className="m-0 text-[11.5px] text-fg-3">Answers only from this analysis, numbers checked</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div role="radiogroup" aria-label="Answer language" className="mr-1 inline-flex rounded-lg border border-white/[0.08] p-0.5">
            {LANGUAGES.map((l) => (
              <button key={l.code} type="button" role="radio" aria-checked={language === l.code} aria-label={{ en: 'English', fr: 'French', ar: 'Arabic' }[l.code]} onClick={() => setLanguage(l.code)} className={`rounded-md border-0 px-1.5 py-0.5 text-[11px] font-semibold ${language === l.code ? 'bg-white/[0.1] text-fg' : 'bg-transparent text-fg-3 hover:text-fg'}`}>
                {l.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={restart} aria-label="New conversation" title="New conversation" className="grid size-8 place-items-center rounded-lg border-0 bg-transparent text-fg-3 hover:text-fg"><RotateCcw size={15} /></button>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close copilot" className="grid size-8 place-items-center rounded-lg border-0 bg-transparent text-fg-3 hover:text-fg"><X size={17} /></button>
        </div>
      </header>

      <p className="m-0 flex items-center gap-1.5 border-b border-white/[0.04] px-4 py-2 text-[11.5px] text-fg-3">
        <Eye size={12} aria-hidden="true" /> Looking at <span className="text-fg-2">{view.label}{view.month ? ` · ${fmtMonth(view.month, 'long')}` : ''}</span>
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {offline && <p className="m-0 rounded-xl border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[12.5px] text-fg-2">The AI explainer is offline right now. Everything else in the analysis works as usual.</p>}
        {briefing && <BriefingCard copilot={copilot} />}
        {!messages.length && !briefing && (
          <div className="flex flex-col gap-3">
            <button type="button" onClick={brief} disabled={offline} className="group flex items-center justify-between gap-3 rounded-2xl border border-ember-400/25 bg-gradient-to-br from-ember-500/[0.14] to-transparent px-4 py-3.5 text-left enabled:hover:border-ember-400/50 disabled:opacity-40">
              <span>
                <span className="block text-[14px] font-semibold text-fg">Brief me</span>
                <span className="block text-[12px] text-fg-2">A guided tour of the key findings; the workspace follows along.</span>
              </span>
              <ArrowRight size={16} className="text-ember-300 transition-transform group-enabled:group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
            <p className="m-0 text-[12px] text-fg-3">Or ask anything about this analysis. Answers cite the evidence and can take you to it.</p>
          </div>
        )}
        {messages.map((message) => <Message key={message.id} message={message} copilot={copilot} />)}
        <div ref={end} />
      </div>

      <footer className="border-t border-white/[0.06] px-4 pb-4 pt-3">
        {!busy && !offline && (
          <div className="mb-2.5 flex flex-wrap gap-1.5" aria-label="Suggested questions">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-left text-[11.5px] text-fg-2 hover:border-ember-400/35 hover:text-fg">{s}</button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-ink-800/80 p-1.5 focus-within:border-ember-400/40">
          <label htmlFor="copilot-input" className="sr-only">Ask about this analysis</label>
          <textarea
            id="copilot-input"
            ref={input}
            dir="auto"
            rows={1}
            value={draft}
            disabled={offline}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={view.month ? `Ask about ${fmtMonth(view.month, 'long')}…` : 'Ask about this analysis…'}
            className="!min-h-0 max-h-32 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] text-fg outline-none placeholder:text-fg-3"
          />
          <button type="button" onClick={send} disabled={!draft.trim() || busy || offline} aria-label="Send question" className="grid size-9 shrink-0 place-items-center rounded-xl border-0 bg-ember-gradient text-ink-950 disabled:opacity-30">
            <ArrowUp size={17} />
          </button>
        </div>
      </footer>
    </aside>
  )
}
