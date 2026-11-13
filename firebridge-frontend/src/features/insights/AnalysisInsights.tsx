import { useMemo, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, CalendarCheck2, Flame, Info, Layers2, ScanSearch, TrendingUp } from 'lucide-react'
import { useNativeCalendar, useNativeSummary } from '../observations/useResults'
import { ApiError } from '../analyses/Feedback'
import { CountUp } from '../../components/ui/CountUp'
import { DayBars } from './DayBars'
import { EmberHorizon } from './EmberHorizon'
import { FleetStreams } from './FleetStreams'
import { Cites } from '../science/Evidence'
import { Chapter, Figure, Figures, Prose, Sidenote } from '../story/Story'
import { computeInsights, formatDay, formatMonth, type DayCell, type Insights } from './computeInsights'

const ease = [0.16, 1, 0.3, 1] as const
const pct = (value: number, total: number) => (total > 0 ? `${Math.round((value / total) * 100)}%` : '—')
const fmt = (value: number) => value.toLocaleString('en-US')

function useInsights(analysisId?: string) {
  const summary = useNativeSummary(analysisId)
  const calendar = useNativeCalendar(analysisId)
  const insights = useMemo(() => computeInsights(summary.data, calendar.data), [summary.data, calendar.data])
  return { summary, calendar, insights }
}

function findings(insights: Insights): { icon: ReactNode; text: ReactNode }[] {
  const out: { icon: ReactNode; text: ReactNode }[] = []
  const { total, peakMonth, peakPeriod, ratio, activePeriods, knownPeriods, bothInstrumentPeriods, topMonthsShare, months, resolution } = insights
  if (peakMonth && total && months.length > 1)
    out.push({
      icon: <TrendingUp size={16} />,
      text: <>Recorded activity peaked in <strong>{formatMonth(peakMonth.month)}</strong> with {fmt(peakMonth.total)} detections, {pct(peakMonth.total, total)} of the available records.</>,
    })
  if (topMonthsShare !== null && topMonthsShare >= 0.5)
    out.push({ icon: <Flame size={16} />, text: <>The three busiest months hold <strong>{Math.round(topMonthsShare * 100)}%</strong> of the available detections, a strongly seasonal pattern.</> })
  if (peakPeriod && resolution === 'day')
    out.push({ icon: <CalendarCheck2 size={16} />, text: <>The busiest single day was <strong>{formatDay(peakPeriod.date)}</strong>, with {fmt(peakPeriod.total ?? 0)} detections.</> })
  if (ratio !== null)
    out.push({
      icon: <ScanSearch size={16} />,
      text: (
        <>
          The available records contain <strong>{ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×</strong> as many VIIRS detections as MODIS detections over the same area and dates. VIIRS has finer 375 m pixels; differences in sampling and inventory completeness also affect this ratio, which is not evidence of more burning.
        </>
      ),
    })
  if (bothInstrumentPeriods > 0 && resolution === 'day')
    out.push({ icon: <Layers2 size={16} />, text: <><strong>{fmt(bothInstrumentPeriods)} days</strong> have detections from both MODIS and VIIRS, the overlap that supports sensor comparison.</> })
  if (knownPeriods > 0 && resolution === 'day')
    out.push({ icon: <Info size={16} />, text: <>Detections were recorded on {fmt(activePeriods)} of {fmt(knownPeriods)} days. Days without detections are not confirmed fire-free.</> })
  return out
}

function SensorBars({ insights, compact = false }: { insights: Insights; compact?: boolean }) {
  const known = insights.sensors.reduce((sum, sensor) => sum + (sensor.count ?? 0), 0)
  const max = Math.max(1, ...insights.sensors.map((sensor) => sensor.count ?? 0))
  return (
    <ul className={`m-0 flex list-none flex-col p-0 ${compact ? 'gap-2.5' : 'gap-4'}`}>
      {insights.sensors.map((sensor, index) => (
        <li key={sensor.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: sensor.color, boxShadow: `0 0 10px ${sensor.color}88` }} aria-hidden="true" />
              <span className="truncate font-medium text-fg">{sensor.label}</span>
              {!compact && <span className="font-mono text-[10.5px] text-fg-3">{sensor.instrument} · {sensor.pixel}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-fg-2">
              <strong className="font-semibold text-fg">{sensor.count === null ? 'Unknown' : `${sensor.lowerBound ? '≥ ' : ''}${fmt(sensor.count)}`}</strong>
              {sensor.count !== null && <span className="ml-1.5 text-fg-3">{pct(sensor.count, known)}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden="true">
            <motion.div
              className="h-full origin-left rounded-full"
              style={{ width: `${((sensor.count ?? 0) / max) * 100}%`, background: `linear-gradient(90deg, ${sensor.color}aa, ${sensor.color})` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, delay: 0.2 + index * 0.08, ease }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function AnalysisInsights({ analysisId, onSelectDay }: { analysisId?: string; onSelectDay?: (cell: DayCell) => void }) {
  const { summary, calendar, insights } = useInsights(analysisId)
  if (!analysisId) return null
  const loading = summary.isPending || calendar.isPending
  const total = insights.total
  const list = findings(insights)
  const viirsShare = insights.modis + insights.viirs > 0 ? insights.viirs / (insights.modis + insights.viirs) : null
  const daily = insights.resolution === 'day' && insights.periods.length > 0
  return (
    <section className="flex flex-col gap-14" aria-labelledby="insights-title">
      <ApiError error={summary.error} retry={() => { void summary.refetch() }} />
      <ApiError error={calendar.error} retry={() => { void calendar.refetch() }} />
      {loading ? (
        <div className="ui-skeleton h-[240px] rounded-2xl" />
      ) : (
        <>
          {daily && (
            <Figure caption="Every day of the record on one line. Each spike of light is a day with fire detections, in proportion to its count, mirrored below like a skyline on water. Dark days had no detections, which is not proof that nothing burned.">
              {insights.periods.length < 21 ? <DayBars periods={insights.periods} onSelect={onSelectDay} /> : <EmberHorizon periods={insights.periods} onSelect={onSelectDay} />}
            </Figure>
          )}
          <Figures
            label="The record in four numbers"
            items={[
              { label: 'Native detections', value: total === null ? 'Unknown' : <>{insights.lowerBound ? '≥ ' : ''}<CountUp value={total} /></>, note: insights.lowerBound ? 'At least this many · inventory is incomplete' : `across ${insights.sensors.length} satellite record${insights.sensors.length === 1 ? '' : 's'}` },
              { label: insights.resolution === 'day' ? 'Days with fire' : 'Periods with fire', value: <><CountUp value={insights.activePeriods} /><span className="text-[0.5em] text-fg-3"> / {fmt(insights.knownPeriods)}</span></>, note: 'with at least one detection' },
              { label: 'Busiest day', value: insights.peakPeriod ? <CountUp value={insights.peakPeriod.total ?? 0} /> : '—', note: insights.peakPeriod ? formatDay(insights.peakPeriod.date) : 'No detections returned' },
              { label: 'Recorded VIIRS per MODIS detection', value: insights.ratio === null ? '—' : <><CountUp value={insights.ratio} format={(v) => v.toFixed(1)} />×</>, note: insights.ratio === null ? 'Needs both instruments' : 'Ratio of available records' },
            ]}
          />
          <Chapter
            id="insights"
            kicker="What the satellites recorded"
            title={total !== null && viirsShare !== null ? <>{insights.lowerBound ? 'At least ' : ''}{fmt(total)} detections from {insights.sensors.length} satellites, and {Math.round(viirsShare * 100)}% of available MODIS and VIIRS records came from VIIRS</> : 'What the satellites recorded'}
          >
            {insights.months.length > 1 && (
              <Figure caption="The fleet as a river: monthly detections stacked by satellite around a centre line. A new stream entering is a satellite joining the record, which raises any raw total without a single extra fire.">
                <FleetStreams months={insights.months} sensors={insights.sensors} />
              </Figure>
            )}
            <Prose
              notes={
                <>
                  <Sidenote label="Pixel size">VIIRS 375 m channels resolve smaller and cooler fires than 1 km MODIS.<Cites ids={['schroeder2014']} /></Sidenote>
                  <Sidenote label="Hour of the pass">Burning peaks between 13:00 and 18:30 local time.<Cites ids={['giglio2007']} /></Sidenote>
                  <Sidenote label="Orbit drift">Aqua drifts later since 2022, Terra earlier since 2020.<Cites ids={['aquaOrbit', 'terraOrbit']} /></Sidenote>
                </>
              }
            >
              {insights.lowerBound && <p>Counts and shares use available records. ≥ marks an incomplete inventory; unknown source counts remain unknown.</p>}
              {list.length ? list.map((item, index) => <p key={index}>{item.text}</p>) : <p>No detections were returned, so no pattern can be described. This does not establish an absence of fire.</p>}
              <p>
                <strong>Why the satellites disagree.</strong> They do not see the same fire the same way. MODIS looks at the ground in 1 km pixels, VIIRS in 375 m pixels that catch smaller fires. Terra passes near 10:30, Aqua and VIIRS near 13:30, closer to the afternoon peak of burning, and both MODIS satellites have drifted from their original hours. Clouds, smoke and gaps between passes hide fires from all of them. The Fire calendar and the Sensor bridge put every satellite on one Aqua-equivalent scale.
              </p>
            </Prose>
          </Chapter>
        </>
      )}
    </section>
  )
}

/** Compact companion to the map. */
export function InsightsRail({ analysisId, onOpenOverview }: { analysisId?: string; onOpenOverview: () => void }) {
  const { summary, calendar, insights } = useInsights(analysisId)
  if (!analysisId) return null
  const loading = summary.isPending
  const known = insights.sensors.reduce((sum, sensor) => sum + (sensor.count ?? 0), 0)
  return (
    <section className="card relative overflow-hidden p-5" aria-label="Analysis at a glance">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-ember-500/10 blur-3xl" aria-hidden="true" />
      <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">At a glance</p>
      {loading ? (
        <div className="mt-3 flex flex-col gap-3"><div className="ui-skeleton h-10 w-32" /><div className="ui-skeleton h-2 w-full" /><div className="ui-skeleton h-24 w-full" /></div>
      ) : summary.isError ? (
        <p className="mb-0 mt-3 text-[13px] text-fg-2">Insights are unavailable right now.</p>
      ) : (
        <>
          <p className="mb-0 mt-2 flex items-baseline gap-2">
            <span className="font-display text-[38px] font-semibold leading-none tracking-tight text-fg tabular-nums">
              {insights.total === null ? 'Unknown' : <>{insights.lowerBound ? '≥ ' : ''}<CountUp value={insights.total} /></>}
            </span>
            <span className="text-[13px] text-fg-2">native detections</span>
          </p>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">
            {insights.sensors.map((sensor, index) => (
              <motion.span
                key={sensor.key}
                className="h-full origin-left first:rounded-l-full last:rounded-r-full"
                style={{ width: `${known ? ((sensor.count ?? 0) / known) * 100 : 0}%`, background: sensor.color }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.9, delay: 0.1 + index * 0.08, ease }}
              />
            ))}
          </div>
          <div className="mt-4"><SensorBars insights={insights} compact /></div>
          {insights.lowerBound && <p className="mb-0 mt-3 text-[11.5px] leading-relaxed text-fg-3">≥ means at least this many; inventory is incomplete. Shares and ratio use available records.</p>}
          <dl className="mb-0 mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4">
            <div className="flex flex-col">
              <dt className="text-[11.5px] text-fg-3">Peak month</dt>
              <dd className="m-0 mt-1 text-[13.5px] font-medium text-fg">{calendar.isPending ? '…' : insights.peakMonth ? formatMonth(insights.peakMonth.month, 'short') : '—'}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-[11.5px] text-fg-3">Recorded VIIRS : MODIS</dt>
              <dd className="m-0 mt-1 text-[13.5px] font-medium text-fg">{insights.ratio === null ? '—' : `${insights.ratio.toFixed(1)} : 1`}</dd>
            </div>
          </dl>
          <button type="button" onClick={onOpenOverview} className="ui-button mt-5 w-full justify-between">
            Open full insights
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  )
}
