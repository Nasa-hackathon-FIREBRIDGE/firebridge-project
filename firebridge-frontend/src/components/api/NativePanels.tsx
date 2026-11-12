import { useState } from 'react'
import { useDetections, useNativeCalendar, useNativeSummary, useProvenance } from '../../hooks/useDataApi'
import type { CalendarQuery, DetectionQuery, PageQuery } from '../../services/data.types'
import { Facts, Filters, Limitations, Pager, Records, ResourcePanel } from './ApiPrimitives'
import { useCursorPage } from '../../hooks/useCursorPage'

export function SummaryPanel({ id }: { id: string }) {
  const query = useNativeSummary(id)
  return <ResourcePanel title="Analysis summary" query={query}>{(data) => <>
    <Facts values={{ Analysis: data.analysis_id, 'Satellite release': data.data_release_id, Metric: data.metric_key, 'Comparable response': data.comparable_response?.value, Coverage: data.coverage?.fraction }} />
    <Records rows={data.native_detections_by_source} />
    <p>An unknown count stays unknown: it never becomes zero. Detections are not an inventory of distinct fires.</p>
    <Limitations data={data} />
  </>}</ResourcePanel>
}
export function DetectionsPanel({ id }: { id: string }) {
  const [params, setParams] = useState<DetectionQuery>({ limit: 20 })
  return <><Filters<DetectionQuery> fields={[
    { name: 'source_ids', label: 'Sources (comma-separated IDs)' },
    { name: 'start', label: 'UTC start (ISO 8601)' }, { name: 'end_exclusive', label: 'Exclusive UTC end (ISO 8601)' },
    { name: 'bbox', label: 'Emprise : ouest,sud,est,nord' },
    { name: 'limit', label: 'Points per page', type: 'number', min: 1, max: 5000, value: 20 },
  ]} onApply={setParams} /><DetectionPage key={JSON.stringify(params)} id={id} params={params} /></>
}
function DetectionPage({ id, params }: { id: string; params: DetectionQuery }) {
  const page = useCursorPage()
  const query = useDetections(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Native detections" query={query}>{(data) => <>
    <Records rows={data.features.map((feature) => ({ ...feature.properties, longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] }))} />
    <p>{data.returned} point(s) on this page.{data.truncated && ' Paginated result: use “Next page”.'}</p>
    <Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}
export function CalendarPanel({ id }: { id: string }) {
  const [params, setParams] = useState<CalendarQuery>({ resolution: 'day' })
  const query = useNativeCalendar(id, params)
  return <><Filters<CalendarQuery> fields={[{ name: 'resolution', label: 'Resolution', options: ['day', 'week', 'month'], value: 'day' }, { name: 'start_date', label: 'First day', type: 'date' }, { name: 'end_date_exclusive', label: 'Exclusive end', type: 'date' }]} onApply={setParams} />
    <ResourcePanel title="Analysis calendar" query={query}>{(data) => <>
      <Records rows={data.periods.flatMap((period) => period.counts_by_source.map((source) => ({ start: period.start, end_exclusive: period.end_exclusive, ...source })))} /><Limitations data={data} />
    </>}</ResourcePanel></>
}
export function ProvenancePanel({ id }: { id: string }) {
  const [params, setParams] = useState<PageQuery & { asset_id?: string }>({ limit: 20 })
  return <><Filters<PageQuery & { asset_id?: string }> fields={[{ name: 'asset_id', label: 'Filter one source file (UUID, optional)' }, { name: 'limit', label: 'Files per page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <ProvenancePage key={JSON.stringify(params)} id={id} params={params} /></>
}
function ProvenancePage({ id, params }: { id: string; params: PageQuery & { asset_id?: string } }) {
  const page = useCursorPage()
  const query = useProvenance(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Provenance and source files" query={query}>{(data) => <>
    <h3>Frozen releases</h3><Records rows={data.data_versions} />
    <h3>Models</h3><Records rows={data.model_versions} empty="No associated model." />
    <h3>Files on this page</h3><Records rows={data.assets} /><Pager page={page} next={data.next_cursor} /><Limitations data={data} />
  </>}</ResourcePanel>
}

