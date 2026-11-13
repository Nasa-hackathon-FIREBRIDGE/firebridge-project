import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * Night Edition: the analysis pages read like a science feature at night, not a dashboard.
 * No boxes. Structure comes from type, space, hairlines and light. Headlines are findings, written
 * as sentences in a serif; evidence and sources live in the margin, as in a paper.
 */

const OPTICAL = (size: number): CSSProperties => ({ fontVariationSettings: `"opsz" ${size}` })

/** Small running line above a headline: section, place, period. */
export function Masthead({ children, tone = 'ember' }: { children: ReactNode; tone?: 'ember' | 'muted' }) {
  return (
    <p className={`m-0 flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.2em] ${tone === 'ember' ? 'text-ember-300' : 'text-fg-3'}`}>
      <span className="h-px w-8 bg-current opacity-60" aria-hidden="true" />
      {children}
    </p>
  )
}

/** The page's answer, as a sentence. */
export function Headline({ children, id, as: Tag = 'h2', size = 'xl' }: { children: ReactNode; id?: string; as?: 'h2' | 'h3'; size?: 'xl' | 'lg' }) {
  return (
    <Tag
      id={id}
      className={`m-0 max-w-[22ch] font-serif font-[480] tracking-[-0.032em] text-paper ${size === 'xl' ? 'text-[clamp(34px,4.6vw,62px)] leading-[1.02]' : 'text-[clamp(26px,3vw,40px)] leading-[1.08]'}`}
      style={OPTICAL(144)}
    >
      {children}
    </Tag>
  )
}

/** The paragraph under the headline that tells the reader what they are about to see. */
export function Standfirst({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[60ch] font-serif text-[clamp(17px,1.5vw,20px)] font-[400] leading-[1.55] text-paper-2 [&_p]:m-0 [&_p]:[font:inherit] [&_p]:[color:inherit] [&_strong]:font-[600] [&_strong]:text-paper" style={OPTICAL(24)}>
      {children}
    </div>
  )
}

/** Opening of a page: masthead, headline, standfirst and an optional byline. */
export function Opening({ masthead, headline, headlineId, standfirst, byline, children }: { masthead: ReactNode; headline: ReactNode; headlineId?: string; standfirst?: ReactNode; byline?: ReactNode; children?: ReactNode }) {
  return (
    <header className="relative flex flex-col gap-6 pb-4 pt-6 sm:pt-10">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-ember-500/[0.07] blur-[100px]" aria-hidden="true" />
      <Masthead>{masthead}</Masthead>
      <Headline id={headlineId}>{headline}</Headline>
      {standfirst && <Standfirst>{standfirst}</Standfirst>}
      {byline && <p className="m-0 font-mono text-[11px] tracking-[0.04em] text-fg-3">{byline}</p>}
      {children}
    </header>
  )
}

/** A numbered chapter: outlined numeral, kicker and a title that states the finding. */
export function Chapter({ n, kicker, title, children, id, aside }: { n?: number; kicker: string; title: ReactNode; children: ReactNode; id?: string; aside?: ReactNode }) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section id={id} className="relative grid gap-x-10 gap-y-6 border-t border-white/[0.07] pt-12 lg:grid-cols-[96px_minmax(0,1fr)]" aria-labelledby={headingId}>
      <div className="hidden lg:block">
        {n !== undefined && (
          <span className="block font-serif text-[76px] font-[420] italic leading-[0.8] text-transparent [-webkit-text-stroke:1px_rgba(255,160,112,0.55)]" style={OPTICAL(144)} aria-hidden="true">
            {n}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex max-w-4xl flex-col gap-3">
            <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-fg-3">
              {n !== undefined && <span className="mr-2 text-ember-300 lg:hidden">{String(n).padStart(2, '0')}</span>}
              {kicker}
            </p>
            <h3 id={headingId} className="m-0 max-w-[30ch] font-serif text-[clamp(24px,2.5vw,34px)] font-[400] leading-[1.12] tracking-[-0.015em] text-paper" style={OPTICAL(96)}>
              {title}
            </h3>
          </div>
          {aside}
        </div>
        {children}
      </div>
    </section>
  )
}

/** Body text beside a margin of notes; the margin folds under the text on small screens. */
export function Prose({ children, notes, stacked = false }: { children: ReactNode; notes?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`grid gap-x-12 gap-y-5 ${stacked ? '' : 'xl:grid-cols-[minmax(0,62ch)_minmax(220px,300px)]'}`}>
      <div className="flex max-w-[62ch] flex-col gap-4 font-serif text-[16.5px] font-[400] leading-[1.7] text-paper-2 [&_p]:m-0 [&_p]:[font:inherit] [&_p]:[color:inherit] [&_strong]:font-[600] [&_strong]:text-paper" style={OPTICAL(18)}>
        {children}
      </div>
      {notes && <aside className="flex flex-col gap-4 border-l border-white/[0.07] pl-5 text-[12.5px] leading-relaxed text-fg-3 xl:pt-1">{notes}</aside>}
    </div>
  )
}

/** One margin note. */
export function Sidenote({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="[&_strong]:font-semibold [&_strong]:text-fg-2">
      {label && <p className="m-0 mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ember-300/80">{label}</p>}
      <div>{children}</div>
    </div>
  )
}

/** A row of big figures separated by hairlines. */
export function Figures({ items, label }: { items: { label: string; value: ReactNode; note?: ReactNode }[]; label?: string }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-8 border-y border-white/[0.07] py-7 lg:grid-cols-4" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1 lg:border-l lg:border-white/[0.07] lg:pl-6 lg:first:border-l-0 lg:first:pl-0">
          <dt className="order-2 m-0 mt-2 text-[12.5px] font-medium leading-snug text-fg-2">{item.label}</dt>
          <dd className="order-1 m-0 font-serif text-[clamp(30px,3.4vw,46px)] font-[420] leading-none tracking-[-0.028em] text-paper tabular-nums" style={OPTICAL(144)}>
            {item.value}
          </dd>
          {item.note && <dd className="order-3 m-0 text-[12.5px] leading-snug text-fg-3">{item.note}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** A figure: the visual, then a caption set as a reading aid. */
export function Figure({ children, caption, label }: { children: ReactNode; caption?: ReactNode; label?: string }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3" aria-label={label}>
      {children}
      {caption && <figcaption className="max-w-[80ch] font-serif text-[14px] italic leading-relaxed text-fg-3" style={OPTICAL(14)}>{caption}</figcaption>}
    </figure>
  )
}

/** Quiet text action: an arrow link that is a button. */
export function TextAction({ children, onClick, primary = false, label }: { children: ReactNode; onClick: () => void; primary?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors ${primary ? 'border-ember-400/40 bg-ember-500/15 text-ember-100 hover:bg-ember-500/25' : 'border-white/[0.1] bg-transparent text-fg-2 hover:border-white/25 hover:text-fg'}`}
    >
      {children}
      <span className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
    </button>
  )
}

/**
 * Scroll-driven story: a sticky graphic beside steps of text. The graphic receives the index of
 * the step in view. Without IntersectionObserver (or on small screens) it simply stacks.
 */
export function Scrolly({ steps, graphic, onStep }: { steps: { key: string; content: ReactNode }[]; graphic: (active: number) => ReactNode; onStep?: (active: number) => void }) {
  const [active, setActive] = useState(0)
  useEffect(() => {
    onStep?.(active)
  }, [active, onStep])
  const refs = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step))
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    refs.current.forEach((node) => node && observer.observe(node))
    return () => observer.disconnect()
  }, [steps.length])
  return (
    <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.8fr)]">
      <div className="min-w-0 xl:order-1">
        <div className="xl:sticky xl:top-28">{graphic(active)}</div>
      </div>
      <ol className="m-0 flex list-none flex-col gap-6 p-0 xl:order-2 xl:gap-0 xl:pb-[30vh]">
        {steps.map((step, index) => (
          <li key={step.key}>
            <div
              ref={(node) => {
                refs.current[index] = node
              }}
              data-step={index}
              className={`flex flex-col justify-center transition-opacity duration-500 xl:min-h-[62vh] ${index === active ? 'opacity-100' : 'xl:opacity-35'}`}
            >
              <div className="font-serif text-[17px] font-[400] leading-[1.65] text-paper-2 [&_p]:m-0 [&_p]:[font:inherit] [&_p]:[color:inherit] [&_strong]:font-[600] [&_strong]:text-paper" style={OPTICAL(18)}>
                <span className="mb-3 block font-mono text-[10.5px] uppercase tracking-[0.2em] text-ember-300">{String(index + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
                {step.content}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Page wrapper: generous measure, no card. */
export function Story({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <article className="relative flex flex-col gap-16 pb-10 font-sans" aria-labelledby={labelledBy}>
      {children}
    </article>
  )
}
