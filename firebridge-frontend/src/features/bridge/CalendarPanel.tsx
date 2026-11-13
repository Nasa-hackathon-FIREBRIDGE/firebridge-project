import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarSearch, CircleSlash, Flame, MapPinned, Scale, SearchCheck, TriangleAlert } from 'lucide-react'
import { SENSORS } from '../../lib/sensors'
import { Banner } from '../../components/ui/Banner'
import { ApiError } from '../analyses/Feedback'
import type { BridgeReport, Consensus, MonthAnomaly, Robustness, Witness } from './engine/index.ts'
import { attention, calendarMonthName, featuredMonth, largestEpisode, verdict, type Tone } from './calendar'
import { fmtCount, fmtDate, fmtInt, fmtMonth, fmtOne, sensorLabel } from './format'
import { BridgeProgress } from './BridgePanel'
import { FireSeasons, type SeasonMode } from './FireSeasons'
import { MAX_BRIDGE_DETECTIONS, useBridgeReport } from './useBridgeReport'
import { Note, SensorDot } from './ui'
import { Figures, Masthead, Scrolly, Standfirst } from '../story/Story'
import { AskWhy } from '../copilot/AskWhy'
import { useCopilot } from '../copilot/context'
import { EvidencePanel } from '../science/Evidence'
import { confirmationCheck, falseAlarmCheck, hotterCheck, robustnessCheck, seasonCheck, weatherCheck } from '../science/checks'
import { DRY, HOT, WET, useWeatherEvidence, type WeatherAnomaly } from '../science/weather'

const TONE_TEXT: Record<Tone, string> = { high: 'text-ember-200', low: 'text-info', disputed: 'text-warn', artifact: 'text-fg-2', none: 'text-fg', empty: 'text-fg-3' }
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
const fmtZ = (z: number) => `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`
const fmtTimes = (value: number) => `${value >= 10 ? Math.round(value) : value.toFixed(1)}×`
/** A ratio is only meaningful against a usual of a few cell-days; below that, show the values. */
const ratio = (value: number, usual: number | undefined | null) => (usual != null && usual >= 2 ? value / usual : null)

function ToneIcon({ tone, size = 15 }: { tone: Tone; size?: number }) {
  if (tone === 'high') return <ArrowUpRight size={size} aria-hidden="true" />
  if (tone === 'low') return <ArrowDownRight size={size} aria-hidden="true" />
  if (tone === 'disputed') return <Scale size={size} aria-hidden="true" />
  if (tone === 'artifact') return <TriangleAlert size={size} aria-hidden="true" />
  if (tone === 'empty') return <CircleSlash size={size} aria-hidden="true" />
  return <SearchCheck size={size} aria-hidden="true" />
}

/** The calendar's answer in one sentence, and the four figures behind it. */
function useVerdict(report: BridgeReport) {
  const { unusual, disputed, artifacts } = attention(report)
  const judged = report.anomalies.months.filter((a) => a.harmonized || (a.consensus?.n ?? 0) >= 2).length
  const top = unusual[0]
  const times = top?.harmonized ? ratio(top.harmonized.value, top.harmonized.usual) : null
  const versus = top?.harmonized ? (times ? `${fmtTimes(times)} a usual ${calendarMonthName(top.month)}` : `${fmtCount(top.harmonized.value)} Aqua-equivalent cell-days against a usual ${fmtOne(top.harmonized.usual)}`) : null
  const sentence = !judged
    ? 'Not enough years are on record to call any month unusual yet; the seasons below show the harmonized record.'
    : top
      ? `${fmtMonth(top.month, 'long')} stands out most${versus ? `: ${versus}` : ''}, and ${top.consensus ? `${top.consensus.agreeing} of ${top.consensus.n} satellites agree` : 'the record agrees'}.`
      : 'No month leaves its usual range once each satellite is compared with its own past.'
  const figures = [
    { label: 'Most unusual month', value: top ? fmtMonth(top.month, 'short') : '—', note: top?.harmonized ? `${fmtCount(top.harmonized.value)} Aqua-equivalent cell-days against a usual ${fmtOne(top.harmonized.usual)}` : judged ? 'Nothing stands out on the evidence' : 'Needs five or more years of record' },
    { label: 'Unusual months', value: judged ? fmtInt(unusual.length) : '—', note: judged ? `of ${fmtInt(judged)} months judged, each backed by independent satellites` : 'Nothing judged yet' },
    { label: 'Disputed', value: judged ? fmtInt(disputed.length) : '—', note: disputed[0] ? `${fmtMonth(disputed[0].month, 'short')}: ${disputed[0].outlier ? `${sensorLabel(disputed[0].outlier)} contradicts the others` : 'not confirmed'}` : 'The satellites never contradict the record' },
    { label: 'Raw-total false alarms avoided', value: fmtInt(artifacts.length), note: artifacts.length ? `${artifacts.map((a) => fmtMonth(a.month, 'short')).slice(0, 3).join(', ')}${artifacts.length > 3 ? '…' : ''}: the record changed, not the fire` : 'Raw totals raise no extra alarm here' },
  ]
  return { sentence, figures, judged, unusual, disputed, artifacts }
}

/** Each satellite's verdict on one axis: how far from its own usual this month sits. */
function JuryStrip({ witnesses, threshold }: { witnesses: Witness[]; threshold: number }) {
  const shown = witnesses.filter((w) => w.score)
  const pos = (z: number) => 50 + (Math.max(-4, Math.min(4, z)) / 4) * 46
  const placed = shown
    .map((w) => ({ w, x: pos(w.score!.z) }))
    .sort((a, b) => a.x - b.x)
    .map((item, i, all) => ({ ...item, lane: all.slice(0, i).filter((o) => Math.abs(o.x - item.x) < 5).length }))
  return (
    <div>
      <div className="relative h-14 overflow-hidden rounded-xl bg-white/[0.02]" role="img" aria-label={shown.map((w) => `${sensorLabel(w.sensor)} ${fmtZ(w.score!.z)} spreads${w.state === 'scored' ? '' : ', not counted'}`).join('; ') || 'No satellite can testify'}>
        <span className="absolute inset-y-0 left-0 bg-gradient-to-r from-info/[0.14] to-transparent" style={{ width: `${pos(-threshold)}%` }} aria-hidden="true" />
        <span className="absolute inset-y-0 right-0 bg-gradient-to-l from-ember-500/[0.18] to-transparent" style={{ width: `${100 - pos(threshold)}%` }} aria-hidden="true" />
        <span className="absolute inset-y-2 left-1/2 w-px bg-white/25" aria-hidden="true" />
        {[-threshold, threshold].map((t) => <span key={t} className="absolute inset-y-3 w-px border-l border-dashed border-white/15" style={{ left: `${pos(t)}%` }} aria-hidden="true" />)}
        {placed.map(({ w, x, lane }) => (
          <span
            key={w.sensor}
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-[left] duration-500"
            style={{
              left: `${x}%`,
              top: `${50 + (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 26 * (lane ? 1 : 0)}%`,
              background: w.state === 'scored' ? SENSORS[w.sensor].color : 'transparent',
              borderColor: SENSORS[w.sensor].color,
              boxShadow: w.state === 'scored' ? `0 0 12px ${SENSORS[w.sensor].color}aa` : undefined,
            }}
            title={`${sensorLabel(w.sensor)}: ${fmtZ(w.score!.z)} spreads${w.state === 'scored' ? '' : ' (not counted)'}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-fg-3" aria-hidden="true">
        <span>quieter</span>
        <span>usual</span>
        <span>busier</span>
      </div>
    </div>
  )
}

/** A satellite on the stand: its own words, its own past. */
function Testimony({ witness, monthName }: { witness: Witness; monthName: string }) {
  const meta = SENSORS[witness.sensor]
  const z = witness.score?.z ?? null
  const words = witness.state === 'drifted'
    ? `I flew a drifted pass this year, so I do not vote${witness.score ? `: ${fmtInt(witness.score.value)} fire cell-days against my usual ${fmtOne(witness.score.usual)}` : ''}.`
    : witness.state === 'no-record'
      ? 'I have no record this month.'
      : witness.state === 'too-new'
        ? `I have too few ${monthName}s on record to judge.`
        : `${fmtInt(witness.score!.value)} fire cell-days; my usual ${monthName} is ${fmtOne(witness.score!.usual)}.`
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-t border-white/[0.06] py-3 first:border-t-0 ${witness.state === 'scored' ? '' : 'opacity-60'}`}>
      <blockquote className="m-0 min-w-0">
        <p className="m-0 font-serif text-[17px] font-[480] italic leading-snug text-paper" style={{ fontVariationSettings: '"opsz" 24' }}>“{words}”</p>
        <footer className="mt-1 flex items-center gap-2 text-[12px] text-fg-3">
          <SensorDot sensor={witness.sensor} />
          <span className="text-fg-2">{meta.label}</span> · {meta.instrument} · {meta.pixel}
        </footer>
      </blockquote>
      {z !== null && <span className={`font-serif text-[22px] font-[400] tabular-nums ${witness.state !== 'scored' ? 'text-fg-3' : z >= 0 ? 'text-ember-200' : 'text-info'}`} style={{ fontVariationSettings: '"opsz" 48' }}>{fmtZ(z)}</span>}
    </li>
  )
}

/** Second opinions on the same month from quantities the jury did not use. */
function IndependentChecks({ report, anomaly, month }: { report: BridgeReport; anomaly: MonthAnomaly | undefined; month: string }) {
  const e = report.evidence?.months.find((m) => m.month === month)
  if (!e || (!e.energy && !e.extent && !e.detections)) return null
  const direction = anomaly?.kind === 'unusual-high' ? 1 : anomaly?.kind === 'unusual-low' ? -1 : 0
  const threshold = report.anomalies.threshold
  const row = (label: string, c: Consensus | null, unit: ReactNode) => {
    if (!c) return null
    const agrees = direction !== 0 && Math.abs(c.z) >= 1 && Math.sign(c.z) === direction
    const stands = direction === 0 && Math.abs(c.z) >= threshold && c.agreeing >= 2
    const tone = agrees ? 'text-ok' : stands ? 'text-ember-300' : direction ? 'text-fg-3' : 'text-fg-3'
    const word = agrees ? 'confirms' : stands ? (c.z > 0 ? 'stands out: higher' : 'stands out: lower') : direction ? 'does not follow' : 'within usual'
    return (
      <li className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
        <span className="min-w-0 text-fg-2">
          <span className="text-fg">{label}</span> · {unit}
        </span>
        <span className="shrink-0 text-right">
          <span className="font-mono tabular-nums text-fg">{fmtZ(c.z)}</span>
          <span className={`ml-2 text-[11.5px] font-medium ${tone}`}>{word}</span>
        </span>
      </li>
    )
  }
  return (
    <div>
      <p className="m-0 mb-1 text-[12.5px] font-medium text-fg">Second opinions, from quantities the jury did not use</p>
      <ul className="m-0 list-none divide-y divide-white/[0.05] p-0">
        {row('Radiated power', e.energy, <>{fmtInt(e.frp)} MW summed</>)}
        {row('Area burning', e.extent, <>{fmtInt(e.cells)} cells of 5 km</>)}
      </ul>
      {e.detections > 0 && (
        <p className="mb-0 mt-1.5 text-[11.5px] leading-relaxed text-fg-3">
          {fmtInt(e.detections)} daytime detections{e.highConfidence !== null ? `, ${Math.round(e.highConfidence * 100)}% high confidence` : ''}. Median satellite, each against its own past {calendarMonthName(month)}s, in spreads.
        </p>
      )}
    </div>
  )
}

/** NASA POWER weather of the month, and whether it fits the verdict. */
function MonthWeather({ weather, anomaly }: { weather: WeatherAnomaly; anomaly: MonthAnomaly | undefined }) {
  const hot = (weather.heat ?? 0) >= HOT
  const cool = (weather.heat ?? 0) <= -HOT
  const dry = weather.wetness !== null && weather.wetness <= DRY
  const wet = weather.wetness !== null && weather.wetness >= WET
  const fire = anomaly?.kind === 'unusual-high' ? 1 : anomaly?.kind === 'unusual-low' ? -1 : 0
  const fits = fire > 0 ? hot || dry : fire < 0 ? cool || wet : null
  return (
    <div>
      <p className="m-0 mb-1 text-[12.5px] font-medium text-fg">Weather that month · NASA POWER</p>
      <ul className="m-0 list-none divide-y divide-white/[0.05] p-0 text-[12.5px]">
        <li className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-fg-2"><span className="text-fg">Daily maximum</span> · {weather.tmax.toFixed(1)} °C</span>
          {weather.heat !== null && <span className={`font-mono tabular-nums ${hot ? 'text-[#f08a6c]' : cool ? 'text-info' : 'text-fg-3'}`}>{weather.heat >= 0 ? '+' : '−'}{Math.abs(weather.heat).toFixed(1)} °C</span>}
        </li>
        <li className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-fg-2"><span className="text-fg">Rain, 3 months</span> · {weather.rain3 === null ? 'n/a' : `${Math.round(weather.rain3)} mm`}</span>
          <span className={`font-mono tabular-nums ${dry ? 'text-[#d9a25f]' : wet ? 'text-[#5fd0c2]' : 'text-fg-3'}`}>{weather.wetness === null ? 'dry season' : `${Math.round(weather.wetness * 100)}% of usual`}</span>
        </li>
      </ul>
      {fits !== null && (
        <p className={`mb-0 mt-1.5 text-[11.5px] leading-relaxed ${fits ? 'text-ok' : 'text-ember-300'}`}>
          {fits ? (fire > 0 ? 'Hot or dry: the weather fits the burst.' : 'Cool or wet: the weather fits the lull.') : fire > 0 ? 'Neither hot nor dry: the weather does not explain this burst; people may.' : 'Not cooler or wetter than usual: the weather does not explain this lull.'}
        </p>
      )}
    </div>
  )
}

function MonthRobustness({ robust, threshold }: { robust: Robustness; threshold: number }) {
  const holding = robust.thresholds.filter((t) => t.kind === robust.kind).map((t) => t.threshold)
  const range = holding.length ? (holding.length === 1 ? `${holding[0]}` : `${holding[0]}–${holding[holding.length - 1]}`) : null
  return (
    <p className="m-0 text-[12px] leading-relaxed text-fg-3">
      <span className="text-fg-2">Robustness:</span> {range ? `holds at thresholds of ${range} spreads (default ${threshold})` : 'holds only at the default threshold'}
      {robust.dropOne.tried >= 3 ? ` · keeps its verdict with ${robust.dropOne.held} of ${robust.dropOne.tried} satellites withheld in turn` : robust.dropOne.tried === 2 ? ' · rests on two satellites agreeing' : ''}.
    </p>
  )
}

/** The case file of one month: verdict, testimonies, second opinions, weather, the map. */
function CaseFile({ report, month, onShowEpisode, weather }: { report: BridgeReport; month: string; onShowEpisode?: (start: string, endExclusive: string) => void; weather?: WeatherAnomaly }) {
  const record = report.months.find((m) => m.month === month)
  const a = report.anomalies.months.find((x) => x.month === month)
  const v = verdict(a, report)
  const episode = largestEpisode(report, month)
  const name = calendarMonthName(month)
  const bridge = record?.bridge
  const usual = a?.harmonized?.usual
  const times = bridge ? ratio(bridge.value, usual) : null
  const robust = report.evidence?.robustness?.find((r) => r.month === month)
  return (
    <section className="relative grid gap-x-10 gap-y-8 border-t border-white/[0.07] pt-12 lg:grid-cols-[96px_minmax(0,1fr)]" aria-labelledby="case-file-title" aria-live="polite">
      <div className="hidden lg:block">
        <span className={`grid size-14 place-items-center rounded-full border border-current bg-ink-950 ${TONE_TEXT[v.tone]}`} aria-hidden="true"><ToneIcon tone={v.tone} size={22} /></span>
      </div>
      <div className="flex min-w-0 flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-fg-3">The case file</p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h3 id="case-file-title" className="m-0 font-serif text-[clamp(28px,3.4vw,46px)] font-[480] leading-[1.04] tracking-[-0.028em] text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>
              The case of {fmtMonth(month, 'long')}
            </h3>
            {v.tone !== 'empty' && <AskWhy month={month} question={v.tone === 'none' ? `What happened in ${fmtMonth(month, 'long')}?` : `Why is ${fmtMonth(month, 'long')} marked "${v.label.toLowerCase()}"?`} />}
          </div>
          <p className={`m-0 flex items-center gap-2 font-serif text-[22px] font-[420] ${TONE_TEXT[v.tone]}`} style={{ fontVariationSettings: '"opsz" 36' }}>
            <span className="lg:hidden"><ToneIcon tone={v.tone} size={18} /></span>
            Verdict: {v.label.toLowerCase()}
          </p>
          {v.testimony && <p className="m-0 max-w-[62ch] font-serif text-[17px] font-[400] leading-[1.6] text-paper-2" style={{ fontVariationSettings: '"opsz" 18' }}>{v.testimony}</p>}
        </header>

        <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.9fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {a && a.witnesses.length > 0 && (
              <div>
                <p className="m-0 mb-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-ember-300">The jury: each satellite against its own past {name}s</p>
                <JuryStrip witnesses={a.witnesses} threshold={report.anomalies.threshold} />
                <ul className="m-0 mt-4 list-none p-0">
                  {a.witnesses.map((w) => <Testimony key={w.sensor} witness={w} monthName={name} />)}
                </ul>
              </div>
            )}
            {episode && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
                <p className="m-0 flex min-w-0 items-start gap-2 text-[13px] text-fg-2">
                  <Flame size={15} className="mt-0.5 shrink-0 text-ember-300" aria-hidden="true" />
                  <span>
                    <span className="text-fg">Largest cluster:</span> {fmtDate(episode.start.slice(0, 10))}{episode.end.slice(0, 10) !== episode.start.slice(0, 10) ? ` → ${fmtDate(episode.end.slice(0, 10))}` : ''} · {fmtInt(episode.detections)} detections
                    {episode.maxFrp !== null ? ` · peak ${fmtInt(episode.maxFrp)} MW` : ''}
                    <span className="ml-1.5 inline-flex translate-y-[1px] gap-1">{(Object.keys(episode.bySensor) as (keyof typeof SENSORS)[]).map((s) => <SensorDot key={s} sensor={s} size={7} />)}</span>
                  </span>
                </p>
                {onShowEpisode && (
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-transparent px-3 py-1.5 text-[12px] font-medium text-fg-2 hover:border-ember-400/40 hover:text-ember-100" onClick={() => onShowEpisode(episode.start.slice(0, 10), nextDay(episode.end.slice(0, 10)))} aria-label={`Show the ${fmtDate(episode.start.slice(0, 10))} cluster on the map`}>
                    <MapPinned size={13} aria-hidden="true" />
                    Map
                  </button>
                )}
              </div>
            )}
          </div>
          <aside className="flex min-w-0 flex-col gap-7 border-white/[0.07] xl:border-l xl:pl-8">
            <div>
              <p className="m-0 text-[12px] text-fg-3">Aqua-equivalent fire cell-days</p>
              {bridge ? (
                <p className="m-0 mt-1 flex items-baseline gap-3">
                  <span className="font-serif text-[48px] font-[420] leading-none tracking-[-0.028em] text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>{fmtCount(bridge.value)}</span>
                  {times !== null && <span className={`font-serif text-[20px] italic ${times >= 1 ? 'text-ember-200' : 'text-info'}`}>{fmtTimes(times)} usual</span>}
                </p>
              ) : (
                <p className="mb-0 mt-1.5 text-[13px] text-fg-2">No supported record. Left empty, never filled with zero.</p>
              )}
              {bridge && (
                <p className="mb-0 mt-2 text-[12px] leading-relaxed text-fg-2">
                  {bridge.source === 'aqua' ? (record?.referenceDrift ? 'Observed by Aqua on a drifted pass' : 'Observed by Aqua') : `Estimated from ${sensorLabel(bridge.source)} (range ${fmtOne(bridge.low)}–${fmtOne(bridge.high)})${record?.referenceDrift && record.aqua !== null ? `; the drifted Aqua pass recorded ${fmtInt(record.aqua)}` : ''}`}
                  {usual !== undefined && <> · usual {name} {fmtOne(usual)}</>}
                </p>
              )}
              {record && (
                <p className="mb-0 mt-2 text-[12px] text-fg-3">
                  All satellites, raw: <span className="text-fg-2">{fmtInt(record.raw)} native detections</span>
                  {a?.raw && <> · usual {fmtInt(a.raw.usual)}{Math.abs(a.raw.z) >= report.anomalies.threshold && <span className="text-warn"> · a raw total would flag this month</span>}</>}
                </p>
              )}
            </div>
            <IndependentChecks report={report} anomaly={a} month={month} />
            {weather && <MonthWeather weather={weather} anomaly={a} />}
            {robust && <MonthRobustness robust={robust} threshold={report.anomalies.threshold} />}
          </aside>
        </div>
      </div>
    </section>
  )
}

function AttentionItem({ report, anomaly, onInspect }: { report: BridgeReport; anomaly: MonthAnomaly; onInspect: (month: string) => void }) {
  const title = fmtMonth(anomaly.month, 'long')
  const v = verdict(anomaly, report)
  const h = anomaly.harmonized
  const detail =
    anomaly.kind === 'artifact'
      ? `raw total ${fmtInt(anomaly.raw?.value ?? 0)} vs a usual ${fmtInt(anomaly.raw?.usual ?? 0)} detections`
      : h
        ? `${fmtCount(h.value)} vs a usual ${fmtOne(h.usual)} cell-days${anomaly.consensus ? ` · ${anomaly.consensus.agreeing} of ${anomaly.consensus.n} satellites agree` : ''}`
        : anomaly.consensus
          ? `${anomaly.consensus.agreeing} of ${anomaly.consensus.n} satellites agree`
          : ''
  return (
    <li>
      <button type="button" onClick={() => onInspect(anomaly.month)} aria-label={`Inspect ${title}`} className="group grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-xl border-0 bg-transparent px-2 py-2 text-left hover:bg-white/[0.03]">
        <span className={`mt-0.5 ${TONE_TEXT[v.tone]}`}><ToneIcon tone={v.tone} /></span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-fg">{title}</span>
          {detail && <span className="mt-0.5 block text-[12px] leading-snug text-fg-3">{detail}</span>}
        </span>
        <span className="mt-0.5 text-[12px] text-fg-3 transition-colors group-hover:text-fg-2" aria-hidden="true">Inspect →</span>
      </button>
    </li>
  )
}

function AttentionList({ report, onInspect }: { report: BridgeReport; onInspect: (month: string) => void }) {
  const { unusual, disputed, artifacts } = attention(report)
  const groups = [
    { key: 'unusual', dot: 'bg-ember-400 shadow-[0_0_10px_#ff7c40]', title: 'Unusual, confirmed by independent satellites', items: unusual, empty: 'No month stands out on the satellites’ combined evidence.' },
    { key: 'disputed', dot: 'border-2 border-dashed border-warn', title: 'Disputed: the satellites contradict the record', items: disputed, empty: 'No month in which the satellites contradict the harmonized record.' },
    { key: 'artifacts', dot: 'border-2 border-fg-2', title: 'Raw-total false alarms', items: artifacts, empty: 'Raw totals raise no alarm the satellites do not support.' },
  ]
  return (
    <section className="relative grid gap-x-10 gap-y-6 border-t border-white/[0.07] pt-12 lg:grid-cols-[96px_minmax(0,1fr)]" aria-labelledby="attention-heading">
      <div className="hidden lg:block" />
      <div className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-fg-3">The docket · periods deserving attention</p>
          <h3 id="attention-heading" className="m-0 font-serif text-[clamp(24px,2.5vw,34px)] font-[400] leading-[1.12] tracking-[-0.015em] text-paper" style={{ fontVariationSettings: '"opsz" 96' }}>What stands out, and how sure we are</h3>
        </header>
        <div className="grid gap-10 lg:grid-cols-3">
          {groups.map((group) => (
            <div key={group.key} className="min-w-0">
              <p className="m-0 mb-3 flex items-baseline gap-3 border-b border-white/[0.07] pb-3">
                <span className="font-serif text-[40px] font-[420] leading-none text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>{group.items.length}</span>
                <span className="flex items-center gap-2 text-[12.5px] font-medium leading-snug text-fg-2">
                  <span className={`size-2.5 shrink-0 rounded-full ${group.dot}`} aria-hidden="true" />
                  {group.title}
                </span>
              </p>
              {group.items.length ? (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {group.items.slice(0, 6).map((a) => <AttentionItem key={a.month} report={report} anomaly={a} onInspect={onInspect} />)}
                </ul>
              ) : (
                <p className="m-0 font-serif text-[15px] italic text-fg-3">{group.empty}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LegendMark({ children, label }: { children: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-[11.5px] text-fg-2">
      <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">{children}</svg>
      {label}
    </li>
  )
}

function SeasonsLegend({ mode }: { mode: SeasonMode }) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0" aria-label="Chart marks">
      <LegendMark label="Usual season"><path d="M1 9 C6 9 7 3 9 3 S12 9 17 9" fill="none" stroke="#f3f4f7" strokeOpacity="0.45" strokeDasharray="2.5 2" /></LegendMark>
      {mode === 'harmonized' ? (
        <>
          <LegendMark label="Estimated from VIIRS"><line x1="1" y1="6" x2="17" y2="6" stroke="#ffa070" strokeDasharray="4 3" strokeWidth="1.5" /></LegendMark>
          <LegendMark label="Unusually high, satellites agree"><circle cx="9" cy="6" r="4" fill="#ffe4d2" stroke="#ff7c40" strokeWidth="1.5" /></LegendMark>
          <LegendMark label="Unusually low"><circle cx="9" cy="6" r="4" fill="none" stroke="#60a5fa" strokeWidth="2" /></LegendMark>
          <LegendMark label="Disputed"><circle cx="9" cy="6" r="4" fill="none" stroke="#fbbf24" strokeWidth="1.75" strokeDasharray="2.5 2" /></LegendMark>
        </>
      ) : (
        <>
          <LegendMark label="A raw total would flag it"><circle cx="9" cy="6" r="4" fill="none" stroke="#aab0bc" strokeWidth="1.5" /></LegendMark>
          <LegendMark label="Confirmed by the satellites"><circle cx="9" cy="6" r="4" fill="#ffe4d2" stroke="#ff7c40" strokeWidth="1.5" /></LegendMark>
        </>
      )}
      <LegendMark label="No record"><line x1="1" y1="6" x2="17" y2="6" stroke="#737a88" strokeDasharray="1 3" strokeLinecap="round" strokeWidth="1.5" /></LegendMark>
    </ul>
  )
}

interface Step {
  key: string
  mode: SeasonMode
  month: string | null
  content: ReactNode
}

/** The guided reading of the seasons: what a ridge is, what usual means, the exceptions, the raw trap. */
function storySteps(report: BridgeReport): Step[] {
  const { unusual, disputed } = attention(report)
  const rawFlags = report.anomalies.months.filter((a) => a.raw && Math.abs(a.raw.z) >= report.anomalies.threshold)
  const rawConfirmed = rawFlags.filter((a) => a.kind === 'unusual-high' || a.kind === 'unusual-low').length
  const firstFalse = rawFlags.find((a) => a.kind !== 'unusual-high' && a.kind !== 'unusual-low')
  const top = unusual[0]
  const dispute = disputed[0]
  const steps: Step[] = [
    { key: 'ridges', mode: 'harmonized', month: null, content: <p>Each ridge is <strong>one year of fire</strong>, January to December, on one Aqua-equivalent scale. The higher the ridge, the more ground burned that month, whichever satellites happened to be flying.</p> },
    { key: 'usual', mode: 'harmonized', month: null, content: <p>The faint dashed line behind each ridge is <strong>the usual season</strong>: what that month looked like in the other years. A month only matters when it leaves its dashed line.</p> },
  ]
  if (top)
    steps.push({
      key: 'top',
      mode: 'harmonized',
      month: top.month,
      content: (
        <p>
          <strong>{fmtMonth(top.month, 'long')}</strong> left it{top.harmonized ? <>: {fmtCount(top.harmonized.value)} Aqua-equivalent cell-days against a usual {fmtOne(top.harmonized.usual)}</> : null}. {top.consensus ? <>{top.consensus.agreeing} of {top.consensus.n} satellites, each judged only against its own past, agree.</> : null} That is why it glows.
        </p>
      ),
    })
  if (dispute)
    steps.push({
      key: 'dispute',
      mode: 'harmonized',
      month: dispute.month,
      content: <p><strong>{fmtMonth(dispute.month, 'long')}</strong> also looks high, but the satellites do not back it. It is marked <strong>disputed</strong>, with an amber ring: flagged, never hidden.</p>,
    })
  steps.push({
    key: 'raw',
    mode: 'raw',
    month: firstFalse?.month ?? null,
    content: (
      <p>
        Now add up every satellite, as a naive total would. <strong>{rawFlags.length} month{rawFlags.length === 1 ? '' : 's'}</strong> light up as alarms; the satellites confirm <strong>{rawConfirmed}</strong>. The rest are the fleet or the archive changing, not the fire.
      </p>
    ),
  })
  steps.push({ key: 'explore', mode: 'harmonized', month: null, content: <p><strong>Your turn.</strong> Point at any month, or use the arrow keys across months and years. The case file below follows you.</p> })
  return steps
}

export function CalendarView({ report, onShowEpisode }: { report: BridgeReport; onShowEpisode?: (start: string, endExclusive: string) => void }) {
  const initial = useMemo(() => featuredMonth(report) ?? report.months.find((m) => m.bridge)?.month ?? report.months[0]?.month, [report])
  const [picked, setPicked] = useState<{ report: BridgeReport; month: string } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [mode, setMode] = useState<SeasonMode>('harmonized')
  const caseFile = useRef<HTMLDivElement>(null)
  const steps = useMemo(() => storySteps(report), [report])
  // A step coming into view sets the scene: its record and its month. The reader can still change both.
  const lastStep = useRef(0)
  const enterStep = useCallback(
    (index: number) => {
      if (index === lastStep.current) return
      lastStep.current = index
      const step = steps[index]
      if (!step) return
      setMode(step.mode)
      if (step.month) setPicked({ report, month: step.month })
    },
    [steps, report],
  )
  // The copilot can ask the calendar to show a month, and reads which month is shown.
  const copilot = useCopilot()
  const weather = useWeatherEvidence(report.evidence ? report : null)
  const request = copilot?.monthRequest
  const [appliedRequest, setAppliedRequest] = useState(0)
  if (request && request.nonce !== appliedRequest && report.months.some((m) => m.month === request.month)) {
    setAppliedRequest(request.nonce)
    setPicked({ report, month: request.month })
  }
  const focus = picked?.report === report ? picked.month : initial
  const reportMonth = copilot?.reportMonth
  useEffect(() => {
    reportMonth?.(focus ?? null)
    return () => reportMonth?.(null)
  }, [reportMonth, focus])
  const { sentence, figures, judged } = useVerdict(report)
  if (!focus) return null
  const shown = hover ?? focus
  const scored = judged > 0
  const rawFlags = report.anomalies.months.filter((a) => a.raw && Math.abs(a.raw.z) >= report.anomalies.threshold)
  const rawConfirmed = rawFlags.filter((a) => a.kind === 'unusual-high' || a.kind === 'unusual-low').length
  const inspect = (month: string) => {
    setPicked({ report, month })
    caseFile.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const shownRecord = report.months.find((m) => m.month === shown)
  const shownVerdict = verdict(report.anomalies.months.find((a) => a.month === shown), report)
  const shownValue = mode === 'raw' ? shownRecord?.raw ?? null : shownRecord?.bridge?.value ?? null
  const checks = report.evidence ? [seasonCheck(report), confirmationCheck(report), weatherCheck(report, weather.evidence), robustnessCheck(report), hotterCheck(report), falseAlarmCheck(report)].filter((c) => c !== null) : []
  return (
    <>
      <Standfirst><p className="m-0">{sentence}</p></Standfirst>
      <Figures label="The calendar in four numbers" items={figures} />
      {!scored && (
        <Banner tone="info">
          The jury compares each month with the same month in at least {report.anomalies.minimumYears} other years. This analysis is too short to judge unusual months, so the calendar shows the harmonized record only. Request up to ten years of the same area to judge it.
        </Banner>
      )}
      <Scrolly
        steps={steps.map((step) => ({ key: step.key, content: step.content }))}
        onStep={enterStep}
        graphic={() => {
          return (
            <section className="min-w-0" aria-labelledby="calendar-grid-heading">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="m-0 mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.2em] text-fg-3">Fire seasons, year by year</p>
                  <h3 id="calendar-grid-heading" className="m-0 font-serif text-[22px] font-[400] text-paper" style={{ fontVariationSettings: '"opsz" 48' }}>{mode === 'raw' ? 'All satellites, raw detections' : 'Harmonized record, Aqua-equivalent'}</h3>
                </div>
                <div role="radiogroup" aria-label="Record shown" className="inline-flex rounded-full border border-white/[0.1] p-1">
                  {(['harmonized', 'raw'] as SeasonMode[]).map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={`rounded-full border-0 px-3 py-1 text-[12px] font-medium ${mode === value ? 'bg-paper text-ink-950' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
                      {value === 'raw' ? 'Raw, all satellites' : 'Harmonized'}
                    </button>
                  ))}
                </div>
              </div>
              <FireSeasons report={report} mode={mode} focus={focus} hover={hover} onFocus={(month) => setPicked({ report, month })} onHover={setHover} />
              <p className="m-0 mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/[0.07] pt-3" aria-hidden="true">
                <span className="font-serif text-[18px] text-paper" style={{ fontVariationSettings: '"opsz" 24' }}>{fmtMonth(shown, 'long')}</span>
                <span className="text-[12.5px] text-fg-2">{shownValue === null ? 'no record' : mode === 'raw' ? `${fmtInt(shownValue)} native detections` : `${fmtCount(shownValue)} Aqua-equivalent cell-days`}</span>
                <span className={`text-[12.5px] font-medium ${TONE_TEXT[shownVerdict.tone]}`}>{shownVerdict.label}</span>
              </p>
              <div className="mt-3"><SeasonsLegend mode={mode} /></div>
              <p className="m-0 mt-2 max-w-3xl text-[12px] leading-relaxed text-fg-3">
                {mode === 'raw'
                  ? `Read naively, raw totals flag ${rawFlags.length} month${rawFlags.length === 1 ? '' : 's'} as unusual; the satellites, each against its own past, confirm ${rawConfirmed}. The rest move with the satellite fleet or the archive, not the fire.`
                  : 'Each ridge is one year of the harmonized record, January to December; the dashed line behind it is the usual season, from the same months in the other years. Only months the satellites agree on are lit.'}
              </p>
            </section>
          )
        }}
      />
      <div ref={caseFile} className="scroll-mt-28">
        <CaseFile report={report} month={shown} onShowEpisode={onShowEpisode} weather={weather.evidence?.months.find((m) => m.month === shown)} />
      </div>
      <AttentionList report={report} onInspect={inspect} />
      <EvidencePanel
        id="calendar-evidence"
        eyebrow="Why you can trust this calendar"
        title="The calendar, checked against physics it never used"
        lede="The jury counts fire cell-days. These checks ask other questions: when the season falls, how much energy the fires radiated and how much ground burned, what NASA’s weather record says, and whether each verdict survives a stricter test. Each answer sits beside published science."
        checks={checks}
      />
      <Note>
        A month is unusual when the median satellite, each compared only with the same calendar month in its own other years (log scale, pooled spread), sits {report.anomalies.threshold} or more spreads from its usual, or when the harmonized record does and the satellites lean the same way. Satellites outside their original overpass regime are shown but do not vote. Exploration aid, not an incident register: a flagged month is a reason to look closer.
      </Note>
    </>
  )
}

export function CalendarPanel({ analysisId, onShowEpisode }: { analysisId?: string; onShowEpisode?: (start: string, endExclusive: string) => void }) {
  const state = useBridgeReport(analysisId)
  if (!analysisId) return null
  return (
    <section className="relative flex flex-col gap-12 pt-6 font-sans sm:pt-10" aria-labelledby="calendar-heading">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-ember-500/[0.07] blur-[100px]" aria-hidden="true" />
      <header className="relative flex flex-col gap-6">
        <Masthead>
          <CalendarSearch size={13} aria-hidden="true" /> Fire calendar{state.status === 'ready' ? ` · ${state.report.meta.engine}` : ''}
        </Masthead>
        <h2 id="calendar-heading" className="m-0 max-w-[20ch] font-serif text-[clamp(34px,4.6vw,62px)] font-[480] leading-[1.02] tracking-[-0.032em] text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>When was burning unusual, and do the satellites agree?</h2>
      </header>
      {state.status === 'loading' && <BridgeProgress state={state} />}
      {state.status === 'error' && <ApiError context="analysis" error={state.error} retry={state.retry} />}
      {state.status === 'too-large' && (
        <Banner tone="warning">
          This analysis holds {fmtInt(state.total)} detections, above the {fmtInt(MAX_BRIDGE_DETECTIONS)} the in-browser engine processes. Narrow the area or period to build its calendar.
        </Banner>
      )}
      {state.status === 'ready' && <CalendarView report={state.report} onShowEpisode={onShowEpisode} />}
    </section>
  )
}
