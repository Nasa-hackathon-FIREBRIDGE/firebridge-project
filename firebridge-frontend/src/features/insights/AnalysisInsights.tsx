import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, CalendarCheck2, Flame, Info, Layers2, Satellite, ScanSearch, Sparkles, TrendingUp } from 'lucide-react'
import { useNativeCalendar, useNativeSummary } from '../observations/useResults'
import { ApiError } from '../analyses/Feedback'
import { CountUp } from '../../components/ui/CountUp'
import { ActivityHeatmap } from './ActivityHeatmap'
import { computeInsights, formatDay, formatMonth, type DayCell, type Insights } from './computeInsights'

const SeasonalChart = lazy(() => import('./SeasonalChart'))

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
      text: <>Activity peaked in <strong>{formatMonth(peakMonth.month)}</strong> with {fmt(peakMonth.total)} detections, {pct(peakMonth.total, total)} of the period.</>,
    })
  if (topMonthsShare !== null && topMonthsShare >= 0.5)
    out.push({ icon: <Flame size={16} />, text: <>The three busiest months hold <strong>{Math.round(topMonthsShare * 100)}%</strong> of all detections, a strongly seasonal pattern.</> })
  if (peakPeriod && resolution === 'day')
    out.push({ icon: <CalendarCheck2 size={16} />, text: <>The busiest single day was <strong>{formatDay(peakPeriod.date)}</strong>, with {fmt(peakPeriod.total ?? 0)} detections.</> })
  if (ratio !== null)
    out.push({
      icon: <ScanSearch size={16} />,
      text: (
        <>
          VIIRS recorded <strong>{ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×</strong> as many detections as MODIS over the same area and dates. That is expected from its finer 375 m pixels and is not evidence of more burning.
        </>
      ),
    })
  if (bothInstrumentPeriods > 0 && resolution === 'day')
    out.push({ icon: <Layers2 size={16} />, text: <><strong>{fmt(bothInstrumentPeriods)} days</strong> have detections from both MODIS and VIIRS, the overlap that supports sensor comparison.</> })
  if (knownPeriods > 0 && resolution === 'day')
    out.push({ icon: <Info size={16} />, text: <>Detections were recorded on {fmt(activePeriods)} of {fmt(knownPeriods)} days. Days without detections are not confirmed fire-free.</> })
  return out
}

function Kpi({ label, value, sub, index, accent }: { label: string; value: ReactNode; sub: ReactNode; index: number; accent?: string }) {
  return (
    <motion.div
      className="card relative overflow-hidden p-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: index * 0.06, ease }}
    >
      {accent && <span className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} aria-hidden="true" />}
      <p className="m-0 text-[12.5px] font-medium text-fg-3">{label}</p>
      <p className="mb-0 mt-2 font-display text-[30px] font-semibold leading-none tracking-tight text-fg tabular-nums">{value}</p>
      <p className="mb-0 mt-2 text-[12.5px] text-fg-2">{sub}</p>
    </motion.div>
  )
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
              <strong className="font-semibold text-fg">{sensor.count === null ? 'Unknown' : fmt(sensor.count)}</strong>
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

function Card({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section
      className={`card min-w-0 p-5 sm:p-6 ${className}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.15, ease }}
      aria-label={title}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          {eyebrow && <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">{eyebrow}</p>}
          <h3 className="m-0 text-[16px] font-semibold text-fg">{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </motion.section>
  )
}

export function AnalysisInsights({ analysisId, onSelectDay }: { analysisId?: string; onSelectDay?: (cell: DayCell) => void }) {
  const { summary, calendar, insights } = useInsights(analysisId)
  if (!analysisId) return null
  const loading = summary.isPending || calendar.isPending
  const total = insights.total
  const list = findings(insights)
  return (
    <section className="flex flex-col gap-5" aria-labelledby="insights-heading">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="m-0 mb-2 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-300">
            <Sparkles size={13} aria-hidden="true" /> Automated insights
          </p>
          <h2 id="insights-heading" className="m-0 text-[24px] font-semibold tracking-tight text-fg">What the satellites recorded</h2>
          <p className="mb-0 mt-1.5 text-[14px] text-fg-2">Calculated from this saved analysis. Native detections per satellite, not a harmonized fire response.</p>
        </div>
      </header>
      <ApiError error={summary.error} retry={() => { void summary.refetch() }} />
      <ApiError error={calendar.error} retry={() => { void calendar.refetch() }} />
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="ui-skeleton h-[118px] rounded-2xl" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi index={0} accent="#ff7c40" label="Native detections" value={total === null ? 'Unknown' : <>{insights.lowerBound ? '≥ ' : ''}<CountUp value={total} /></>} sub={`across ${insights.sensors.length} satellite record${insights.sensors.length === 1 ? '' : 's'}`} />
          <Kpi index={1} label={insights.resolution === 'day' ? 'Active days' : 'Active periods'} value={<><CountUp value={insights.activePeriods} /><span className="text-[18px] text-fg-3"> / {fmt(insights.knownPeriods)}</span></>} sub="with at least one detection" />
          <Kpi index={2} label="Peak day" value={insights.peakPeriod ? <CountUp value={insights.peakPeriod.total ?? 0} /> : '—'} sub={insights.peakPeriod ? formatDay(insights.peakPeriod.date) : 'No detections returned'} />
          <Kpi index={3} accent="#34d399" label="VIIRS per MODIS detection" value={insights.ratio === null ? '—' : <><CountUp value={insights.ratio} format={(v) => v.toFixed(1)} />×</>} sub={insights.ratio === null ? 'Needs both instruments' : 'resolution effect, not more fire'} />
        </div>
      )}

      {!loading && (
        <>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card
              eyebrow="Seasonal profile"
              title="Monthly detections by satellite"
              action={
                <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
                  {insights.sensors.map((sensor) => (
                    <li key={sensor.key} className="flex items-center gap-1.5 text-[11.5px] text-fg-2">
                      <span className="size-2 rounded-sm" style={{ background: sensor.color }} aria-hidden="true" />
                      {sensor.label}
                    </li>
                  ))}
                </ul>
              }
            >
              {insights.months.length ? (
                <Suspense fallback={<div className="ui-skeleton h-[360px] w-full" />}>
                  <SeasonalChart months={insights.months} sensors={insights.sensors} height={360} />
                </Suspense>
              ) : (
                <p className="m-0 text-fg-2">No periods returned for this analysis.</p>
              )}
            </Card>
            <Card eyebrow="Key findings" title="In plain language">
              {list.length ? (
                <ul className="m-0 flex list-none flex-col gap-4 p-0">
                  {list.map((item, index) => (
                    <motion.li
                      key={index}
                      className="flex gap-3 text-[13.5px] leading-relaxed text-fg-2 [&_strong]:font-semibold [&_strong]:text-fg"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 + index * 0.08, ease }}
                    >
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-ember-500/10 text-ember-300" aria-hidden="true">{item.icon}</span>
                      <span>{item.text}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-fg-2">No detections were returned, so no pattern can be described. This does not establish an absence of fire.</p>
              )}
            </Card>
          </div>
          {insights.resolution === 'day' && insights.periods.length > 0 && (
            <Card eyebrow="Daily activity" title="Detection calendar">
              <ActivityHeatmap periods={insights.periods} onSelect={onSelectDay} />
            </Card>
          )}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card eyebrow="Satellite contributions" title="Who saw what">
              <SensorBars insights={insights} />
            </Card>
            <Card eyebrow="Why counts differ" title="Read the comparison carefully">
              <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-fg-2">
                <p className="m-0 flex gap-3"><Satellite size={16} className="mt-0.5 shrink-0 text-aqua" aria-hidden="true" />MODIS (Terra, Aqua) uses 1 km pixels; VIIRS (S-NPP, NOAA-20/21) uses 375 m pixels and detects smaller fires.</p>
                <p className="m-0 flex gap-3"><Satellite size={16} className="mt-0.5 shrink-0 text-terra" aria-hidden="true" />Terra passes in the morning (~10:30) and the others in the early afternoon (~13:30), when fires are often more active.</p>
                <p className="m-0 flex gap-3"><Info size={16} className="mt-0.5 shrink-0 text-ember-300" aria-hidden="true" />Counts are shown natively and side by side. A harmonized, Aqua-equivalent response is research in progress.</p>
              </div>
            </Card>
          </div>
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
          <dl className="mb-0 mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4">
            <div className="flex flex-col">
              <dt className="text-[11.5px] text-fg-3">Peak month</dt>
              <dd className="m-0 mt-1 text-[13.5px] font-medium text-fg">{calendar.isPending ? '…' : insights.peakMonth ? formatMonth(insights.peakMonth.month, 'short') : '—'}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-[11.5px] text-fg-3">VIIRS : MODIS</dt>
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
