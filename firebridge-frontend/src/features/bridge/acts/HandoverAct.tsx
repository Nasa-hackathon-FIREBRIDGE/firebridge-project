import { HISTORICAL_MAX_WINDOW_DAYS } from '@firebridge/contracts/analysis-limits'
import { lazy, Suspense, useState } from 'react'
import type { SensorKey } from '../../../lib/sensors'
import { MODELS, type BridgeReport } from '../engine/index.ts'
import { fmtInt, fmtMonth, fmtOne, fmtRatio, sensorColor, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note, TABLE, Tile } from '../ui'
import { handoverCheck } from '../../science/checks'
import { alarmOutcome, defaultHandover } from '../selectors'
import { AskWhy } from '../../copilot/AskWhy'

const HandoverChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.HandoverChart })))
const EMBER = '#ff7c40'
const NEUTRAL = '#8b93a3'

const join = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

export function HandoverAct({ report, platform }: { report: BridgeReport; platform: SensorKey }) {
  const name = sensorLabel(platform)
  const rehearsals = report.handovers.filter((h) => h.platform === platform)
  const [picked, setPicked] = useState<{ report: BridgeReport; platform: SensorKey; switchMonth: string } | null>(null)
  const fallback = defaultHandover(report, platform)
  const handover = (picked?.report === report && picked.platform === platform ? rehearsals.find((h) => h.switchMonth === picked.switchMonth) : null) ?? fallback
  const title = 'The day Aqua goes dark, rehearsed'

  if (!handover)
    return (
      <Act index={5} eyebrow="Synthetic instrument switch" title={title}>
        <p className="m-0 text-[13.5px] text-fg-2">
          A rehearsal needs at least two years in which Aqua and {name} both flew, Aqua in its original overpass regime, before the switch, and six such months after it to check the continuation against. This selection does not have that overlap.
        </p>
        <Note>Request the same area from 2018 or earlier (one analysis can span up to {HISTORICAL_MAX_WINDOW_DAYS.toLocaleString('en-US')} days, about 30 years) to rehearse the handover.</Note>
      </Act>
    )

  const { scored } = handover
  const outcome = alarmOutcome(handover)
  const switchYear = handover.switchMonth.slice(0, 4)
  return (
    <Act
      index={5}
      science={report.evidence ? [handoverCheck(report, platform)] : undefined}
      id="handover-rehearsal"
      eyebrow="Synthetic instrument switch"
      title={title}
      action={<AskWhy question="What does this rehearsal mean for the fire record when MODIS stops for good?" label="What does it mean?" />}
      lede={
        <>
          MODIS will stop. Here it is switched off early, on 1 January of a year inside the overlap. Everything after is continued from {name} by a model chosen and fitted on the months before the switch only, as it will be on the real day. The months in which Aqua actually kept flying are the answer key.
        </>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
        <span>Switch Aqua off on 1 January</span>
        <div role="radiogroup" aria-label="Switch-off year" className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          {rehearsals.map((h) => {
            const year = h.switchMonth.slice(0, 4)
            return (
              <button key={h.switchMonth} type="button" role="radio" aria-checked={h === handover} onClick={() => setPicked({ report, platform, switchMonth: h.switchMonth })} className={`rounded-lg border-0 px-2.5 py-1 font-mono text-[12px] font-medium ${h === handover ? 'bg-white/[0.08] text-fg' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
                {year}
              </button>
            )
          })}
        </div>
        <span className="text-[12px] text-fg-3">· trained on {handover.training.months} months ({handover.training.years} years) · {MODELS[handover.model].name} chosen before the switch</span>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Tile label={`${name}, un-harmonized`} value={fmtRatio(scored.naive / Math.max(1, scored.actual))} sub={`its own count reads ${fmtInt(scored.naive)} active cell-days against Aqua’s ${fmtInt(scored.actual)} over ${scored.months} months`} />
        <Tile tone="ember" label="FIREBRIDGE continuation" value={fmtRatio(scored.estimate / Math.max(1, scored.actual))} sub={`${fmtOne(scored.estimate)} predicted against ${fmtInt(scored.actual)} revealed (range ${fmtOne(scored.low)}–${fmtOne(scored.high)}); ${scored.covered} of ${scored.months} months inside the error range`} />
        <Tile
          label="False alarms after the switch"
          value={`${outcome.naiveFalse.length} → ${outcome.bridgedFalse.length}`}
          sub={`months flagged unusual that Aqua itself did not flag: un-harmonized → FIREBRIDGE${handover.alarms.truth.length ? `; real alarms caught ${outcome.caught.length} of ${handover.alarms.truth.length}` : ''}`}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-medium text-fg">Monthly Aqua-active cell-days, and the months each record would flag as unusual</p>
        <Legend label="Rehearsal series">
          <LegendItem color={sensorColor('aqua')} shape="bar" label="Aqua (revealed after the switch)" />
          <LegendItem color={EMBER} shape="line" label="FIREBRIDGE" />
          <LegendItem color={EMBER} shape="band" label="Error range" />
          <LegendItem color={NEUTRAL} shape="line" label={`${name}, un-harmonized`} />
        </Legend>
      </div>
      <Suspense fallback={<div className="ui-skeleton h-[360px] w-full" />}>
        <HandoverChart handover={handover} platformLabel={name} />
      </Suspense>

      <div className="mt-5 flex flex-col gap-2 text-[13.5px] leading-relaxed text-fg-2">
        <p className="m-0">
          <strong className="font-semibold text-fg">Without harmonization, the switch itself becomes the story.</strong> Continuing the record with {name}’s own count reads {fmtRatio(scored.naive / Math.max(1, scored.actual))} the real Aqua record, and {outcome.naiveFalse.length} month{outcome.naiveFalse.length === 1 ? '' : 's'} after {switchYear} would look unusual against the years before, although Aqua itself saw nothing unusual in {outcome.naiveFalse.length === 1 ? 'it' : 'them'}.
        </p>
        <p className="m-0">
          <strong className="font-semibold text-fg">FIREBRIDGE raises {outcome.bridgedFalse.length === 0 ? 'no false alarm' : `${outcome.bridgedFalse.length} false alarm${outcome.bridgedFalse.length === 1 ? '' : 's'}`}.</strong>{' '}
          {handover.alarms.truth.length === 0
            ? 'Aqua itself flagged no month after the switch.'
            : outcome.missed.length === 0
              ? `It catches every month Aqua itself flagged (${join(outcome.caught.map((m) => fmtMonth(m, 'long')))}).`
              : `It catches ${outcome.caught.length} of the ${handover.alarms.truth.length} months Aqua itself flagged${outcome.caught.length ? ` (${join(outcome.caught.map((m) => fmtMonth(m, 'long')))})` : ''} and misses ${join(outcome.missed.map((month) => { const m = handover.months.find((x) => x.month === month)!; return `${fmtMonth(month, 'long')} (${fmtOne(m.estimate)} predicted, ${fmtInt(m.actual)} revealed)` }))}: it under-reads unusually busy months it was not trained on.`}
        </p>
      </div>

      {rehearsals.length > 1 && (
        <div className="mt-6 min-w-0 overflow-x-auto">
          <table className={TABLE}>
            <caption className="mb-2 text-left text-[12.5px] font-medium text-fg">Every rehearsal with {name}, scored on the months Aqua flew in its original regime</caption>
            <thead>
              <tr className="text-fg-3 [&>th]:static [&>th]:bg-transparent [&>th]:font-sans [&>th]:text-[11.5px] [&>th]:normal-case [&>th]:tracking-normal [&>th]:text-fg-3">
                <th scope="col" className="py-1.5 pr-3 font-medium">Switch off</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Model</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Un-harmonized</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">FIREBRIDGE</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Months in range</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">False alarms</th>
                <th scope="col" className="py-1.5 text-right font-medium">Real alarms caught</th>
              </tr>
            </thead>
            <tbody className="tabular-nums [&_td]:whitespace-nowrap [&_td]:font-sans [&_td]:text-[12.5px]">
              {rehearsals.map((h) => {
                const o = alarmOutcome(h)
                return (
                  <tr key={h.switchMonth} className={`border-t border-white/[0.05] ${h === handover ? 'bg-ember-500/[0.06]' : ''}`}>
                    <th scope="row" className="py-1.5 pr-3 font-mono text-[12px] font-medium normal-case tracking-normal text-fg">{fmtMonth(h.switchMonth)}</th>
                    <td className="py-1.5 pr-3 text-fg-2"><span className="font-mono text-fg-3">{h.model}</span> {MODELS[h.model].name}</td>
                    <td className="py-1.5 pr-3 text-right text-fg-2">{fmtRatio(h.scored.naive / Math.max(1, h.scored.actual))}</td>
                    <td className="py-1.5 pr-3 text-right text-fg">{fmtRatio(h.scored.estimate / Math.max(1, h.scored.actual))}</td>
                    <td className="py-1.5 pr-3 text-right text-fg-2">{h.scored.covered} / {h.scored.months}</td>
                    <td className="py-1.5 pr-3 text-right text-fg-2">{o.naiveFalse.length} → <span className="text-fg">{o.bridgedFalse.length}</span></td>
                    <td className="py-1.5 text-right text-fg-2">{h.alarms.truth.length ? `${o.caught.length} / ${h.alarms.truth.length}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mb-0 mt-2 text-[11.5px] text-fg-3">Ratios are the continuation’s total over the revealed Aqua total after the switch (1× is perfect). Alarms: months at least {report.anomalies.threshold} spreads above the same month in the years before the switch.</p>
        </div>
      )}
      <Note>
        Unlike the withheld-satellite experiment, no month after the switch informs the model, its choice or its error range: this is the test closest to the real retirement of MODIS. Months after Aqua’s overpass drifted are shown but never scored, because a drifted Aqua is no longer the reference.
      </Note>
    </Act>
  )
}
