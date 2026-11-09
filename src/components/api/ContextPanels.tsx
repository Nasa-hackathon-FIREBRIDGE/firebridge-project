import { useState } from 'react'
import { useCell, useComparison, useCoverage, useReports, useWeather } from '../../hooks/useDataApi'
import type { ComparisonQuery, CoverageQuery, DateQuery, PageQuery, ReportsQuery, WeatherQuery } from '../../services/data.types'
import { Facts, Filters, Limitations, Pager, Records, ResourcePanel, StructuredValue } from './ApiPrimitives'
import { useCursorPage } from '../../hooks/useCursorPage'
import { externalReportUrl } from './format'

export function CoveragePanel({ id }: { id: string }) {
  const [params, setParams] = useState<CoverageQuery>({})
  const query = useCoverage(id, params)
  return <><Filters<CoverageQuery> fields={[{ name: 'cell_id', label: 'Cellule (facultative)' }, { name: 'start_date', label: 'Premier jour', type: 'date' }, { name: 'end_date_exclusive', label: 'Fin exclusive', type: 'date' }]} onApply={setParams} />
    <ResourcePanel title="Couverture d’observation" query={query}>{(data) => <>
      <Facts values={{ 'État de couverture': data.observation_coverage_status, 'Fraction de couverture': data.coverage_fraction, 'Surface admissible × jours': data.eligible_land_m2_days, 'Surface possible × jours': data.possible_land_m2_days, 'Cellules-jours observés': data.observed_cell_days, 'Cellules-jours estimés': data.estimated_cell_days, 'Cellules-jours manquants': data.missing_cell_days }} />
      <p>La couverture demande des masques et des entrées scientifiques validées. Les points seuls ne prouvent pas l’absence de feu.</p><Limitations data={data} />
    </>}</ResourcePanel></>
}
export function CellPanel({ id }: { id: string }) {
  const [cellId, setCellId] = useState('')
  const [params, setParams] = useState<PageQuery & DateQuery>({ limit: 20 })
  return <><form className="api-form" onSubmit={(e) => { e.preventDefault(); setCellId(String(new FormData(e.currentTarget).get('cell')).trim()) }}>
    <label>Identifiant de cellule<input name="cell" required pattern="[1-9][0-9]{0,18}" /></label><button className="button button-primary">Consulter la cellule</button>
    </form>
    <Filters<PageQuery & DateQuery> fields={[{ name: 'start_date', label: 'Premier jour', type: 'date' }, { name: 'end_date_exclusive', label: 'Fin exclusive', type: 'date' }, { name: 'limit', label: 'Observations par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    {cellId ? <CellPage key={cellId + JSON.stringify(params)} id={id} cellId={cellId} params={params} /> : <p>Choisir une cellule appartenant à la grille de l’analyse.</p>}
  </>
}
function CellPage({ id, cellId, params }: { id: string; cellId: string; params: PageQuery & DateQuery }) {
  const page = useCursorPage()
  const query = useCell(id, cellId, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Détail de cellule" query={query}>{(data) => <>
    <StructuredValue value={data.cell} /><Records rows={data.observations ?? []} /><Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}
export function ComparisonPanel({ id }: { id: string }) {
  const [params, setParams] = useState<ComparisonQuery>({ view: 'native_counts', resolution: 'week' })
  const query = useComparison(id, params)
  return <><Filters<ComparisonQuery> fields={[{ name: 'view', label: 'Type de comparaison', options: ['native_counts', 'common_response', 'withheld_reference'], value: 'native_counts' }, { name: 'resolution', label: 'Résolution', options: ['week', 'month'], value: 'week' }]} onApply={setParams} />
    <ResourcePanel title="Comparaison des capteurs" query={query}>{(data) => <>
      <Facts values={{ Vue: data.view, Métrique: data.metric_key, Version: data.data_release_id }} />
      <StructuredValue value={Object.fromEntries(Object.entries(data).filter(([key]) => !['links', 'reasons', 'limitations', 'analysis_id', 'data_release_id', 'resolved_releases', 'area_id', 'area_geometry_sha256'].includes(key)))} /><Limitations data={data} />
    </>}</ResourcePanel></>
}
export function WeatherPanel({ id }: { id: string }) {
  const [params, setParams] = useState<WeatherQuery>({ context: 'both', resolution: 'hour', limit: 20 })
  return <><Filters<WeatherQuery> fields={[{ name: 'context', label: 'Contexte', options: ['historical', 'recent', 'both'], value: 'both' }, { name: 'resolution', label: 'Résolution', options: ['hour', 'day', 'period'], value: 'hour' }, { name: 'variables', label: 'Variables (séparées par des virgules)' }, { name: 'limit', label: 'Mesures par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <WeatherPage key={JSON.stringify(params)} id={id} params={params} /></>
}
function WeatherPage({ id, params }: { id: string; params: WeatherQuery }) {
  const page = useCursorPage()
  const query = useWeather(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Contexte météo" query={query}>{(data) => <>
    <Records rows={data.series.map((row) => ({ identifiant: row.id, source: row.source_id, contexte: row.context_component, variable: row.variable, valeur: row.value, unité: row.unit, début: row.valid_start, fin: row.valid_end, qualité: row.quality_status, citation: row.citation }))} />
    <p>Les mesures conservent leur unité et leur support natif ; elles ne constituent pas automatiquement une moyenne sur la zone.</p>
    <Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}
export function ReportsPanel({ id }: { id: string }) {
  const [params, setParams] = useState<ReportsQuery>({ limit: 20 })
  return <><Filters<ReportsQuery> fields={[{ name: 'relation', label: 'Relation', options: ['candidate', 'consistent', 'conflicting', 'unresolved', 'rejected'] }, { name: 'review_status', label: 'Révision', options: ['unreviewed', 'reviewed', 'rejected'] }, { name: 'limit', label: 'Rapports par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <ReportsPage key={JSON.stringify(params)} id={id} params={params} /></>
}
function ReportsPage({ id, params }: { id: string; params: ReportsQuery }) {
  const page = useCursorPage()
  const query = useReports(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Rapports et événements" query={query}>{(data) => <>
    <Records rows={data.reports.map((row) => ({ titre: row.title, éditeur: row.publisher, début: row.event_start, fin_exclusive: row.event_end_exclusive, relation: row.relation, révision_du_rapport: row.report_review_status, révision_de_la_déclaration: row.claim_review_status, déclaration: row.claim_summary, report_id: row.report_id }))} />
    {data.reports.length > 0 && <section aria-label="Articles associés"><h3>Consulter les articles</h3>
      <ul>{[...new Map(data.reports.map((row) => [row.report_id, row])).values()].map((row) => {
        const url = externalReportUrl(row.url)
        return <li key={row.report_id}>{url
          ? <a href={url} target="_blank" rel="noopener noreferrer">{row.title} — ouvrir l’article</a>
          : <span>{row.title} — lien non disponible</span>}</li>
      })}</ul>
    </section>}
    <p>Un rapport candidat ou non révisé ne confirme pas un incendie.</p>
    <Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}

