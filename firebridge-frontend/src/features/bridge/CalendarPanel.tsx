import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarSearch, CircleSlash, MapPinned, Scale, SearchCheck, TriangleAlert } from 'lucide-react'
import { SENSORS } from '../../lib/sensors'
import { Banner } from '../../components/ui/Banner'
import { ApiError } from '../analyses/Feedback'
import type { BridgeReport, MonthAnomaly, Witness } from './engine/index.ts'
import { attention, calendarMonthName, featuredMonth, largestEpisode, MONTH_SHORT, verdict, type Tone } from './calendar'
import { fmtCount, fmtDate, fmtInt, fmtMonth, fmtOne, sensorLabel } from './format'
import { BridgeProgress } from './BridgePanel'
import { MAX_BRIDGE_DETECTIONS, useBridgeReport } from './useBridgeReport'
import { Legend, Note, SensorDot, Tile } from './ui'

type Mode = 'harmonized' | 'raw'

/** Ember ramp (900 → 100): more activity is brighter. Zero is the surface; no record is hatched. */
const RAMP = ['#5c1e0c', '#8f2d0f', '#bd390d', '#e84a10', '#ff7c40', '#ffa070', '#ffc5a3', '#ffe4d2']
const ZERO = '#1d212a'
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 6px)'
/** Square-root scale over whole counts: an estimate of 0.3 cell-days reads as zero, not as activity. */
const step = (value: number, max: number) => (Math.round(value) <= 0 ? -1 : Math.min(RAMP.length - 1, Math.floor(Math.sqrt(Math.round(value) / Math.max(1, max)) * RAMP.length)))

const TONE_RING: Record<Tone, string> = {
  high: 'outline outline-2 outline-offset-1 outline-ember-300',
  low: 'outline outline-2 outline-offset-1 outline-info',
  disputed: 'outline outline-2 outline-offset-1 outline-dashed outline-warn',
  artifact: 'outline outline-2 outline-offset-1 outline-dashed outline-fg-3',
  none: '',
  empty: '',
}
const TONE_TEXT: Record<Tone, string> = { high: 'text-ember-200', low: 'text-info', disputed: 'text-warn', artifact: 'text-fg-2', none: 'text-fg', empty: 'text-fg-3' }
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
const shiftMonth = (month: string, delta: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

function Mark({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-[11.5px] text-fg-2">
      <span className="inline-flex items-center" aria-hidden="true">{children}</span>
      {label}
    </li>
  )
}

function ToneIcon({ tone, size = 15 }: { tone: Tone; size?: number }) {
  if (tone === 'high') return <ArrowUpRight size={size} aria-hidden="true" />
  if (tone === 'low') return <ArrowDownRight size={size} aria-hidden="true" />
  if (tone === 'disputed') return <Scale size={size} aria-hidden="true" />
  if (tone === 'artifact') return <TriangleAlert size={size} aria-hidden="true" />
  if (tone === 'empty') return <CircleSlash size={size} aria-hidden="true" />
  return <SearchCheck size={size} aria-hidden="true" />
}

function VerdictTiles({ report }: { report: BridgeReport }) {
  const { unusual, disputed, artifacts } = attention(report)
  const judged = report.anomalies.months.filter((a) => a.harmonized || (a.consensus?.n ?? 0) >= 2).length
  const top = unusual[0]
  const firstDispute = disputed[0]
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        tone="ember"
        label="Most unusual month"
        value={top ? fmtMonth(top.month, 'short') : '—'}
        sub={top?.harmonized ? `${fmtCount(top.harmonized.value)} Aqua-equivalent cell-days against a usual ${fmtOne(top.harmonized.usual)} · ${top.consensus?.agreeing ?? 0} of ${top.consensus?.n ?? 0} satellites agree` : judged ? 'No month stands out on the evidence' : 'Needs five or more years of record'}
      />
      <Tile label="Unusual months" value={judged ? fmtInt(unusual.length) : '—'} sub={judged ? `of ${fmtInt(judged)} months judged, each backed by independent satellites` : 'Nothing judged yet'} />
      <Tile label="Disputed" value={judged ? fmtInt(disputed.length) : '—'} sub={firstDispute ? `${fmtMonth(firstDispute.month, 'short')}: ${firstDispute.outlier ? `${sensorLabel(firstDispute.outlier)} contradicts the others` : 'not confirmed'}` : 'The satellites never contradict the record'} />
      <Tile label="Raw-total false alarms avoided" value={fmtInt(artifacts.length)} sub={artifacts.length ? `${artifacts.map((a) => fmtMonth(a.month, 'short')).slice(0, 3).join(', ')}${artifacts.length > 3 ? '…' : ''}: the record, not the fire, changed` : 'Raw totals raise no extra alarm here'} />
    </div>
  )
}

function CalendarGrid({ report, mode, focus, onFocus, onHover }: { report: BridgeReport; mode: Mode; focus: string; onFocus: (month: string) => void; onHover: (month: string | null) => void }) {
  const byMonth = useMemo(() => new Map(report.months.map((m) => [m.month, m])), [report])
  const anomalies = useMemo(() => new Map(report.anomalies.months.map((a) => [a.month, a])), [report])
  const years = [...new Set(report.months.map((m) => m.month.slice(0, 4)))]
  const values = report.months.map((m) => (mode === 'raw' ? m.raw : m.bridge?.value ?? 0))
  const max = Math.max(1, ...values)
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const move = (event: KeyboardEvent, month: string) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -12, ArrowDown: 12 }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    let next = shiftMonth(month, delta)
    while (!byMonth.has(next) && next >= report.months[0].month && next <= report.months[report.months.length - 1].month) next = shiftMonth(next, Math.sign(delta))
    if (!byMonth.has(next)) return
    onFocus(next)
    cells.current.get(next)?.focus()
  }
  return (
    <table className="w-full table-fixed border-separate border-spacing-[3px] [&_th]:static [&_th]:bg-transparent [&_th]:p-0 [&_th]:font-mono [&_th]:text-[10.5px] [&_th]:font-medium [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-fg-3" onMouseLeave={() => onHover(null)}>
      <caption className="sr-only">{mode === 'raw' ? 'Native detections from all satellites by month' : 'Aqua-equivalent active cell-days by month, with unusual months marked'}. Use the arrow keys to move between months.</caption>
      <thead>
        <tr>
          <th scope="col" className="w-9"><span className="sr-only">Year</span></th>
          {MONTH_SHORT.map((name) => <th key={name} scope="col" className="pb-1 text-center"><span aria-hidden="true">{name.slice(0, 1)}</span><span className="sr-only">{name}</span></th>)}
        </tr>
      </thead>
      <tbody>
        {years.map((year) => (
          <tr key={year}>
            <th scope="row" className="pr-1 text-left">{year}</th>
            {MONTH_SHORT.map((_, i) => {
              const month = `${year}-${String(i + 1).padStart(2, '0')}`
              const record = byMonth.get(month)
              if (!record) return <td key={month} aria-hidden="true" />
              const a = anomalies.get(month)
              const v = verdict(a, report)
              const value = mode === 'raw' ? record.raw : record.bridge?.value ?? null
              const rawFlag = a?.raw && Math.abs(a.raw.z) >= report.anomalies.threshold ? (a.raw.z > 0 ? 'high' : 'low') : null
              const ring: Tone = mode === 'raw' ? (rawFlag ?? 'none') : v.tone === 'artifact' ? 'none' : v.tone
              const level = value === null ? -1 : step(value, max)
              const estimated = mode === 'harmonized' && record.bridge && record.bridge.source !== 'aqua'
              const label = `${fmtMonth(month, 'long')}: ${value === null ? 'no record' : mode === 'raw' ? `${fmtInt(value)} native detections` : `${fmtCount(value)} Aqua-equivalent cell-days${estimated ? `, estimated from ${sensorLabel(record.bridge!.source)}` : ''}`}. ${mode === 'raw' ? (rawFlag ? `Raw total unusually ${rawFlag}.` : '') : v.label}.`
              return (
                <td key={month} className="p-0">
                  <button
                    ref={(node) => {
                      if (node) cells.current.set(month, node)
                      else cells.current.delete(month)
                    }}
                    type="button"
                    tabIndex={month === focus ? 0 : -1}
                    aria-pressed={month === focus}
                    aria-label={label}
                    onClick={() => onFocus(month)}
                    onFocus={() => onFocus(month)}
                    onKeyDown={(event) => move(event, month)}
                    onMouseEnter={() => onHover(month)}
                    className={`relative grid h-7 w-full place-items-center rounded-[5px] border-0 p-0 font-mono text-[10px] font-semibold tabular-nums transition-[transform,filter] hover:brightness-125 focus-visible:z-10 sm:h-8 ${TONE_RING[ring]} ${month === focus ? 'z-10 scale-110 shadow-[0_0_0_2px_#0a0c11,0_0_0_3.5px_#f3f4f7]' : ''} ${level >= 5 ? 'text-ink-950' : 'text-fg'}`}
                    style={value === null ? { background: HATCH } : { background: level < 0 ? ZERO : RAMP[level] }}
                  >
                    {ring !== 'none' && value !== null && <span aria-hidden="true">{mode === 'raw' ? (value >= 1000 ? `${Math.round(value / 100) / 10}k` : fmtInt(value)) : fmtInt(value)}</span>}
                    {estimated && <span className="absolute bottom-[3px] right-[3px] size-[5px] rounded-full border border-current opacity-80" aria-hidden="true" />}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function WitnessRow({ witness, unit = 'cell-days' }: { witness: Witness; unit?: string }) {
  const meta = SENSORS[witness.sensor]
  const z = witness.score?.z ?? 0
  const width = Math.min(1, Math.abs(z) / 4) * 50
  const stateText = witness.state === 'drifted' ? 'drifted pass, not counted' : witness.state === 'no-record' ? 'no record this month' : witness.state === 'too-new' ? 'too few years on record' : null
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px]">
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg">
        <SensorDot sensor={witness.sensor} />
        <span className="truncate">{meta.label}</span>
        <span className="hidden font-mono text-[10.5px] text-fg-3 sm:inline">{meta.instrument}</span>
      </span>
      <span className="col-span-2 row-start-2 text-[12px] text-fg-3 sm:col-span-1 sm:row-start-auto">
        {witness.score ? <>{fmtInt(witness.score.value)} {unit} <span className="text-fg-3">· usual {fmtOne(witness.score.usual)}</span></> : stateText}
        {witness.score && stateText && <span className="block text-[11px] text-warn">{stateText}</span>}
      </span>
      <span className="relative h-2 rounded-full bg-white/[0.05]" role="img" aria-label={witness.score ? `z ${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}` : 'not scored'}>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-white/20" aria-hidden="true" />
        {witness.score && (
          <span
            className={`absolute inset-y-0 rounded-full ${z >= 0 ? 'bg-ember-400' : 'bg-info'} ${witness.state === 'scored' ? '' : 'opacity-40'}`}
            style={z >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
            aria-hidden="true"
          />
        )}
      </span>
    </li>
  )
}

function MonthJury({ report, month, announce, onShowEpisode }: { report: BridgeReport; month: string; announce: boolean; onShowEpisode?: (start: string, endExclusive: string) => void }) {
  const record = report.months.find((m) => m.month === month)
  const a = report.anomalies.months.find((x) => x.month === month)
  const v = verdict(a, report)
  const episode = largestEpisode(report, month)
  const name = calendarMonthName(month)
  const bridge = record?.bridge
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-live={announce ? 'polite' : 'off'}>
      <div>
        <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">{fmtMonth(month, 'long')}</p>
        <p className={`m-0 mt-1 flex items-center gap-1.5 text-[17px] font-semibold ${TONE_TEXT[v.tone]}`}><ToneIcon tone={v.tone} size={17} />{v.label}</p>
        {v.testimony && <p className="mb-0 mt-1.5 text-[13px] leading-relaxed text-fg-2">{v.testimony}</p>}
      </div>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="m-0 text-[12px] text-fg-3">Harmonized record · Aqua-equivalent active cell-days</p>
        {bridge ? (
          <>
            <p className="mb-0 mt-1.5 text-[26px] font-semibold leading-none tracking-tight text-fg">
              {fmtCount(bridge.value)}
              {bridge.source !== 'aqua' && <span className="ml-2 text-[13px] font-normal text-fg-3">range {fmtOne(bridge.low)}–{fmtOne(bridge.high)}</span>}
            </p>
            <p className="mb-0 mt-1.5 text-[12px] text-fg-2">
              {bridge.source === 'aqua' ? (record?.referenceDrift ? 'Observed by Aqua on a drifted pass (no VIIRS estimate available)' : 'Observed by Aqua') : `Estimated from ${sensorLabel(bridge.source)}${record?.referenceDrift && record.aqua !== null ? `; the drifted Aqua pass recorded ${fmtInt(record.aqua)}` : ''}`}
              {a?.harmonized && <> · usual {name} {fmtOne(a.harmonized.usual)}</>}
            </p>
          </>
        ) : (
          <p className="mb-0 mt-1.5 text-[13px] text-fg-2">No supported record. Left empty, never filled with zero.</p>
        )}
      </div>
      {a && a.witnesses.length > 0 && (
        <div>
          <p className="m-0 mb-1 text-[12.5px] font-medium text-fg">The jury: each satellite against its own past {name}s</p>
          <ul className="m-0 list-none divide-y divide-white/[0.05] p-0">
            {a.witnesses.map((w) => <WitnessRow key={w.sensor} witness={w} />)}
          </ul>
          <p className="mb-0 mt-2 text-[11.5px] leading-relaxed text-fg-3">
            Bars show how far each record sits from its usual {name}, on a log scale (centre: usual; full width: 4 spreads). Daytime fire cell-days; a drifted satellite is shown but does not vote.
          </p>
        </div>
      )}
      {record && (
        <p className="m-0 text-[12px] text-fg-3">
          All satellites, raw: <span className="text-fg-2">{fmtInt(record.raw)} native detections</span>
          {a?.raw && <> · usual {fmtInt(a.raw.usual)}{Math.abs(a.raw.z) >= report.anomalies.threshold && <span className="text-warn"> · a raw total would flag this month</span>}</>}
        </p>
      )}
      {episode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
          <p className="m-0 min-w-0 text-[12.5px] text-fg-2">
            <span className="text-fg">Largest cluster:</span> {fmtDate(episode.start.slice(0, 10))}{episode.end.slice(0, 10) !== episode.start.slice(0, 10) ? ` → ${fmtDate(episode.end.slice(0, 10))}` : ''} · {fmtInt(episode.detections)} detections
            {episode.maxFrp !== null ? ` · peak ${fmtInt(episode.maxFrp)} MW` : ''}
            <span className="ml-1.5 inline-flex translate-y-[1px] gap-1">{(Object.keys(episode.bySensor) as (keyof typeof SENSORS)[]).map((s) => <SensorDot key={s} sensor={s} size={7} />)}</span>
          </p>
          {onShowEpisode && (
            <button type="button" className="ui-button ui-button--small" onClick={() => onShowEpisode(episode.start.slice(0, 10), nextDay(episode.end.slice(0, 10)))} aria-label={`Show the ${fmtDate(episode.start.slice(0, 10))} cluster on the map`}>
              <MapPinned size={13} aria-hidden="true" />
              Map
            </button>
          )}
        </div>
      )}
    </div>
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
    { key: 'unusual', title: 'Unusual, confirmed by independent satellites', items: unusual, empty: 'No month stands out on the satellites’ combined evidence.' },
    { key: 'disputed', title: 'Disputed: the satellites contradict the record', items: disputed, empty: 'No month in which the satellites contradict the harmonized record.' },
    { key: 'artifacts', title: 'Raw-total false alarms', items: artifacts, empty: 'Raw totals raise no alarm the satellites do not support.' },
  ]
  return (
    <section className="card min-w-0 p-5 sm:p-6" aria-labelledby="attention-heading">
      <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">Periods deserving attention</p>
      <h3 id="attention-heading" className="m-0 text-[16px] font-semibold text-fg">What stands out, and how sure we are</h3>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.key} className="min-w-0">
            <p className="m-0 mb-2 text-[12.5px] font-medium text-fg-2">{group.title} <span className="font-mono text-fg-3">· {group.items.length}</span></p>
            {group.items.length ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {group.items.slice(0, 6).map((a) => <AttentionItem key={a.month} report={report} anomaly={a} onInspect={onInspect} />)}
              </ul>
            ) : (
              <p className="m-0 text-[12.5px] text-fg-3">{group.empty}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export function CalendarView({ report, onShowEpisode }: { report: BridgeReport; onShowEpisode?: (start: string, endExclusive: string) => void }) {
  const initial = useMemo(() => featuredMonth(report) ?? report.months.find((m) => m.bridge)?.month ?? report.months[0]?.month, [report])
  const [picked, setPicked] = useState<{ report: BridgeReport; month: string } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('harmonized')
  const grid = useRef<HTMLDivElement>(null)
  const focus = picked?.report === report ? picked.month : initial
  if (!focus) return null
  const shown = hover ?? focus
  const scored = report.anomalies.months.some((a) => a.harmonized || (a.consensus?.n ?? 0) >= 2)
  const rawFlags = report.anomalies.months.filter((a) => a.raw && Math.abs(a.raw.z) >= report.anomalies.threshold)
  const rawConfirmed = rawFlags.filter((a) => a.kind === 'unusual-high' || a.kind === 'unusual-low').length
  const inspect = (month: string) => {
    setPicked({ report, month })
    grid.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  return (
    <>
      <VerdictTiles report={report} />
      {!scored && (
        <Banner tone="info">
          The jury compares each month with the same month in at least {report.anomalies.minimumYears} other years. This analysis is too short to judge unusual months, so the calendar shows the harmonized record only. Request up to ten years of the same area to judge it.
        </Banner>
      )}
      <section ref={grid} className="card grid min-w-0 gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" aria-labelledby="calendar-grid-heading">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">Burning-activity calendar</p>
              <h3 id="calendar-grid-heading" className="m-0 text-[16px] font-semibold text-fg">{mode === 'raw' ? 'All satellites, raw detections' : 'Harmonized record, Aqua-equivalent'}</h3>
            </div>
            <div role="radiogroup" aria-label="Record shown" className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
              {(['harmonized', 'raw'] as Mode[]).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={`rounded-lg border-0 px-2.5 py-1 text-[12px] font-medium ${mode === value ? 'bg-white/[0.08] text-fg' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
                  {value === 'raw' ? 'Raw, all satellites' : 'Harmonized'}
                </button>
              ))}
            </div>
          </div>
          <CalendarGrid report={report} mode={mode} focus={focus} onFocus={(month) => setPicked({ report, month })} onHover={setHover} />
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3" aria-hidden="true">
                Less
                <span className="flex gap-[2px]">{[ZERO, ...RAMP].map((color) => <span key={color} className="h-2.5 w-3 rounded-[2px]" style={{ background: color }} />)}</span>
                More
              </span>
              <Legend label="Calendar marks">
                {mode === 'harmonized' && <Mark label="No record"><span className="h-2.5 w-3 rounded-[2px]" style={{ background: HATCH }} /></Mark>}
                {mode === 'harmonized' && <Mark label="Estimated from VIIRS"><span className="size-[6px] rounded-full border border-fg-2" /></Mark>}
                <Mark label="Unusually high"><span className="h-2.5 w-3 rounded-[2px] outline outline-2 outline-ember-300" /></Mark>
                <Mark label="Unusually low"><span className="h-2.5 w-3 rounded-[2px] outline outline-2 outline-info" /></Mark>
                {mode === 'harmonized' && <Mark label="Disputed"><span className="h-2.5 w-3 rounded-[2px] outline outline-2 outline-dashed outline-warn" /></Mark>}
              </Legend>
            </div>
            <p className="m-0 text-[12px] leading-relaxed text-fg-2">
              {mode === 'raw'
                ? `Read naively, raw totals flag ${rawFlags.length} month${rawFlags.length === 1 ? '' : 's'} as unusual; the satellites, each against its own past, confirm ${rawConfirmed}. The rest move with the satellite fleet or the archive, not the fire.`
                : 'Each cell is one month of the harmonized record: observed Aqua where it flew in its original regime, otherwise estimated from VIIRS. Hover or use the arrow keys to read a month; the panel shows each satellite’s testimony.'}
            </p>
          </div>
        </div>
        <div className="min-w-0 lg:border-l lg:border-white/[0.06] lg:pl-6">
          <MonthJury report={report} month={shown} announce={!hover} onShowEpisode={onShowEpisode} />
        </div>
      </section>
      <AttentionList report={report} onInspect={inspect} />
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
    <section className="flex flex-col gap-6 font-sans" aria-labelledby="calendar-heading">
      <header className="max-w-3xl">
        <p className="m-0 mb-2 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-300">
          <CalendarSearch size={13} aria-hidden="true" /> Fire calendar{state.status === 'ready' ? ` · ${state.report.meta.engine}` : ''}
        </p>
        <h2 id="calendar-heading" className="m-0 text-[26px] font-semibold tracking-tight text-fg">When was burning unusual, and do the satellites agree?</h2>
        <p className="mb-0 mt-2 text-[14px] leading-relaxed text-fg-2">
          Every satellite is put on the stand separately and compared only with its own past, so differences in sensitivity cancel out. A month counts as unusual when independent instruments agree, and is marked disputed when they contradict the record.
        </p>
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
