import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react'
import type { SensorKey } from '../../lib/sensors'
import type { PlatformReplay } from './engine/index.ts'
import { sensorColor, sensorLabel } from './format'

/** One numbered act of the bridge narrative. */
export function Act({ index, eyebrow, title, lede, action, children, id }: { index: number; eyebrow: string; title: string; lede?: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = `bridge-act-${index}`
  return (
    <section id={id} className="card min-w-0 animate-fade-up p-5 sm:p-7" aria-labelledby={headingId}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 max-w-3xl gap-4">
          <span className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-ember-300" aria-hidden="true">
            {String(index).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">{eyebrow}</p>
            <h3 id={headingId} className="m-0 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-fg">{title}</h3>
            {lede && <p className="mb-0 mt-2 text-[13.5px] leading-relaxed text-fg-2">{lede}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Hero/stat tile: label, value (proportional figures), supporting line. */
export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ember' }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      {tone === 'ember' && <span className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #ff7c40, transparent)' }} aria-hidden="true" />}
      <p className="m-0 text-[12px] font-medium text-fg-3">{label}</p>
      <p className="mb-0 mt-2 text-[26px] font-semibold leading-none tracking-tight text-fg">{value}</p>
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
  return <p className="mb-0 mt-4 border-l-2 border-white/10 pl-3 text-[12.5px] leading-relaxed text-fg-3">{children}</p>
}
