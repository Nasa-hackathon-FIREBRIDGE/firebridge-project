import { CalendarDays } from 'lucide-react'
import { summarizeCounts } from '../../lib/nativeCounts'
import { ApiError, Empty, Status } from '../analyses/Feedback'
import { useNativeCalendar, useNativeSummary } from './useResults'
import type { ObservationFilters } from './filters'
import { useState, type CSSProperties } from 'react'
import { sensorMeta } from '../../lib/sensors'
import { Link } from 'react-router-dom'
import { Skeleton } from '../../components/ui/Skeleton'
import { CopyableId } from '../../components/ui/CopyableId'
import { Banner } from '../../components/ui/Banner'

export function TemporalPanel({ analysisId, filters, onChange, compact = false }: {
  analysisId?: string; filters: ObservationFilters; onChange: (value: ObservationFilters) => void; compact?: boolean
}) {
  const calendar = useNativeCalendar(analysisId)
  const periods = calendar.data?.periods ?? []
  const rows = periods.map((period) => ({ ...period, ...summarizeCounts(period.counts_by_source.filter((source) => !filters.sourceId || source.source_id === filters.sourceId)) }))
  const max = rows.reduce((value, row) => row.value !== null && row.value > value ? row.value : value, 1n)
  return <section className={`geo-temporal ${compact ? 'geo-temporal-compact' : ''}`} aria-label="Temporal analysis">
    <header><div><span className="fb-eyebrow"><CalendarDays size={13} />TEMPORAL INVENTORY</span><h3>Detections over time</h3></div>
      <span className="geo-metadata-note">{filters.start || filters.endExclusive ? `${filters.start || 'Saved start'} → ${filters.endExclusive || 'Saved end'} · end excluded` : 'Full saved interval'} · UTC</span></header>
    <p>Choose a period to inspect matching records on the map and in the table. Unknown inventory is marked with a dash.</p>
    <ApiError error={calendar.error} retry={() => { void calendar.refetch() }} />
    {calendar.isError && calendar.data && <Banner tone="warning">Previously loaded temporal inventory is shown; the latest refresh failed.</Banner>}
    {!analysisId ? <Empty>Select an analysis to load its observation timeline.</Empty>
      : calendar.isPending ? <Skeleton height={132} label="Loading temporal inventory…" />
      : rows.length > 0 ? <div className="geo-timeline" aria-label="Available observation periods" data-dense={rows.length > 45 || undefined}>
        {rows.map((row, index) => {
          const start = row.start.slice(0, 10), end = row.end_exclusive.slice(0, 10)
          const dense = rows.length > 45
          const monthStart = dense && (start.endsWith('-01') || index === 0)
          const selected = filters.start === start && filters.endExclusive === end
          const label = row.value === null ? 'Unknown' : `${row.lowerBound ? '≥ ' : ''}${row.value.toLocaleString()}`
          return <button key={row.start} type="button" aria-pressed={selected} className={monthStart ? 'geo-month-start' : undefined} title={`${start}: ${label} records (UTC day)`}
            onClick={() => onChange({ ...filters, start: selected ? '' : start, endExclusive: selected ? '' : end })}>
            <strong>{label}</strong><span className={`geo-timeline-track ${row.value === null ? 'geo-unknown' : ''}`}><i style={{ height: `${row.value === null || row.value === 0n ? 0 : Math.max(2, Number(row.value * 10000n / max) / 100)}%` }} /></span>
            <time dateTime={row.start}>{dense ? new Date(row.start).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : start.slice(5)}</time><span className="sr-only">{start} until {end} exclusive</span>
          </button>
        })}
      </div> : !calendar.error && <Empty>No periods returned. Missing detections do not establish observation coverage.</Empty>}
    {calendar.data && <div className="geo-panel-foot"><Status value={calendar.data.status} /><span>Full saved interval · selected source · gaps remain unknown</span></div>}
  </section>
}

export function SourceComparison({ analysisId }: { analysisId?: string }) {
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const summary = useNativeSummary(analysisId)
  const sources = summary.data?.native_detections_by_source ?? []
  const displayed = selectedSources.length ? sources.filter((source) => selectedSources.includes(source.source_id)) : sources
  const max = sources.reduce((value, source) => source.count !== null && source.count_status !== 'unknown' && BigInt(source.count) > value ? BigInt(source.count) : value, 1n)
  return <section className="fb-section geo-source-comparison" aria-labelledby="source-comparison-heading">
    <span className="fb-eyebrow">SOURCE INVENTORIES / COMMON COUNT SCALE</span><h2 id="source-comparison-heading">Compare observation sources</h2>
    <p>Native inventories for the full saved analysis. Sensor sampling, resolution and detection methods differ; these counts are not a harmonized fire response.</p>
    <ApiError error={summary.error} retry={() => { void summary.refetch() }} />
    {sources.length > 1 && <fieldset className="platform-comparison-sources"><legend>Choose inventories · one common count scale</legend>{sources.map((source) => <label key={source.source_id}><input type="checkbox" checked={!selectedSources.length || selectedSources.includes(source.source_id)} disabled={selectedSources.length === 1 && selectedSources.includes(source.source_id)} onChange={() => {
      const current = selectedSources.length ? selectedSources : sources.map((item) => item.source_id)
      const next = current.includes(source.source_id) ? current.filter((id) => id !== source.source_id) : [...current, source.source_id]
      if (next.length) setSelectedSources(next)
    }} />{source.platform} · {source.product}</label>)}<button type="button" className="button button-secondary" disabled={!selectedSources.length} onClick={() => setSelectedSources([])}>Show all sources</button></fieldset>}
    {!analysisId ? <Empty>Select an analysis to compare its available source inventories.</Empty>
      : summary.isPending ? <Skeleton height={200} label="Loading source inventories…" />
      : sources.length ? <div className="geo-source-grid">{displayed.map((source) => {
        const count = source.count === null || source.count_status === 'unknown' ? null : BigInt(source.count)
        const sensor = sensorMeta(source.platform, source.product, source.source_id)
        return <article key={source.source_id} style={{ '--sensor': sensor.color } as CSSProperties}><span className="fb-eyebrow">{sensor.instrument} · {source.product} · C{source.collection}</span><h3><i className="geo-sensor-dot" aria-hidden="true" />{sensor.key === 'other' ? source.platform : sensor.label}</h3>
          <strong className="geo-source-count">{count === null ? 'Unknown' : `${source.count_status === 'lower_bound' ? '≥ ' : ''}${count.toLocaleString()}`}</strong><span>native detection records</span>
          <div className="geo-source-track" aria-hidden="true"><i style={{ width: `${count === null ? 0 : Number(count * 10000n / max) / 100}%` }} /></div>
          <dl><div><dt>Processing stream</dt><dd>{source.processing_stream}</dd></div><div><dt>Inventory</dt><dd>{source.inventory_status}</dd></div><div><dt>Count status</dt><dd>{source.count_status}</dd></div></dl>
          <CopyableId value={source.source_id} label="source ID" /><details className="fw-source-identifier"><summary>Full source identifier</summary><code>{source.source_id}</code></details>
        </article>
      })}</div> : !summary.error && <Empty>No source inventories were returned.</Empty>}
    {analysisId && <p className="platform-comparison-footnote">The common scale remains fixed to the available source maximum when hiding an inventory. <Link to={`/api-analysis?analysis=${encodeURIComponent(analysisId)}`}>Open prepared comparison tools</Link> for server-supported resolutions and metrics.</p>}
  </section>
}
