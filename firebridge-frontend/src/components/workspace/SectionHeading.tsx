import type { ReactNode } from 'react'

/**
 * Page heading. The analysis pages use the editorial opening (masthead, large headline, standfirst);
 * the map card keeps its compact heading.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  variant = 'editorial',
}: {
  id: string
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  variant?: 'editorial' | 'compact'
}) {
  if (variant === 'compact')
    return (
      <div className="fb-section-heading ui-section-heading">
        <div>
          {eyebrow && <span className="fb-eyebrow">{eyebrow}</span>}
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="fb-section-action">{action}</div>}
      </div>
    )
  return (
    <div className="relative mb-6 flex flex-wrap items-end justify-between gap-6 pt-4 font-sans sm:pt-8">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[460px] rounded-full bg-ember-500/[0.06] blur-[100px]" aria-hidden="true" />
      <div className="relative flex max-w-4xl flex-col gap-4">
        {eyebrow && (
          <p className="m-0 flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-ember-300">
            <span className="h-px w-8 bg-current opacity-60" aria-hidden="true" />
            {eyebrow.toLowerCase()}
          </p>
        )}
        <h2 id={id} className="m-0 max-w-[22ch] font-serif text-[clamp(30px,3.8vw,50px)] font-[480] leading-[1.04] tracking-[-0.03em] text-paper">
          {title}
        </h2>
        {description && <p className="m-0 max-w-[62ch] text-[clamp(16px,1.3vw,18px)] leading-[1.6] text-paper-2">{description}</p>}
      </div>
      {action && <div className="relative">{action}</div>}
    </div>
  )
}
