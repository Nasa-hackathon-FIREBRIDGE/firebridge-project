import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, Play, ScanEye, Sparkles } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import type { SensorKey } from '../../../lib/sensors'
import { MODELS, type BridgeReport, type ModelId, type PlatformReplay } from '../engine/index.ts'
import { bandFactor, fmtInt, fmtMonth, fmtOne, sensorColor, sensorLabel } from '../format'
import { Act, Legend, LegendItem, Note, SupportBadge } from '../ui'
import type { ReplayStage } from '../BridgeCharts'

const ReplayChart = lazy(() => import('../BridgeCharts').then((m) => ({ default: m.ReplayChart })))
const EMBER = '#ff7c40'
const NEUTRAL = '#8b93a3'

const STAGES: { id: ReplayStage; label: string; icon: typeof EyeOff }[] = [
  { id: 'withheld', label: 'Withhold Aqua', icon: EyeOff },
  { id: 'predicted', label: 'Predict', icon: Sparkles },
  { id: 'revealed', label: 'Reveal Aqua', icon: ScanEye },
]

function decisionText(replay: PlatformReplay) {
  const { decision, scores } = replay
  const mae = (id: ModelId) => scores.find((s) => s.model === id)!.mae.toFixed(2)
  const interval = decision.delta ? `[${decision.delta.low >= 0 ? '+' : ''}${decision.delta.low.toFixed(2)}, ${decision.delta.high >= 0 ? '+' : ''}${decision.delta.high.toFixed(2)}]` : ''
  if (decision.reason === 'improves')
    return <>The <strong className="font-semibold text-fg">{MODELS.B2.name}</strong> is adopted. It lowers the monthly error from {mae(decision.baseline)} to {mae('B2')} cell-days, and the 90% block-bootstrap interval of the difference, {interval}, lies entirely below zero.</>
  if (decision.reason === 'not-distinguishable')
    return <>The <strong className="font-semibold text-fg">{MODELS[decision.baseline].name}</strong> is kept. The {MODELS.B2.name} scored lower ({mae('B2')} vs {mae(decision.baseline)}), but the 90% interval of the difference, {interval}, includes zero. Without clear evidence, the simpler model wins.</>
  return <>The <strong className="font-semibold text-fg">{MODELS[decision.baseline].name}</strong> is kept. The {MODELS.B2.name} did not reduce the error ({mae('B2')} vs {mae(decision.baseline)}){interval ? `; difference interval ${interval}` : ''}.</>
}

export function ReplayAct({ report, platform }: { report: BridgeReport; platform: SensorKey }) {
  const replay = report.replays.find((r) => r.platform === platform)
  const name = sensorLabel(platform)
  const reduced = useReducedMotion()
  const [stage, setStage] = useState<ReplayStage>('withheld')
  const [choice, setChoice] = useState<{ platform: SensorKey; model: ModelId } | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const model = choice?.platform === platform ? choice.model : replay?.decision.model ?? 'B0'
  const bandK = useMemo(() => (replay ? bandFactor(replay.months.map((m) => ({ predicted: m.predicted[model], actual: m.actual }))) : 0), [replay, model])

  if (!replay || replay.support === 'insufficient')
    return (
      <Act index={4} eyebrow="The withheld-satellite experiment" title={`Hide Aqua, predict it from ${name}, then reveal it`} action={replay && <SupportBadge replay={replay} />}>
        <p className="m-0 text-[13.5px] text-fg-2">The experiment cannot run for this selection.</p>
        {replay && (
          <ul className="mb-0 mt-3 flex list-disc flex-col gap-1 pl-5 text-[13px] text-fg-3">
            {replay.supportReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        <Note>Choose a longer period or a larger area in which both Aqua and {name} recorded fires. Three or more years allow independent year-by-year tests.</Note>
      </Act>
    )

  const run = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    if (reduced) return setStage('revealed')
    setStage('withheld')
    timers.current = [window.setTimeout(() => setStage('predicted'), 700), window.setTimeout(() => setStage('revealed'), 2300)]
  }
  const chosen = replay.scores.find((s) => s.model === replay.decision.model)!
  const miss = replay.largestMiss
  const blockText = replay.blockKind === 'year' ? `${replay.blocks} calendar years. Each year is predicted by models fitted only on the other ${replay.blocks - 1}.` : `${replay.blocks} calendar months. Each month is predicted by models fitted without it or its neighbouring months (a buffer against fire episodes spanning the split).`
  return (
    <Act
      index={4}
      id="withheld-experiment"
      eyebrow="The withheld-satellite experiment"
      title={`Hide Aqua. Predict it from ${name}. Reveal.`}
      lede={<>The test that makes a harmonization credible. Aqua’s record is concealed from the models, which predict Aqua-active 5 km cell-days from {name} alone. Then the real Aqua record is revealed. Blocks: {blockText}</>}
      action={<SupportBadge replay={replay} />}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" aria-label="Experiment steps">
          {STAGES.map(({ id, label, icon: Icon }, index) => {
            const active = STAGES.findIndex((s) => s.id === stage) >= index
            return (
              <li key={id} className="flex items-center gap-1.5">
                {index > 0 && <span className={`h-px w-5 ${active ? 'bg-ember-400' : 'bg-white/10'}`} aria-hidden="true" />}
                <button
                  type="button"
                  aria-pressed={stage === id}
                  onClick={() => setStage(id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${active ? 'border-ember-400/40 bg-ember-500/10 text-ember-200' : 'border-white/10 bg-transparent text-fg-2 hover:text-fg'}`}
                >
                  <Icon size={13} aria-hidden="true" />
                  {index + 1}. {label}
                </button>
              </li>
            )
          })}
        </ol>
        <button type="button" onClick={run} className="ui-button ui-button--primary">
          <Play size={14} aria-hidden="true" />
          {stage === 'withheld' ? 'Run the experiment' : 'Replay'}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Legend label="Replay chart series">
          <LegendItem color={NEUTRAL} shape="bar" label={`${name} cell-days (model input)`} />
          <LegendItem color={EMBER} shape="line" label="Predicted Aqua-equivalent" muted={stage === 'withheld'} />
          <LegendItem color={EMBER} shape="band" label="Empirical 90% error range" muted={stage === 'withheld'} />
          <LegendItem color={sensorColor('aqua')} shape="bar" label="Revealed Aqua" muted={stage !== 'revealed'} />
        </Legend>
        <div role="radiogroup" aria-label="Model shown" className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          {(['B0', 'B1', 'B2'] as ModelId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={model === id} title={MODELS[id].summary} onClick={() => setChoice({ platform, model: id })} className={`rounded-lg border-0 px-2.5 py-1 text-[12px] font-medium ${model === id ? 'bg-white/[0.08] text-fg' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
              {id}
              {replay.decision.model === id && <span className="ml-1 text-ember-300">•</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Suspense fallback={<div className="ui-skeleton h-[340px] w-full" />}>
          <ReplayChart replay={replay} model={model} stage={stage} bandK={bandK} />
        </Suspense>
        {stage === 'withheld' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 top-20 grid place-items-center">
            <p className="m-0 rounded-full border border-white/10 bg-ink-900/80 px-4 py-2 text-[13px] text-fg-2 backdrop-blur">
              <EyeOff size={14} className="mr-2 inline align-[-2px]" aria-hidden="true" />
              Aqua withheld: the models see only {name}
            </p>
          </div>
        )}
      </div>

      {stage === 'revealed' ? (
        <div className="mt-6 grid animate-fade-up gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12.5px]">
              <caption className="mb-2 text-left text-[12.5px] font-medium text-fg">Scored against the revealed Aqua record ({fmtInt(chosen.actualTotal)} cell-days in {replay.months.length} months)</caption>
              <thead>
                <tr className="text-fg-3 [&>th]:static [&>th]:bg-transparent [&>th]:font-sans [&>th]:text-[11.5px] [&>th]:normal-case [&>th]:tracking-normal [&>th]:text-fg-3">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Model</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium" title="Mean absolute error, Aqua cell-days per month">Error / month</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium" title="Mean signed error">Bias</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium" title="Pearson correlation with the revealed record">r</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Predicted total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums [&_td]:font-sans [&_td]:text-[12.5px]">
                {replay.scores.map((s) => {
                  const adopted = replay.decision.model === s.model
                  return (
                    <tr key={s.model} className={`border-t border-white/[0.05] ${adopted ? 'bg-ember-500/[0.06]' : ''}`}>
                      <th scope="row" className="py-2 pr-3 font-sans text-[12.5px] font-medium normal-case tracking-normal text-fg">
                        <span className="font-mono text-fg-3">{s.model}</span> {MODELS[s.model].name}
                        {adopted && <span className="ml-2 rounded-full bg-ember-500/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ember-200">adopted</span>}
                      </th>
                      <td className="whitespace-nowrap py-2 pr-3 text-right text-fg">{s.mae.toFixed(2)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right text-fg-2">{s.bias >= 0 ? '+' : '−'}{Math.abs(s.bias).toFixed(2)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right text-fg-2">{s.r === null ? '—' : s.r.toFixed(2)}</td>
                      <td className="whitespace-nowrap py-2 text-right text-fg-2">{fmtInt(s.predictedTotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mb-0 mt-3 text-[13px] leading-relaxed text-fg-2">{decisionText(replay)}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {miss && (
              <div className="rounded-2xl border border-warn/20 bg-warn/[0.05] p-4">
                <p className="m-0 text-[12px] font-medium text-warn">Largest miss · shown, not hidden</p>
                <p className="mb-0 mt-1.5 text-[14px] text-fg">
                  {fmtMonth(miss.month, 'long')}: predicted {fmtOne(miss.predicted[replay.decision.model])}, revealed {fmtInt(miss.actual)} Aqua cell-days.
                </p>
                <p className="mb-0 mt-1.5 text-[12.5px] leading-relaxed text-fg-3">
                  {name} recorded {fmtInt(miss.platformCellDays)} active cell-days that month. A miss this size marks conditions the calibration does not capture, such as a large episode one satellite recorded and the other did not.
                </p>
              </div>
            )}
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[12.5px] leading-relaxed text-fg-3">
              {(['B0', 'B1', 'B2'] as ModelId[]).map((id) => <li key={id}><span className="font-mono text-fg-2">{id}</span> {MODELS[id].summary}</li>)}
            </ul>
          </div>
        </div>
      ) : (
        <p className="mb-0 mt-4 text-[12.5px] text-fg-3">Scores appear when Aqua is revealed. Step 3 can be opened directly.</p>
      )}
      {replay.supportReasons.length > 0 && <Note>{replay.supportReasons.join(' ')}</Note>}
    </Act>
  )
}
