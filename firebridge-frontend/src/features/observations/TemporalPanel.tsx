import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { CalendarDays, Layers2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { summarizeKnownCounts } from '../../lib/nativeCounts'
import { sensorMeta } from '../../lib/sensors'
import { ApiError, Empty, Status } from '../analyses/Feedback'
import { useNativeCalendar, useNativeSummary } from './useResults'
import type { ObservationFilters } from './filters'
import { Skeleton } from '../../components/ui/Skeleton'
import { CopyableId } from '../../components/ui/CopyableId'
import { Banner } from '../../components/ui/Banner'
import { useBridgeReport } from '../bridge/useBridgeReport'
import { ActScience, Cites, EvidencePanel } from '../science/Evidence'
import { Chapter, Masthead, Prose, Sidenote, Standfirst } from '../story/Story'
import { PixelScale } from '../sources/PixelScale'
import { SkyClock } from '../sources/SkyClock'
import { pixelCheck, resolutionCheck, timeOfDayCheck, type CheckSpec } from '../science/checks'

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = (month: string) => `${MONTH_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
const shiftMonth = (month: string, delta: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}
const nextMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10)
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.13) 0 2px, transparent 2px 6px)'

interface DayRow {
  start: string
  end: string
  value: bigint | null
  lowerBound: boolean
}

const label = (row: { value: bigint | null; lowerBound: boolean }) => (row.value === null ? 'Unknown' : `${row.lowerBound ? '≥ ' : ''}${row.value.toLocaleString()}`)

/** Reading notes computed from the daily inventory itself. */
function timelineNotes(rows: DayRow[]): CheckSpec[] {
  const known = rows.filter((r) => r.value !== null)
  if (known.length < 14) return []
  const active = known.filter((r) => r.value! > 0n).length
  let pairs = 0
  let followed = 0
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (a.value === null || b.value === null || a.value === 0n || a.end !== b.start) continue
    pairs++
    if (b.value > 0n) followed++
  }
  const base = active / known.length
  const unknown = rows.length - known.length
  const notes: CheckSpec[] = []
  if (pairs >= 10 && base > 0 && base < 1)
    notes.push({
      key: 'runs',
      status: 'further',
      claim: followed / pairs > base * 1.15 ? 'Fire days come in runs' : 'Fire days here arrive one by one',
      measured: (
        <>
          After a day with detections, the next day also has detections <strong>{Math.round((followed / pairs) * 100)}%</strong> of the time, against <strong>{Math.round(base * 100)}%</strong> for any day with a known inventory ({active.toLocaleString('en-US')} of {known.length.toLocaleString('en-US')} days).
        </>
      ),
      further: followed / pairs > base * 1.15 ? <>Fires persist and spread over several days, so one burning day announces the next: the Fire episodes on the Overview chain them into clusters.</> : undefined,
    })
  notes.push({
    key: 'absence',
    status: 'open',
    claim: 'A day without detections is not a fire-free day',
    measured: (
      <>
        {known.length - active > 0 ? <><strong>{(known.length - active).toLocaleString('en-US')}</strong> days have a known zero</> : 'No day has a known zero'}
        {unknown ? <>, and <strong>{unknown.toLocaleString('en-US')}</strong> days have no inventory at all (shown as a dash, never as zero)</> : null}. A zero only says no satellite recorded fire on its passes.
      </>
    ),
    science: <>Each MODIS instrument views the whole Earth every 1 to 2 days; between passes, under cloud or under thick smoke, a fire leaves no detection.</>,
    cites: ['modisAbout'],
  })
  return notes
}

export function TemporalPanel({ analysisId, filters, onChange, compact = false }: {
  analysisId?: string; filters: ObservationFilters; onChange: (value: ObservationFilters) => void; compact?: boolean
}) {
  const calendar = useNativeCalendar(analysisId)
  const rows: DayRow[] = useMemo(
    () => (calendar.data?.periods ?? []).map((period) => ({ start: period.start.slice(0, 10), end: period.end_exclusive.slice(0, 10), ...summarizeKnownCounts(period.counts_by_source.filter((source) => !filters.sourceId || source.source_id === filters.sourceId)) })),
    [calendar.data, filters.sourceId],
  )
  const months = useMemo(() => {
    const map = new Map<string, { month: string; value: bigint; unknown: number; lowerBound: boolean; days: DayRow[] }>()
    for (const row of rows) {
      const key = row.start.slice(0, 7)
      const entry = map.get(key) ?? { month: key, value: 0n, unknown: 0, lowerBound: false, days: [] }
      entry.days.push(row)
      if (row.value === null) entry.unknown++
      else entry.value += row.value
      entry.lowerBound ||= row.lowerBound || row.value === null
      map.set(key, entry)
    }
    return [...map.values()]
  }, [rows])
  const long = rows.length > 62
  const peak = months.reduce<(typeof months)[number] | null>((best, m) => (!best || m.value > best.value ? m : best), null)
  const [picked, setPicked] = useState<string | null>(null)
  const filtered = filters.start ? filters.start.slice(0, 7) : null
  const focus = (picked && months.some((m) => m.month === picked) ? picked : null) ?? (filtered && months.some((m) => m.month === filtered) ? filtered : null) ?? peak?.month ?? null
  const focused = months.find((m) => m.month === focus)
  const days = long ? focused?.days ?? [] : rows
  const dayMax = days.reduce((value, row) => (row.value !== null && row.value > value ? row.value : value), 1n)
  const monthMax = months.reduce((value, m) => (m.value > value ? m.value : value), 1n)
  const monthSelected = focused && filters.start === `${focused.month}-01` && filters.endExclusive === nextMonth(focused.month)
  const notes = compact ? [] : timelineNotes(rows)
  // Drag across the month strip to filter a stretch of months; a plain click opens one month's days.
  const drag = useRef<{ from: number; to: number } | null>(null)
  const suppressClick = useRef(false)
  const [brush, setBrush] = useState<[number, number] | null>(null)
  const indexAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(months.length - 1, Math.floor(((event.clientX - box.left) / box.width) * months.length)))
  }
  const inRange = (month: string) => !!filters.start && !!filters.endExclusive && `${month}-01` >= filters.start.slice(0, 8) + '01' && `${month}-01` < filters.endExclusive && !(filters.endExclusive.slice(0, 7) === filters.start.slice(0, 7))
  const range = filters.start && filters.endExclusive && filters.start.endsWith('-01') && filters.endExclusive.endsWith('-01') && filters.start.slice(0, 7) !== filters.endExclusive.slice(0, 7) ? `${monthName(filters.start.slice(0, 7))} → ${monthName(shiftMonth(filters.endExclusive.slice(0, 7), -1))}` : null
  return (
    <section className={compact ? 'card mt-4 min-w-0 p-4 font-sans sm:p-5' : 'relative flex min-w-0 flex-col gap-2 pt-6 font-sans sm:pt-10'} aria-label="Temporal analysis">
      {!compact && <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-ember-500/[0.07] blur-[100px]" aria-hidden="true" />}
      <header className={compact ? 'flex flex-wrap items-start justify-between gap-3' : 'relative flex flex-col gap-6'}>
        {compact ? (
          <div>
            <p className="m-0 mb-1 inline-flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ember-300">
              <CalendarDays size={13} aria-hidden="true" />
              Timeline
            </p>
            <h3 className="m-0 text-[16px] font-semibold text-fg">Detections over time</h3>
          </div>
        ) : (
          <>
            <Masthead><CalendarDays size={13} aria-hidden="true" /> Timeline · {filters.start || filters.endExclusive ? `${filters.start || 'saved start'} → ${filters.endExclusive || 'saved end'}, end excluded` : 'full saved interval'} · UTC</Masthead>
            <h2 className="m-0 max-w-[20ch] font-serif text-[clamp(34px,4.6vw,62px)] font-[480] leading-[1.02] tracking-[-0.032em] text-paper">Choose a stretch of time; the map and the table follow</h2>
          </>
        )}
        {compact && <span className="font-mono text-[11px] text-fg-3">{filters.start || filters.endExclusive ? `${filters.start || 'Saved start'} → ${filters.endExclusive || 'Saved end'} · end excluded` : 'Full saved interval'} · UTC</span>}
      </header>
      <p className={compact ? 'mb-0 mt-2 max-w-3xl text-[13px] leading-relaxed text-fg-2' : 'm-0 mt-4 max-w-[62ch] font-serif text-[clamp(17px,1.5vw,20px)] leading-[1.55] text-paper-2'}>
        {long ? 'Drag across the strip to filter a stretch of months, or click one month to see its days and pick a single day. ' : 'Pick a day to filter the map and the table. '}
        A dash means the inventory is unknown, which is not the same as zero.
      </p>
      <ApiError error={calendar.error} retry={() => { void calendar.refetch() }} />
      {calendar.isError && calendar.data && <Banner tone="warning">Previously loaded temporal inventory is shown; the latest refresh failed.</Banner>}
      {!analysisId ? (
        <Empty>Select an analysis to load its observation timeline.</Empty>
      ) : calendar.isPending ? (
        <Skeleton height={132} label="Loading temporal inventory…" />
      ) : rows.length > 0 ? (
        <div className="mt-5 flex flex-col gap-5">
          {long && (
            <div>
              <div
                className={`relative flex touch-none select-none items-end gap-[2px] ${compact ? 'h-16' : 'h-36'}`}
                role="group"
                aria-label="Months of the saved interval"
                onPointerDown={(event) => {
                  const i = indexAt(event)
                  drag.current = { from: i, to: i }
                  setBrush([i, i])
                }}
                onPointerMove={(event) => {
                  if (!drag.current || !(event.buttons & 1)) return
                  const i = indexAt(event)
                  if (i !== drag.current.to) {
                    drag.current.to = i
                    setBrush([drag.current.from, i])
                  }
                }}
                onPointerUp={() => {
                  const d = drag.current
                  drag.current = null
                  setBrush(null)
                  if (!d || d.from === d.to) return
                  const [a, b] = d.from < d.to ? [d.from, d.to] : [d.to, d.from]
                  suppressClick.current = true
                  setPicked(months[a].month)
                  onChange({ ...filters, start: `${months[a].month}-01`, endExclusive: nextMonth(months[b].month) })
                }}
                onPointerLeave={() => {
                  drag.current = null
                  setBrush(null)
                }}
              >
                {brush && brush[0] !== brush[1] && (
                  <span
                    className="pointer-events-none absolute inset-y-[-6px] rounded-md border border-ember-300/70 bg-ember-500/15"
                    style={{ left: `${(Math.min(...brush) / months.length) * 100}%`, width: `${((Math.abs(brush[1] - brush[0]) + 1) / months.length) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
                {months.map((m, index) => {
                  const active = m.month === focus
                  const chosen = inRange(m.month)
                  const first = index === 0 || m.month.endsWith('-01')
                  return (
                    <button
                      key={m.month}
                      type="button"
                      aria-pressed={active}
                      title={`${monthName(m.month)}: ${m.lowerBound ? 'at least ' : ''}${m.value.toLocaleString()} detections${m.unknown ? `, ${m.unknown} day${m.unknown === 1 ? '' : 's'} unknown` : ''}`}
                      aria-label={`${monthName(m.month)}: ${m.lowerBound ? 'at least ' : ''}${m.value.toLocaleString()} detections`}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false
                          return
                        }
                        setPicked(m.month)
                      }}
                      className={`group relative flex h-full min-w-[4px] flex-1 flex-col justify-end rounded-[3px] border-0 p-0 ${active ? 'bg-white/[0.07]' : chosen ? 'bg-ember-500/10' : 'bg-transparent hover:bg-white/[0.04]'} ${first ? 'ml-1' : ''}`}
                    >
                      <span
                        className={`block w-full rounded-[2px] transition-colors ${active ? 'bg-ember-200 shadow-[0_0_12px_#ff7c40]' : chosen ? 'bg-ember-400 shadow-[0_0_8px_#ff7c40]' : 'bg-ember-700/80 group-hover:bg-ember-400'}`}
                        style={{ height: `${Math.max(m.value > 0n ? 6 : 0, Math.sqrt(Number(m.value) / Number(monthMax)) * 100)}%` }}
                      />
                      {m.unknown > 0 && <span className="absolute inset-x-0 bottom-0 h-1 rounded-[1px]" style={{ background: HATCH }} aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
              {range && (
                <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ember-100">
                  <span className="size-2 rounded-full bg-ember-400 shadow-[0_0_8px_#ff7c40]" aria-hidden="true" />
                  Filtering {range}
                </p>
              )}
              <div className="mt-1.5 flex gap-[2px] font-mono text-[10px] text-fg-3" aria-hidden="true">
                {months.map((m, index) => (
                  <span key={m.month} className={`min-w-[4px] flex-1 overflow-visible whitespace-nowrap ${index === 0 || m.month.endsWith('-01') ? 'ml-1' : ''}`}>
                    {index === 0 || m.month.endsWith('-01') ? m.month.slice(0, 4) : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            {long && focused && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-[13.5px] font-medium text-fg">
                  {monthName(focused.month)} <span className="font-normal text-fg-3">· {focused.lowerBound ? 'at least ' : ''}{focused.value.toLocaleString()} detections · bars on this month’s scale</span>
                </p>
                <button
                  type="button"
                  aria-pressed={!!monthSelected}
                  className={`ui-button ui-button--small ${monthSelected ? 'ui-button--primary' : ''}`}
                  onClick={() => onChange({ ...filters, start: monthSelected ? '' : `${focused.month}-01`, endExclusive: monthSelected ? '' : nextMonth(focused.month) })}
                >
                  {monthSelected ? 'Whole month selected' : `Filter to ${monthName(focused.month)}`}
                </button>
              </div>
            )}
            <div className="flex items-end gap-[3px] overflow-x-auto pb-1" aria-label="Available observation periods">
              {days.map((row) => {
                const selected = filters.start === row.start && filters.endExclusive === row.end
                const text = label(row)
                const dense = days.length > 16
                return (
                  <button
                    key={row.start}
                    type="button"
                    aria-pressed={selected}
                    title={`${row.start}: ${text} records (UTC day)`}
                    onClick={() => onChange({ ...filters, start: selected ? '' : row.start, endExclusive: selected ? '' : row.end })}
                    className={`group flex min-w-[18px] flex-1 flex-col items-center gap-1 rounded-lg border-0 p-1 ${selected ? 'bg-ember-500/15' : 'bg-transparent hover:bg-white/[0.04]'}`}
                  >
                    <strong className={`font-mono text-[10px] font-medium tabular-nums ${selected ? 'text-ember-100' : 'text-fg-2'} ${dense && row.value !== null && row.value === 0n ? 'opacity-40' : ''}`}>
                      {row.value === null ? <><span aria-hidden="true">—</span><span className="sr-only">Unknown</span></> : dense ? <><span aria-hidden="true">{row.value > 9999n ? `${Math.round(Number(row.value) / 1000)}k` : row.value.toLocaleString()}</span><span className="sr-only">{text}</span></> : text}
                    </strong>
                    <span className="relative block h-24 w-full overflow-hidden rounded-md bg-white/[0.03]" style={row.value === null ? { background: HATCH } : undefined} data-unknown={row.value === null || undefined}>
                      <i
                        data-bar
                        className={`absolute inset-x-0 bottom-0 block rounded-md ${selected ? 'bg-ember-300' : 'bg-ember-gradient'}`}
                        style={{ height: `${row.value === null || row.value === 0n ? 0 : Math.max(4, Number((row.value * 10000n) / dayMax) / 100)}%` } as CSSProperties}
                      />
                    </span>
                    <time dateTime={row.start} className="font-mono text-[10px] text-fg-3">{long ? row.start.slice(8) : row.start.slice(5)}</time>
                    <span className="sr-only">{row.start} until {row.end} exclusive</span>
                  </button>
                )
              })}
            </div>
          </div>
          {(filters.start || filters.endExclusive) && (
            <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
              Filtering the map and table to {filters.start || 'the saved start'} → {filters.endExclusive || 'the saved end'} (end excluded).
              <button type="button" className="ui-button ui-button--small" onClick={() => onChange({ ...filters, start: '', endExclusive: '' })}>
                <X size={13} aria-hidden="true" />
                Clear period
              </button>
            </p>
          )}
        </div>
      ) : (
        !calendar.error && <Empty>No periods returned. Missing detections do not establish observation coverage.</Empty>
      )}
      {notes.length > 0 && <ActScience title="Reading the timeline" checks={notes} />}
      {calendar.data && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-[12px] text-fg-3">
          <Status value={calendar.data.status} />
          <span>Full saved interval · selected source · gaps remain unknown</span>
        </div>
      )}
    </section>
  )
}

export function SourceComparison({ analysisId }: { analysisId?: string }) {
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const summary = useNativeSummary(analysisId)
  const bridge = useBridgeReport(analysisId)
  const report = bridge.status === 'ready' ? bridge.report : null
  const sources = summary.data?.native_detections_by_source ?? []
  const displayed = selectedSources.length ? sources.filter((source) => selectedSources.includes(source.source_id)) : sources
  const max = sources.reduce((value, source) => (source.count !== null && source.count_status !== 'unknown' && BigInt(source.count) > value ? BigInt(source.count) : value), 1n)
  const totals = new Map<string, number>()
  for (const source of sources) {
    const instrument = sensorMeta(source.platform, source.product, source.source_id).instrument
    if (source.count !== null && source.count_status !== 'unknown') totals.set(instrument, (totals.get(instrument) ?? 0) + Number(source.count))
  }
  const all = [...totals.values()].reduce((a, b) => a + b, 0)
  const viirsShare = all ? (totals.get('VIIRS') ?? 0) / all : null
  const checks = report?.evidence ? [resolutionCheck(report), pixelCheck(report), timeOfDayCheck(report)].filter((c) => c !== null) : []
  const aqua = report?.regime.drift.find((d) => d.sensor === 'aqua')
  return (
    <section className="relative flex flex-col gap-14 pt-6 font-sans sm:pt-10" aria-labelledby="source-comparison-heading">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-ember-500/[0.07] blur-[100px]" aria-hidden="true" />
      <header className="relative flex flex-col gap-6">
        <Masthead>
          <Layers2 size={13} aria-hidden="true" /> Compare sources · the instruments
        </Masthead>
        <h2 id="source-comparison-heading" className="m-0 max-w-[20ch] font-serif text-[clamp(34px,4.6vw,62px)] font-[480] leading-[1.02] tracking-[-0.032em] text-paper">Five satellites watch the same fires, and none sees them the same way</h2>
        <Standfirst>
          <p>Native inventories for the full saved analysis. Sensor sampling, resolution and detection methods differ; these counts are not a harmonized fire response.{viirsShare !== null ? ` Here ${Math.round(viirsShare * 100)}% of the detections come from VIIRS, because its pixels are smaller, not because it saw more fire.` : ''}</p>
        </Standfirst>
      </header>
      <ApiError error={summary.error} retry={() => { void summary.refetch() }} />
      {!analysisId ? (
        <Empty>Select an analysis to compare its available source inventories.</Empty>
      ) : summary.isPending ? (
        <Skeleton height={200} label="Loading source inventories…" />
      ) : sources.length ? (
        <>
          <Chapter n={1} kicker="The 24-hour sky" title={aqua && Math.abs(aqua.shiftMinutes) >= 30 ? `Each satellite looks at its own hour, and Aqua’s has moved ${Math.abs(aqua.shiftMinutes)} minutes later` : 'Each satellite looks at the fire at its own hour'}>
            <div className="grid items-center gap-x-12 gap-y-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
              {report ? <SkyClock rows={report.regime.rows} /> : <p className="m-0 text-[13px] text-fg-2" role="status">Reading every detection’s timestamp to place the satellites on the clock…</p>}
              <Prose
                stacked
                notes={
                  <>
                    <Sidenote label="Fire’s daily cycle">Burning peaks between 13:00 and 18:30 local time.<Cites ids={['giglio2007']} /></Sidenote>
                    <Sidenote label="Orbit drift">Aqua has drifted later since 2022, Terra earlier since 2020.<Cites ids={['aquaOrbit', 'terraOrbit']} /></Sidenote>
                  </>
                }
              >
                <p>Noon is at the top, midnight at the bottom. Each ring is one satellite; each dot is the median local time of its daytime passes in one year, read from the archive’s own timestamps.</p>
                <p>The ember band is when fires burn hardest. A satellite that drifts along the dial meets fires at another point of their day, so its counts change while the burning does not. That is why FIREBRIDGE measures the drift instead of assuming the nominal times.</p>
              </Prose>
            </div>
          </Chapter>
          <Chapter n={2} kicker="Pixels to scale" title="The same small fire is seven times more visible to VIIRS">
            <div className="grid items-center gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
              <PixelScale />
              <Prose
                stacked
                notes={
                  <>
                    <Sidenote label="Detection limits">MODIS routinely detects flaming fires of about 1,000 m², and a tenth of that only in very good conditions.<Cites ids={['modisGuide']} /></Sidenote>
                    <Sidenote label="VIIRS 375 m">Designed to resolve smaller and cooler fires.<Cites ids={['schroeder2014']} /></Sidenote>
                  </>
                }
              >
                <p>Both squares are one square kilometre of ground. The white dot is a 1,000 m² flaming fire at true size. To MODIS it fills 0.1% of a pixel; to VIIRS, 0.7% of one 375 m pixel, about seven times more of what the sensor sees.</p>
                <p>That is why VIIRS records more and smaller fires, and why one fire can light up several VIIRS pixels where MODIS lights one.</p>
              </Prose>
            </div>
          </Chapter>
          <Chapter n={3} kicker="The inventories · one common count scale" title={`${fmtCount(all)} native detection records, on one scale`}>
            {sources.length > 1 && (
              <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
                <legend className="mb-3 p-0 font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg-3">Choose inventories · one common count scale</legend>
                {sources.map((source) => {
                  const checked = !selectedSources.length || selectedSources.includes(source.source_id)
                  return (
                    <label key={source.source_id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors ${checked ? 'border-white/[0.16] text-fg' : 'border-white/[0.06] text-fg-3'}`}>
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[#ff7c40]"
                        checked={checked}
                        disabled={selectedSources.length === 1 && selectedSources.includes(source.source_id)}
                        onChange={() => {
                          const current = selectedSources.length ? selectedSources : sources.map((item) => item.source_id)
                          const next = current.includes(source.source_id) ? current.filter((id) => id !== source.source_id) : [...current, source.source_id]
                          if (next.length) setSelectedSources(next)
                        }}
                      />
                      {source.platform} · {source.product}
                    </label>
                  )
                })}
                <button type="button" className="rounded-full border border-white/[0.1] bg-transparent px-3 py-1 text-[12px] text-fg-2 disabled:opacity-40" disabled={!selectedSources.length} onClick={() => setSelectedSources([])}>Show all sources</button>
              </fieldset>
            )}
            <ul className="m-0 flex list-none flex-col p-0">
              {displayed.map((source) => {
                const count = source.count === null || source.count_status === 'unknown' ? null : BigInt(source.count)
                const sensor = sensorMeta(source.platform, source.product, source.source_id)
                return (
                  <li key={source.source_id} className="border-t border-white/[0.06] py-4">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_8rem]">
                      <div className="min-w-0">
                        <p className="m-0 flex items-center gap-2 text-[15px] font-medium text-fg">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: sensor.color, boxShadow: `0 0 10px ${sensor.color}88` }} aria-hidden="true" />
                          {sensor.key === 'other' ? source.platform : sensor.label}
                        </p>
                        <p className="m-0 mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-3">{sensor.instrument} · {source.product} · C{source.collection}</p>
                      </div>
                      <div className="col-span-2 row-start-2 h-[3px] overflow-hidden rounded-full bg-white/[0.06] sm:col-span-1 sm:row-start-auto" aria-hidden="true">
                        <i data-source-bar className="block h-full rounded-full" style={{ width: `${count === null ? 0 : Number((count * 10000n) / max) / 100}%`, background: sensor.color, boxShadow: `0 0 12px ${sensor.color}` }} />
                      </div>
                      <p className="m-0 text-right">
                        <strong className="font-serif text-[26px] font-[440] tracking-[-0.02em] tabular-nums text-paper">{count === null ? 'Unknown' : `${source.count_status === 'lower_bound' ? '≥ ' : ''}${count.toLocaleString()}`}</strong>
                      </p>
                    </div>
                    <details className="mt-1.5 text-[12px] text-fg-3">
                      <summary className="cursor-pointer select-none hover:text-fg-2">Source details</summary>
                      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                        <dt>Processing stream</dt><dd className="m-0 text-fg-2">{source.processing_stream}</dd>
                        <dt>Inventory</dt><dd className="m-0 text-fg-2">{source.inventory_status}</dd>
                        <dt>Count status</dt><dd className="m-0 text-fg-2">{source.count_status}</dd>
                        <dt>Source ID</dt><dd className="m-0 flex flex-wrap items-center gap-2"><CopyableId value={source.source_id} label="source ID" /><code className="break-all text-fg-3">{source.source_id}</code></dd>
                      </dl>
                    </details>
                  </li>
                )
              })}
            </ul>
            <p className="m-0 text-[12px] text-fg-3">
              One scale, fixed to the largest available inventory, also when inventories are hidden.
              {analysisId && <> <Link to={`/api-analysis?analysis=${encodeURIComponent(analysisId)}`}>Open prepared comparison tools</Link> for server-supported resolutions and metrics.</>}
            </p>
          </Chapter>
          {checks.length > 0 && (
            <EvidencePanel
              id="sources-evidence"
              eyebrow="Why the counts differ"
              title="The instruments, checked against what they were built to see"
              lede="Raw inventories differ because the instruments differ. These checks measure those differences in this analysis and set them beside the instrument literature."
              checks={checks}
            />
          )}
        </>
      ) : (
        !summary.error && <Empty>No source inventories were returned.</Empty>
      )}
    </section>
  )
}

const fmtCount = (value: number) => value.toLocaleString('en-US')
