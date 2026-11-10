import type { ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, PowerOff, Scale, TriangleAlert } from 'lucide-react'
import { attention, calendarMonthName } from './calendar'
import { fmtCount, fmtMonth, fmtOne, sensorLabel } from './format'
import { alarmOutcome, defaultHandover, defaultPlatform } from './selectors'
import { BridgeProgress } from './BridgePanel'
import { useBridgeReport } from './useBridgeReport'

const join = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

function Finding({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.04] ${tone}`} aria-hidden="true">{icon}</span>
      <p className="m-0 text-[13.5px] leading-relaxed text-fg-2">{children}</p>
    </li>
  )
}

/** Overview card: the findings of the calendar and the bridge in plain sentences. */
export function VerdictCard({ analysisId, onOpenCalendar, onOpenBridge }: { analysisId?: string; onOpenCalendar?: () => void; onOpenBridge?: () => void }) {
  const state = useBridgeReport(analysisId)
  if (state.status === 'loading') return <BridgeProgress state={state} />
  if (state.status !== 'ready') return null
  const { report } = state
  const { unusual, disputed, artifacts } = attention(report)
  const judged = report.anomalies.months.some((a) => a.harmonized || (a.consensus?.n ?? 0) >= 2)
  const top = unusual.find((a) => a.kind === 'unusual-high') ?? unusual[0]
  const dispute = disputed.find((a) => a.outlier) ?? disputed[0]
  const platform = defaultPlatform(report)
  const handover = platform ? defaultHandover(report, platform) : null
  const outcome = handover ? alarmOutcome(handover) : null
  const n = top?.consensus?.n ?? 0
  const agreeing = top?.consensus?.agreeing ?? 0
  const headline = !judged
    ? 'This record is too short to judge unusual months yet.'
    : top
      ? `${fmtMonth(top.month, 'long')} was the most unusual month in this record${n && agreeing === n ? (n === 2 ? ', and both satellites agree' : `, and all ${n} satellites agree`) : n ? `, backed by ${agreeing} of ${n} satellites` : ''}.`
      : 'No month stands out once the satellites are compared fairly.'
  if (!judged && !outcome && !artifacts.length) return null
  return (
    <section className="card relative overflow-hidden p-5 font-sans sm:p-6" aria-labelledby="verdict-heading">
      <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-ember-500/10 blur-3xl" aria-hidden="true" />
      <p className="relative m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ember-300">FIREBRIDGE verdict</p>
      <h3 id="verdict-heading" className="relative m-0 max-w-3xl text-[19px] font-semibold leading-snug tracking-[-0.01em] text-fg">{headline}</h3>
      <ul className="relative m-0 mt-4 grid list-none gap-3 p-0 lg:grid-cols-2">
        {top?.harmonized && (
          <Finding icon={<ArrowUpRight size={15} />} tone="text-ember-300">
            <strong className="font-semibold text-fg">{fmtMonth(top.month, 'long')}:</strong> {fmtCount(top.harmonized.value)} Aqua-equivalent fire cell-days against a usual {calendarMonthName(top.month)} of {fmtOne(top.harmonized.usual)}. Each satellite was compared only with its own past, so the agreement is not an artifact of mixing sensors.
          </Finding>
        )}
        {dispute && (
          <Finding icon={<Scale size={15} />} tone="text-warn">
            <strong className="font-semibold text-fg">{fmtMonth(dispute.month, 'long')} is disputed.</strong>{' '}
            {dispute.outlier
              ? `${sensorLabel(dispute.outlier)} alone recorded an unusually ${(dispute.harmonized?.z ?? 0) < 0 ? 'quiet' : 'busy'} month; ${join(dispute.witnesses.filter((w) => w.state === 'scored' && w.sensor !== dispute.outlier).map((w) => sensorLabel(w.sensor)))} did not. The reference itself can miss a fire.`
              : 'The harmonized record stands out but the satellites do not confirm it.'}
          </Finding>
        )}
        {artifacts.length > 0 && (
          <Finding icon={<TriangleAlert size={15} />} tone="text-fg-2">
            <strong className="font-semibold text-fg">{artifacts.length} raw-total false alarm{artifacts.length === 1 ? '' : 's'} avoided</strong> ({artifacts.map((a) => fmtMonth(a.month, 'short')).slice(0, 4).join(', ')}{artifacts.length > 4 ? '…' : ''}). Summed over all satellites, these months look extreme because a record ends or the fleet changes, not because burning did.
          </Finding>
        )}
        {handover && outcome && (
          <Finding icon={<PowerOff size={15} />} tone="text-ember-300">
            <strong className="font-semibold text-fg">If Aqua had gone dark on 1 January {handover.switchMonth.slice(0, 4)}</strong>, continuing with {sensorLabel(handover.platform)}’s own count would have raised {outcome.naiveFalse.length} false alarm{outcome.naiveFalse.length === 1 ? '' : 's'} in the following months. FIREBRIDGE raises {outcome.bridgedFalse.length}{handover.alarms.truth.length ? ` and catches ${outcome.caught.length} of the ${handover.alarms.truth.length} real ones` : ''}.
          </Finding>
        )}
      </ul>
      <div className="relative mt-5 flex flex-wrap gap-2">
        {onOpenCalendar && (
          <button type="button" className="ui-button ui-button--primary" onClick={onOpenCalendar}>
            Open the fire calendar
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        )}
        {onOpenBridge && (
          <button type="button" className="ui-button" onClick={onOpenBridge}>
            How the satellites were bridged
          </button>
        )}
      </div>
    </section>
  )
}
