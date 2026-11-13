import type { CSSProperties, ReactNode } from 'react'
import { ArrowUpRight, Check as CheckIcon, Minus, Telescope, X } from 'lucide-react'
import { REFERENCES, type Reference, type ReferenceId } from './references'

/**
 * Findings, set as an editorial ledger. Each result is a sentence; under it, what this analysis
 * measured (data the result did not use); in the margin, what published science already knows.
 * When both voices agree the finding is confirmed; when they part, the ledger says so.
 */
export type CheckStatus = 'confirms' | 'nuance' | 'contradicts' | 'open' | 'further'

const OPTICAL = (size: number): CSSProperties => ({ fontVariationSettings: `"opsz" ${size}` })

const STATUS: Record<CheckStatus, { label: string; icon: ReactNode; text: string; ring: string }> = {
  confirms: { label: 'Confirmed', icon: <CheckIcon size={17} strokeWidth={2.25} />, text: 'text-ok', ring: 'border-ok/40 shadow-[0_0_24px_-6px_rgba(74,222,128,0.5)]' },
  nuance: { label: 'In part', icon: <span className="font-serif text-[20px] leading-none">~</span>, text: 'text-warn', ring: 'border-warn/40' },
  contradicts: { label: 'Contradicted', icon: <X size={17} strokeWidth={2.25} />, text: 'text-bad', ring: 'border-bad/40' },
  open: { label: 'Not testable here', icon: <Minus size={17} />, text: 'text-fg-3', ring: 'border-white/15 border-dashed' },
  further: { label: 'Goes further', icon: <Telescope size={16} />, text: 'text-ember-300', ring: 'border-ember-400/45 shadow-[0_0_24px_-6px_rgba(255,124,64,0.55)]' },
}

export function Cite({ id }: { id: ReferenceId }) {
  const ref: Reference = REFERENCES[id]
  const className = 'whitespace-nowrap font-serif italic text-ember-200/90 no-underline decoration-ember-300/40 underline-offset-2 hover:text-ember-100 hover:underline'
  if (!ref.url) return <span className={className} title={ref.full}>{ref.short}</span>
  return (
    <a className={className} href={ref.url} target="_blank" rel="noreferrer" title={ref.full}>
      {ref.short}
    </a>
  )
}

export function Cites({ ids }: { ids: readonly ReferenceId[] }) {
  if (!ids.length) return null
  return (
    <span className="ml-1 inline">
      <span aria-hidden="true">— </span>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && '; '}
          <Cite id={id} />
        </span>
      ))}
    </span>
  )
}

export function StatusChip({ status }: { status: CheckStatus }) {
  const s = STATUS[status]
  return <span className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${s.text}`}>{s.label}</span>
}

function Mark({ status }: { status: CheckStatus }) {
  const s = STATUS[status]
  return (
    <span className="flex items-center gap-3 lg:flex-col lg:items-center lg:gap-2">
      <span className={`grid size-10 place-items-center rounded-full border bg-ink-950 ${s.ring} ${s.text}`} aria-hidden="true">{s.icon}</span>
      <StatusChip status={status} />
    </span>
  )
}

export interface CheckProps {
  status: CheckStatus
  /** The claim, in one plain sentence. */
  claim: ReactNode
  /** What this analysis measured. */
  measured: ReactNode
  /** What published science establishes. */
  science?: ReactNode
  cites?: readonly ReferenceId[]
  /** What the agreement (or disagreement) lets us say beyond the original result. */
  further?: ReactNode
}

/** One finding: verdict mark, claim, measurement, and the literature in the margin. */
export function Check({ status, claim, measured, science, cites = [], further, compact = false }: CheckProps & { compact?: boolean }) {
  return (
    <li className="grid gap-x-8 gap-y-4 border-t border-white/[0.06] py-8 first:border-t-0 first:pt-2 lg:grid-cols-[84px_minmax(0,1fr)_minmax(220px,300px)]">
      <Mark status={status} />
      <div className="flex min-w-0 flex-col gap-3">
        <p className={`m-0 font-serif font-[420] leading-[1.25] tracking-[-0.01em] text-paper ${compact ? 'text-[19px]' : 'text-[clamp(19px,1.8vw,23px)]'}`} style={OPTICAL(48)}>{claim}</p>
        <div className="max-w-[68ch] text-[14px] leading-[1.7] text-fg-2 [&_p]:[font:inherit] [&_p]:[color:inherit] [&_strong]:font-semibold [&_strong]:text-fg">{measured}</div>
        {further && (
          <p className="m-0 flex max-w-[68ch] gap-2 font-serif text-[15.5px] italic leading-[1.6] text-ember-200 [&_strong]:font-[560] [&_strong]:text-ember-100" style={OPTICAL(18)}>
            <ArrowUpRight size={16} className="mt-1 shrink-0 text-ember-300" aria-hidden="true" />
            <span>{further}</span>
          </p>
        )}
      </div>
      {science ? (
        <aside className="border-l border-white/[0.07] pl-5 text-[12.5px] leading-[1.65] text-fg-3">
          <p className="m-0 mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-3">Published science</p>
          <span className="text-fg-2/90">{science}</span>
          <Cites ids={cites} />
        </aside>
      ) : (
        <span className="hidden lg:block" />
      )}
    </li>
  )
}

/** "4 confirmed, 1 goes further": the ledger's outcome as figures. */
export function Tally({ statuses }: { statuses: readonly CheckStatus[] }) {
  const order: CheckStatus[] = ['confirms', 'further', 'nuance', 'contradicts', 'open']
  const counts = order.map((status) => [status, statuses.filter((s) => s === status).length] as const).filter(([, n]) => n > 0)
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-2 p-0" aria-label="Checks by outcome">
      {counts.map(([status, n]) => (
        <li key={status} className="flex items-baseline gap-2">
          <span className={`font-serif text-[26px] font-[400] leading-none ${STATUS[status].text}`} style={OPTICAL(96)}>{n}</span>
          <span className="text-[12px] text-fg-3">{STATUS[status].label.toLowerCase()}</span>
        </li>
      ))}
    </ul>
  )
}

/** Endnotes. */
export function References({ ids, title = 'Sources' }: { ids: readonly ReferenceId[]; title?: string }) {
  const unique = [...new Set(ids)]
  if (!unique.length) return null
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-6">
      <p className="m-0 mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-3">{title}</p>
      <ol className="m-0 grid list-none gap-x-10 gap-y-2 p-0 lg:grid-cols-2">
        {unique.map((id, i) => {
          const ref: Reference = REFERENCES[id]
          return (
            <li key={id} className="flex gap-3 text-[11.5px] leading-snug text-fg-3">
              <span className="font-mono text-ember-300/70">{String(i + 1).padStart(2, '0')}</span>
              {ref.url ? (
                <a href={ref.url} target="_blank" rel="noreferrer" className="text-fg-3 no-underline hover:text-fg-2">
                  {ref.full}
                </a>
              ) : (
                <span>{ref.full}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** A chapter of findings: kicker, a title that states what was checked, the tally, the ledger, sources. */
export function EvidencePanel({ eyebrow, title, lede, checks, id, action }: { eyebrow: string; title: string; lede?: ReactNode; checks: readonly (CheckProps & { key: string })[]; id?: string; action?: ReactNode }) {
  if (!checks.length) return null
  const headingId = `${id ?? eyebrow.replace(/\W+/g, '-').toLowerCase()}-heading`
  return (
    <section id={id} className="relative min-w-0 border-t border-white/[0.07] pt-12 font-sans" aria-labelledby={headingId}>
      <div className="pointer-events-none absolute -left-24 top-0 size-80 rounded-full bg-ok/[0.035] blur-[90px]" aria-hidden="true" />
      <header className="relative mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex max-w-4xl flex-col gap-3">
          <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-ok">{eyebrow}</p>
          <h3 id={headingId} className="m-0 max-w-[30ch] font-serif text-[clamp(24px,2.5vw,34px)] font-[400] leading-[1.12] tracking-[-0.015em] text-paper" style={OPTICAL(96)}>{title}</h3>
          {lede && <p className="m-0 max-w-[64ch] font-serif text-[16.5px] font-[400] leading-[1.6] text-paper-2" style={OPTICAL(18)}>{lede}</p>}
        </div>
        <div className="flex flex-col items-start gap-4 lg:items-end">
          <Tally statuses={checks.map((c) => c.status)} />
          {action}
        </div>
      </header>
      <ol className="relative m-0 list-none p-0">
        {checks.map(({ key, ...check }) => <Check key={key} {...check} />)}
      </ol>
      <References ids={checks.flatMap((c) => c.cites ?? [])} />
    </section>
  )
}

/** Findings at the foot of a story section. */
export function ActScience({ checks, title = 'Checked against published science' }: { checks: readonly (CheckProps & { key: string })[]; title?: string }) {
  if (!checks.length) return null
  return (
    <div className="mt-10 border-t border-ok/15 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-ok">{title}</p>
        <Tally statuses={checks.map((c) => c.status)} />
      </div>
      <ol className="m-0 mt-2 list-none p-0">
        {checks.map(({ key, ...check }) => <Check key={key} {...check} compact />)}
      </ol>
      <References ids={checks.flatMap((c) => c.cites ?? [])} />
    </div>
  )
}
