import type { ReactNode } from 'react'
import { ArrowUpRight, PowerOff, Scale, Sparkles, TriangleAlert } from 'lucide-react'
import { Masthead, TextAction } from '../story/Story'
import { useCopilot } from '../copilot/context'
import { attention, calendarMonthName } from './calendar'
import { fmtCount, fmtMonth, fmtOne, sensorLabel } from './format'
import { alarmOutcome, defaultHandover, defaultPlatform } from './selectors'
import { BridgeProgress } from './BridgePanel'
import { useBridgeReport } from './useBridgeReport'

const join = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/** One paragraph of the front page: a small mark in the margin, the finding in serif. */
function Finding({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4">
      <span className={`mt-1.5 ${tone}`} aria-hidden="true">{icon}</span>
      <p className="m-0 font-serif text-[17px] font-[400] leading-[1.62] text-paper-2 [&_strong]:font-[560] [&_strong]:text-paper" style={{ fontVariationSettings: '"opsz" 18' }}>{children}</p>
    </li>
  )
}

/** Overview card: the findings of the calendar and the bridge in plain sentences. */
export function VerdictCard({ analysisId, onOpenCalendar, onOpenBridge }: { analysisId?: string; onOpenCalendar?: () => void; onOpenBridge?: () => void }) {
  const state = useBridgeReport(analysisId)
  const copilot = useCopilot()
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
    <section className="relative flex flex-col gap-8 pt-6 font-sans sm:pt-10" aria-labelledby="verdict-heading">
      <div className="pointer-events-none absolute -left-48 -top-48 size-[620px] rounded-full bg-ember-500/[0.08] blur-[110px]" aria-hidden="true" />
      <Masthead>The briefing · {fmtMonth(report.meta.start.slice(0, 7), 'short')} – {fmtMonth(new Date(Date.parse(`${report.meta.endExclusive.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7), 'short')}</Masthead>
      <h2 id="verdict-heading" className="relative m-0 max-w-[21ch] font-serif text-[clamp(34px,4.8vw,66px)] font-[480] leading-[1.02] tracking-[-0.034em] text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>{headline}</h2>
      <ul className="relative m-0 grid max-w-6xl list-none gap-x-14 gap-y-5 p-0 lg:grid-cols-2">
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
      <div className="relative flex flex-wrap gap-3">
        {copilot && copilot.available !== false && (
          <TextAction primary onClick={copilot.brief}>
            <Sparkles size={15} aria-hidden="true" />
            Brief me
          </TextAction>
        )}
        {onOpenCalendar && <TextAction onClick={onOpenCalendar}>Open the fire calendar</TextAction>}
        {onOpenBridge && <TextAction onClick={onOpenBridge} label="How the satellites were bridged">How the satellites were bridged</TextAction>}
      </div>
    </section>
  )
}
