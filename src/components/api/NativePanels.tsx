import { useState } from 'react'
import { useDetections, useNativeCalendar, useNativeSummary, useProvenance } from '../../hooks/useDataApi'
import type { CalendarQuery, DetectionQuery, PageQuery } from '../../services/data.types'
import { Facts, Filters, Limitations, Pager, Records, ResourcePanel } from './ApiPrimitives'
import { useCursorPage } from '../../hooks/useCursorPage'

export function SummaryPanel({ id }: { id: string }) {
  const query = useNativeSummary(id)
  return <ResourcePanel title="Résumé de l’analyse" query={query}>{(data) => <>
    <Facts values={{ Analyse: data.analysis_id, 'Version satellite': data.data_release_id, Métrique: data.metric_key, 'Réponse comparable': data.comparable_response?.value, 'Couverture': data.coverage?.fraction }} />
    <Records rows={data.native_detections_by_source} />
    <p>Un compte inconnu reste inconnu : il ne devient pas zéro. Les détections ne sont pas un inventaire d’incendies uniques.</p>
    <Limitations data={data} />
  </>}</ResourcePanel>
}
export function DetectionsPanel({ id }: { id: string }) {
  const [params, setParams] = useState<DetectionQuery>({ limit: 20 })
  return <><Filters<DetectionQuery> fields={[
    { name: 'source_ids', label: 'Sources (identifiants séparés par des virgules)' },
    { name: 'start', label: 'Début UTC (ISO 8601)' }, { name: 'end_exclusive', label: 'Fin UTC exclusive (ISO 8601)' },
    { name: 'bbox', label: 'Emprise : ouest,sud,est,nord' },
    { name: 'limit', label: 'Points par page', type: 'number', min: 1, max: 5000, value: 20 },
  ]} onApply={setParams} /><DetectionPage key={JSON.stringify(params)} id={id} params={params} /></>
}
function DetectionPage({ id, params }: { id: string; params: DetectionQuery }) {
  const page = useCursorPage()
  const query = useDetections(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Détections natives" query={query}>{(data) => <>
    <Records rows={data.features.map((feature) => ({ ...feature.properties, longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] }))} />
    <p>{data.returned} point(s) sur cette page.{data.truncated && ' Résultat paginé : utiliser « Page suivante ».'}</p>
    <Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}
export function CalendarPanel({ id }: { id: string }) {
  const [params, setParams] = useState<CalendarQuery>({ resolution: 'day' })
  const query = useNativeCalendar(id, params)
  return <><Filters<CalendarQuery> fields={[{ name: 'resolution', label: 'Résolution', options: ['day', 'week', 'month'], value: 'day' }, { name: 'start_date', label: 'Premier jour', type: 'date' }, { name: 'end_date_exclusive', label: 'Fin exclusive', type: 'date' }]} onApply={setParams} />
    <ResourcePanel title="Calendrier de l’analyse" query={query}>{(data) => <>
      <Records rows={data.periods.flatMap((period) => period.counts_by_source.map((source) => ({ début: period.start, fin_exclusive: period.end_exclusive, ...source })))} /><Limitations data={data} />
    </>}</ResourcePanel></>
}
export function ProvenancePanel({ id }: { id: string }) {
  const [params, setParams] = useState<PageQuery & { asset_id?: string }>({ limit: 20 })
  return <><Filters<PageQuery & { asset_id?: string }> fields={[{ name: 'asset_id', label: 'Filtrer un fichier source (UUID, facultatif)' }, { name: 'limit', label: 'Fichiers par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <ProvenancePage key={JSON.stringify(params)} id={id} params={params} /></>
}
function ProvenancePage({ id, params }: { id: string; params: PageQuery & { asset_id?: string } }) {
  const page = useCursorPage()
  const query = useProvenance(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Provenance et fichiers sources" query={query}>{(data) => <>
    <h3>Versions figées</h3><Records rows={data.data_versions} />
    <h3>Modèles</h3><Records rows={data.model_versions} empty="Aucun modèle associé." />
    <h3>Fichiers de cette page</h3><Records rows={data.assets} /><Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}

