import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Database, Filter, Layers3, ScanLine } from 'lucide-react'
import type { AnalysisView } from '@firebridge/contracts'
import { useArea } from '../../hooks/useFirebridge'
import { useNativeCalendar } from '../../hooks/useDataApi'
import { useCatalog } from '../../hooks/useCatalog'
import { ApiError } from '../analyses/Feedback'
import { Banner } from '../../components/ui/Banner'
import { sensorMeta } from '../../lib/sensors'
import type { CatalogSource } from '../../services/catalog.service'
import type { CalendarView } from '../../services/data.types'
import { calendarSeries, nextDay, previousDay, validateWindow, type ChartSource } from './model'
import { eligibleMonths } from './lab-model'
import { InventoryRibbon } from './InventoryRibbon'
import { DistributionPlot } from './DistributionPlot'
import { PairedSourcePlot } from './PairedSourcePlot'
import { TemporalTreemap, YearDifference } from './TemporalStructure'
import { ConcentrationCurve, YearSimilarity } from './PatternDiagnostics'
import { CountEvidence } from './CountEvidence'
import { ChallengePath } from './ChallengePath'

function describeSeries(data: CalendarView | undefined, descriptors: CatalogSource[]): ChartSource[] {
  return data ? calendarSeries(data).map((s) => {
    const d = descriptors.find((source) => source.source_id === s.id)
    return { ...s, color: sensorMeta(s.id, d?.platform).color, label: d ? `${d.platform ?? s.id} · ${d.collection} · ${d.processing_stream}` : s.id }
  }) : []
}

export function ObservationLab({ analysis }: { analysis: AnalysisView }) {
  const area = useArea(analysis.area_id)
  const savedStart = analysis.start_date.slice(0, 10), savedEnd = analysis.end_date_exclusive.slice(0, 10)
  const [start, setStart] = useState(savedStart), [end, setEnd] = useState(previousDay(savedEnd))
  const [resolution, setResolution] = useState<'day' | 'week' | 'month'>('month')
  const [applied, setApplied] = useState({ start_date: savedStart, end_date_exclusive: savedEnd, resolution })
  const [error, setError] = useState<string | null>(null), [hidden, setHidden] = useState<string[]>([]), [focusId, setFocusId] = useState('')
  const catalogue = useCatalog()
  const calendar = useNativeCalendar(analysis.id, applied)
  const monthly = useNativeCalendar(analysis.id, { ...applied, resolution: 'month' })
  const series = useMemo(() => describeSeries(monthly.data?.data, catalogue.data?.sources ?? []), [monthly.data, catalogue.data])
  const detailed = useMemo(() => describeSeries(calendar.data?.data, catalogue.data?.sources ?? []), [calendar.data, catalogue.data])
  const visible = series.filter((s) => !hidden.includes(s.id))
  const sampleSizes = visible.map((s) => ({ source: s, n: eligibleMonths(s).length }))
  const focus = visible.find((s) => s.id === focusId) ?? [...sampleSizes].sort((a, b) => b.n - a.n)[0]?.source
  const eligible = sampleSizes.reduce((n, s) => n + s.n, 0)
  const candidates = visible.reduce((n, s) => n + s.points.length, 0)
  const years = new Set(visible.flatMap((s) => s.points.map((p) => p.start.slice(0, 4)))).size
  const changed = start !== applied.start_date || end !== previousDay(applied.end_date_exclusive) || resolution !== applied.resolution
  function apply(e: FormEvent) {
    e.preventDefault()
    let message = validateWindow(start, end, savedStart, savedEnd)
    if (!message) {
      const days = (Date.parse(nextDay(end)) - Date.parse(start)) / 86_400_000
      if ((resolution === 'day' && days > 3660) || (resolution === 'week' && Math.ceil(days / 7) + 1 > 3660))
        message = 'Choose month detail or a shorter date window for this export.'
    }
    setError(message)
    if (!message) setApplied({ start_date: start, end_date_exclusive: nextDay(end), resolution })
  }
  return <>
    <section className="card viz-card viz-study-card">
      <div className="viz-context-heading"><div><span className="viz-overline">ONE SHARED OBSERVATION WINDOW</span><h2>{area.data?.name ?? 'Saved analysis'}</h2><p>Explore relationships and distributions beyond the overview charts.</p></div><Link className="button button-secondary" to={`/analyses?analysis=${encodeURIComponent(analysis.id)}#fire-calendar`}>Open harmonized calendar ↗</Link></div>
      <form className="viz-filters" onSubmit={apply}>
        <label className="api-field">Start date (UTC)<input aria-label="Visualization start date" type="date" required min={savedStart} max={previousDay(savedEnd)} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="api-field">End date, included (UTC)<input aria-label="Visualization end date" type="date" required min={savedStart} max={previousDay(savedEnd)} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="api-field">Table & CSV detail<select aria-label="Visualization grouping" value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
        <button className="button button-primary" disabled={monthly.isFetching || calendar.isFetching}>Apply dates</button>
      </form>
      {error && <p role="alert">{error}</p>}{changed && <p role="status">Date changes are pending. Apply dates to update the charts.</p>}
      <div className="viz-filter-foot"><span>Viewing <strong>{applied.start_date} → {previousDay(applied.end_date_exclusive)}</strong> · inclusive UTC days</span><span title={analysis.release_id}>Pinned release <code>{analysis.release_id.slice(0, 8)}</code></span></div>
    </section>
    <ChallengePath analysisId={analysis.id} start={applied.start_date} endExclusive={applied.end_date_exclusive} />
    <ApiError error={monthly.error} retry={() => { void monthly.refetch() }} />
    {monthly.isPending && <div className="card viz-card lab-loading" role="status">Preparing the visual analytics lab…</div>}
    {monthly.isFetching && !monthly.isPending && <p role="status">Refreshing the analytical sample…</p>}
    {monthly.data && <>
      {monthly.isError && <Banner tone="warning">Refresh failed. Previously loaded monthly data is shown.</Banner>}
      {monthly.data.warnings.length > 0 && <Banner tone="warning">{monthly.data.warnings.join(' · ')}</Banner>}
      <div className="viz-metrics" aria-label="Analytical sample metrics"><div className="card viz-metric-primary"><span><Filter size={15} aria-hidden="true" /> Eligible source-months</span><strong>{eligible}</strong><small>Exact counts · full UTC months · safe precision</small></div><div className="card"><span><ScanLine size={15} aria-hidden="true" /> Excluded source-months</span><strong>{candidates - eligible}</strong><small>Unknown, partial window, lower bound or unsafe count</small></div><div className="card"><span><Database size={15} aria-hidden="true" /> Selected streams</span><strong>{visible.length}</strong><small>Kept as separate native inventories</small></div><div className="card"><span><Layers3 size={15} aria-hidden="true" /> Calendar years</span><strong>{years}</strong><small>Inside the selected observation window</small></div></div>
      <div className="viz-source-toolbar"><fieldset className="viz-sources"><legend>Streams in the lab</legend>{series.map((s) => <label key={s.id}><input type="checkbox" checked={!hidden.includes(s.id)} onChange={(e) => setHidden((old) => e.target.checked ? old.filter((id) => id !== s.id) : [...old, s.id])} /><span style={{ color: s.color }}>●</span>{s.label}</label>)}</fieldset><span>All views follow these filters</span></div>
      <p className="viz-reading-note"><span>NATIVE RECORDS, NOT FIRE INCIDENTS</span> Statistical views use exact full months. The inventory ribbon and CSV retain partial and unknown states. No missing count is replaced with zero.</p>
      <nav className="viz-section-nav" aria-label="Visualization sections"><a href="#lab-sources">01 / Source behaviour</a><a href="#lab-structure">02 / Temporal structure</a><a href="#lab-patterns">03 / Pattern diagnostics</a><a href="#lab-evidence">04 / Evidence</a></nav>
      <div className="viz-section-heading" id="lab-sources"><div><span className="viz-overline">01 / KNOW THE SAMPLE</span><h2>Different streams. Different signatures.</h2></div><p>Audit the inventory before exploring variability and relationships.</p></div>
      <InventoryRibbon sources={visible} start={applied.start_date} endExclusive={applied.end_date_exclusive} />
      <div className="lab-pair"><DistributionPlot sources={visible} /><PairedSourcePlot sources={visible} /></div>
      <div className="viz-section-heading" id="lab-structure"><div><span className="viz-overline">02 / EXPLORE ONE STREAM</span><h2>How is activity distributed through time?</h2></div><p>Keep the source fixed when interpreting year-to-year differences.</p></div>
      <section className="lab-focus-bar"><div><span className="viz-overline">FOCUS SOURCE</span><p>The next four views explore this same inventory.</p></div><label className="api-field">Source for temporal diagnostics<select aria-label="Focus source for diagnostics" value={focus?.id ?? ''} onChange={(e) => setFocusId(e.target.value)}>{!visible.length && <option value="">No selected source</option>}{visible.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><span className="lab-focus-dot" style={{ background: focus?.color }} aria-hidden="true" /></section>
      <div className="lab-pair"><TemporalTreemap source={focus} /><YearDifference source={focus} /></div>
      <div className="viz-section-heading" id="lab-patterns"><div><span className="viz-overline">03 / LOOK BENEATH THE TOTALS</span><h2>Concentration and recurring shapes.</h2></div><p>Descriptive diagnostics, with sample sizes and limits kept visible.</p></div>
      <div className="lab-pair"><ConcentrationCurve source={focus} /><YearSimilarity source={focus} /></div>
      <div className="viz-section-heading" id="lab-evidence"><div><span className="viz-overline">04 / TAKE THE EVIDENCE WITH YOU</span><h2>Every result starts with a traceable count.</h2></div><p>Save individual charts as SVG and the selected records as CSV.</p></div>
      <ApiError error={calendar.error} retry={() => { void calendar.refetch() }} />
      {calendar.data && <CountEvidence key={`${applied.start_date}:${applied.end_date_exclusive}:${applied.resolution}:${hidden.join(',')}`} sources={detailed.filter((s) => !hidden.includes(s.id))} analysisId={analysis.id} start={applied.start_date} resolution={applied.resolution} />}
      <details className="viz-method"><summary>Method, exclusions & interpretation</summary><p>All views use the saved study area and pinned data release. Statistical plots exclude lower bounds, missing counts, clipped months and unsafe integers. Full-month zero counts are valid; a month without a known count is not zero. Complete inventory does not establish cloud-free observation or fire-free conditions. Source associations and annual correlations are descriptive, not causal. For calibrated cross-sensor estimates and the burning-activity calendar, open Sensor Bridge in the study workspace.</p></details>
    </>}
  </>
}
