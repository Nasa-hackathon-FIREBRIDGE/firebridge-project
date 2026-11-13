import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react'
import type { SensorKey } from '../../lib/sensors'
import type { PlatformReplay } from './engine/index.ts'
import { ActScience } from '../science/Evidence'
import type { CheckSpec } from '../science/checks'
import { sensorColor, sensorLabel } from './format'

/** One numbered act of the bridge narrative. */
/** Tables in the lab. The legacy workspace CSS lets cells break anywhere (`.fb-workspace th, td`), which makes a squeezed table collapse a
 *  column to one letter per line ("J-a-n-2-0-2-2"). Here words break only at spaces or hyphens, row
 *  labels never break, and a table that still does not fit scrolls sideways inside its wrapper. */
export const TABLE = 'w-full border-collapse text-left text-[12.5px] [&_td]:break-normal [&_th]:break-normal [&_tbody_th]:whitespace-nowrap'

export function Act({ index, eyebrow, title, lede, action, children, id, science }: { index: number; eyebrow: string; title: string; lede?: ReactNode; action?: ReactNode; children: ReactNode; id?: string; science?: readonly (CheckSpec | null)[] }) {
  const headingId = `bridge-act-${index}`
  return (
    <section id={id} className="relative grid min-w-0 animate-fade-up gap-x-10 lg:grid-cols-[72px_minmax(0,1fr)]" aria-labelledby={headingId}>
      {/* The lab's rail: one experiment leads to the next. */}
      <div className="relative hidden lg:block" aria-hidden="true">
        <span className="absolute bottom-0 left-1/2 top-14 w-px -translate-x-1/2 bg-gradient-to-b from-ember-400/45 via-white/[0.08] to-white/[0.03]" />
        <span className="relative z-10 mx-auto grid size-14 place-items-center rounded-full border border-ember-400/40 bg-ink-950 font-serif text-[24px] font-[480] italic text-ember-200 shadow-[0_0_32px_-6px_rgba(255,124,64,0.6)]" style={{ fontVariationSettings: '"opsz" 96' }}>
          {index}
        </span>
      </div>
      <div className="min-w-0 pb-20">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 max-w-4xl flex-col gap-3">
            <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-fg-3">
              <span className="mr-2 text-ember-300 lg:hidden">{String(index).padStart(2, '0')}</span>
              {eyebrow}
            </p>
            <h3 id={headingId} className="m-0 max-w-[28ch] font-serif text-[clamp(25px,2.6vw,36px)] font-[400] leading-[1.1] tracking-[-0.015em] text-paper" style={{ fontVariationSettings: '"opsz" 96' }}>{title}</h3>
            {lede && <p className="m-0 max-w-[64ch] font-serif text-[16.5px] font-[400] leading-[1.62] text-paper-2 [&_strong]:font-[560] [&_strong]:text-paper" style={{ fontVariationSettings: '"opsz" 18' }}>{lede}</p>}
          </div>
          {action}
        </header>
        {children}
        {science && <ActScience checks={science.filter((c): c is CheckSpec => c !== null)} />}
      </div>
    </section>
  )
}

/** Hero/stat tile: label, value (proportional figures), supporting line. */
export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ember' }) {
  return (
    <div className={`relative min-w-0 border-l pl-5 ${tone === 'ember' ? 'border-ember-400/60' : 'border-white/[0.08]'}`}>
      <p className="m-0 text-[12px] font-medium text-fg-3">{label}</p>
      <p className="mb-0 mt-2 font-serif text-[clamp(28px,2.6vw,38px)] font-[420] leading-none tracking-[-0.028em] text-paper tabular-nums" style={{ fontVariationSettings: '"opsz" 144' }}>{value}</p>
      {sub && <p className="mb-0 mt-2 text-[12px] leading-snug text-fg-2">{sub}</p>}
    </div>
  )
}

export function SensorDot({ sensor, size = 8 }: { sensor: SensorKey; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: sensorColor(sensor) }} aria-hidden="true" />
}

/** Legend entry: colored mark beside text (text never wears the series color). */
export function LegendItem({ color, label, shape = 'dot', muted }: { color: string; label: ReactNode; shape?: 'dot' | 'line' | 'bar' | 'band'; muted?: boolean }) {
  const mark =
    shape === 'line' ? <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: color }} />
    : shape === 'bar' ? <span className="inline-block h-2.5 w-2 rounded-[2px]" style={{ background: color }} />
    : shape === 'band' ? <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: color, opacity: 0.25 }} />
    : <span className="inline-block size-2 rounded-full" style={{ background: color }} />
  return (
    <li className={`flex items-center gap-1.5 text-[11.5px] ${muted ? 'text-fg-3' : 'text-fg-2'}`}>
      <span className="inline-flex items-center" aria-hidden="true">{mark}</span>
      {label}
    </li>
  )
}

export function Legend({ children, label }: { children: ReactNode; label: string }) {
  return <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0" aria-label={label}>{children}</ul>
}

/** Segmented choice between VIIRS platforms (radio semantics). */
export function PlatformPicker({ platforms, value, onChange, label = 'VIIRS platform' }: { platforms: SensorKey[]; value: SensorKey; onChange: (value: SensorKey) => void; label?: string }) {
  if (platforms.length < 2) return null
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
      {platforms.map((platform) => (
        <button
          key={platform}
          type="button"
          role="radio"
          aria-checked={value === platform}
          onClick={() => onChange(platform)}
          className={`inline-flex items-center gap-1.5 rounded-lg border-0 px-3 py-1.5 text-[12.5px] font-medium transition-colors ${value === platform ? 'bg-white/[0.08] text-fg' : 'bg-transparent text-fg-2 hover:text-fg'}`}
        >
          <SensorDot sensor={platform} />
          {sensorLabel(platform)}
        </button>
      ))}
    </div>
  )
}

export function SupportBadge({ replay }: { replay: Pick<PlatformReplay, 'support' | 'supportReasons'> }) {
  const tone =
    replay.support === 'supported' ? { icon: <CheckCircle2 size={13} />, text: 'Supported', cls: 'border-ok/25 bg-ok/10 text-ok' }
    : replay.support === 'limited' ? { icon: <AlertTriangle size={13} />, text: 'Limited support', cls: 'border-warn/25 bg-warn/10 text-warn' }
    : { icon: <CircleSlash size={13} />, text: 'Insufficient data', cls: 'border-white/10 bg-white/[0.04] text-fg-2' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${tone.cls}`} title={replay.supportReasons.join(' ') || undefined}>
      <span aria-hidden="true">{tone.icon}</span>
      {tone.text}
    </span>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mb-0 mt-5 max-w-[80ch] border-l border-white/10 pl-4 font-serif text-[14px] italic leading-relaxed text-fg-3" style={{ fontVariationSettings: '"opsz" 14' }}>{children}</p>
}
