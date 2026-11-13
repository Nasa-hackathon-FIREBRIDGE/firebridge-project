import { useState } from 'react'
import { useCell, useComparison, useCoverage, useReports, useWeather } from '../../hooks/useDataApi'
import type { ComparisonQuery, CoverageQuery, DateQuery, PageQuery, ReportsQuery, WeatherQuery } from '../../services/data.types'
import { Facts, Filters, Limitations, Pager, Records, ResourcePanel, StructuredValue } from './ApiPrimitives'
import { useCursorPage } from '../../hooks/useCursorPage'

export function CoveragePanel({ id }: { id: string }) {
  const [params, setParams] = useState<CoverageQuery>({})
  const query = useCoverage(id, params)
  return <><Filters<CoverageQuery> fields={[{ name: 'cell_id', label: 'Grid cell (optional)' }, { name: 'start_date', label: 'First day', type: 'date' }, { name: 'end_date_exclusive', label: 'Exclusive end', type: 'date' }]} onApply={setParams} />
    <ResourcePanel title="Observation coverage" query={query}>{(data) => <>
      <Facts values={{ 'Coverage status': data.observation_coverage_status, 'Coverage fraction': data.coverage_fraction, 'Eligible land × days (m²)': data.eligible_land_m2_days, 'Possible land × days (m²)': data.possible_land_m2_days, 'Observed cell-days': data.observed_cell_days, 'Estimated cell-days': data.estimated_cell_days, 'Missing cell-days': data.missing_cell_days }} />
      <p>Coverage requires fire masks and validated scientific inputs. Detection points alone never prove that there was no fire.</p><Limitations data={data} />
    </>}</ResourcePanel></>
}
export function CellPanel({ id }: { id: string }) {
  const [cellId, setCellId] = useState('')
  const [params, setParams] = useState<PageQuery & DateQuery>({ limit: 20 })
  return <><form className="api-form" onSubmit={(e) => { e.preventDefault(); setCellId(String(new FormData(e.currentTarget).get('cell')).trim()) }}>
    <label>Grid cell ID<input name="cell" required pattern="[1-9][0-9]{0,18}" /></label><button className="button button-primary">Inspect cell</button>
    </form>
    <Filters<PageQuery & DateQuery> fields={[{ name: 'start_date', label: 'First day', type: 'date' }, { name: 'end_date_exclusive', label: 'Exclusive end', type: 'date' }, { name: 'limit', label: 'Observations per page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    {cellId ? <CellPage key={cellId + JSON.stringify(params)} id={id} cellId={cellId} params={params} /> : <p>Choose a cell that belongs to the analysis grid.</p>}
  </>
}
function CellPage({ id, cellId, params }: { id: string; cellId: string; params: PageQuery & DateQuery }) {
  const page = useCursorPage()
  const query = useCell(id, cellId, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Grid cell detail" query={query}>{(data) => <>
    <StructuredValue value={data.cell} /><Records rows={data.observations ?? []} /><Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}
export function ComparisonPanel({ id }: { id: string }) {
  const [params, setParams] = useState<ComparisonQuery>({ view: 'native_counts', resolution: 'week' })
  const query = useComparison(id, params)
  return <><Filters<ComparisonQuery> fields={[{ name: 'view', label: 'Comparison type', options: ['native_counts', 'common_response', 'withheld_reference'], value: 'native_counts' }, { name: 'resolution', label: 'Resolution', options: ['week', 'month'], value: 'week' }]} onApply={setParams} />
    <ResourcePanel title="Sensor comparison" query={query}>{(data) => <>
      <Facts values={{ View: data.view, Metric: data.metric_key, Release: data.data_release_id }} />
      <StructuredValue value={Object.fromEntries(Object.entries(data).filter(([key]) => !['links', 'reasons', 'limitations', 'analysis_id', 'data_release_id', 'resolved_releases', 'area_id', 'area_geometry_sha256'].includes(key)))} /><Limitations data={data} />
    </>}</ResourcePanel></>
}
export function WeatherPanel({ id }: { id: string }) {
  const [params, setParams] = useState<WeatherQuery>({ context: 'both', resolution: 'hour', limit: 20 })
  return <><Filters<WeatherQuery> fields={[{ name: 'context', label: 'Context', options: ['historical', 'recent', 'both'], value: 'both' }, { name: 'resolution', label: 'Resolution', options: ['hour', 'day', 'period'], value: 'hour' }, { name: 'variables', label: 'Variables (comma-separated)' }, { name: 'limit', label: 'Measurements per page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <WeatherPage key={JSON.stringify(params)} id={id} params={params} /></>
}
function WeatherPage({ id, params }: { id: string; params: WeatherQuery }) {
  const page = useCursorPage()
  const query = useWeather(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Weather context" query={query}>{(data) => <>
    <Records rows={data.series.map((row) => ({ id: row.id, source: row.source_id, context: row.context_component, variable: row.variable, value: row.value, unit: row.unit, start: row.valid_start, end: row.valid_end, quality: row.quality_status, citation: row.citation }))} />
    <p>Measurements keep their native unit and support; they are not automatically an average over the area.</p>
    <Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}
export function ReportsPanel({ id }: { id: string }) {
  const [params, setParams] = useState<ReportsQuery>({ limit: 20 })
  return <><Filters<ReportsQuery> fields={[{ name: 'relation', label: 'Relation', options: ['candidate', 'consistent', 'conflicting', 'unresolved', 'rejected'] }, { name: 'review_status', label: 'Review', options: ['unreviewed', 'reviewed', 'rejected'] }, { name: 'limit', label: 'Reports per page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <ReportsPage key={JSON.stringify(params)} id={id} params={params} /></>
}
function ReportsPage({ id, params }: { id: string; params: ReportsQuery }) {
  const page = useCursorPage()
  const query = useReports(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Reports and events" query={query}>{(data) => <>
    <Records rows={data.reports.map((row) => ({ title: row.title, publisher: row.publisher, start: row.event_start, end_exclusive: row.event_end_exclusive, relation: row.relation, report_review: row.report_review_status, claim_review: row.claim_review_status, claim: row.claim_summary, report_id: row.report_id }))} />
    <p>A candidate or unreviewed report does not confirm a fire.</p>
    <Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}

