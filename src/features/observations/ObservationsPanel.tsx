import { useMemo, useState } from 'react'
import { ArrowDown, Filter, Table2 } from 'lucide-react'
import { SectionHeading } from '../../components/workspace/SectionHeading'
import { ApiError, Empty, Status } from '../analyses/Feedback'
import { useDetections, useNativeCalendar, useNativeSummary } from './useResults'
import { summarizeCounts } from '../../lib/nativeCounts'
import { DetectionDetails } from './DetectionDetails'
import { Skeleton } from '../../components/ui/Skeleton'
import { Banner } from '../../components/ui/Banner'
import type { DetectionFeature } from './types'
import { validObservationInterval, type ObservationFilters } from './filters'

export function ObservationsPanel({ analysisId, filters }: { analysisId?: string; filters?: ObservationFilters }) {
  const [sourceId, setSourceId] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('time-desc')
  const [density, setDensity] = useState('compact')
  const [coordinates, setCoordinates] = useState(true)
  const [confidence, setConfidence] = useState(false)
  const [selected, setSelected] = useState<DetectionFeature | null>(null)
  const summary = useNativeSummary(analysisId)
  const intervalValid = !filters || validObservationInterval(filters)
  const detections = useDetections(analysisId, (filters?.sourceId ?? sourceId) || undefined, {
    start: filters?.start ? filters.start + 'T00:00:00Z' : undefined,
    end_exclusive: filters?.endExclusive ? filters.endExclusive + 'T00:00:00Z' : undefined,
  }, intervalValid)
  const loaded = useMemo(() => intervalValid ? detections.data?.pages.flatMap((page) => page.features) ?? [] : [], [detections.data, intervalValid])
  const features = useMemo(() => loaded.filter((feature) => [feature.properties.detection_id, feature.properties.platform, feature.properties.source_id, feature.properties.acquired_at].some((value) => value.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => {
    if (sort === 'frp-desc') return (b.properties.frp_mw ?? -1) - (a.properties.frp_mw ?? -1)
    return (sort === 'time-asc' ? 1 : -1) * a.properties.acquired_at.localeCompare(b.properties.acquired_at)
  }), [loaded, search, sort])
  return (
    <section
      className="fb-section fb-observations"
      id="observation-records"
      aria-labelledby="observations-heading"
    >
      <SectionHeading
        id="observations-heading"
        eyebrow="02 / RECORD EXPLORER"
        title="Observation records"
        description="Read the native records behind the map. A detection is not a unique fire incident."
        action={
          <span className="fb-table-tag">
            <Table2 size={14} />
            Database records
          </span>
        }
      />
      {!analysisId ? (
        <Empty>Choose an analysis to explore its saved source inventory.</Empty>
      ) : (
        <>
          <div className="fb-record-toolbar">
            {!filters &&
            <label>
              <Filter size={14} />
              <span className="sr-only">Filter observation source</span>
              <select
                aria-label="Filter observation source"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">All source streams</option>
                {summary.data?.native_detections_by_source.map((source) => (
                  <option key={source.source_id} value={source.source_id}>
                    {source.platform} · {source.product}
                  </option>
                ))}
              </select>
            </label>
            }
            <label><span className="sr-only">Search loaded records</span><input type="search" aria-label="Search loaded records" placeholder="Search loaded records…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <label><span className="sr-only">Sort loaded records</span><select aria-label="Sort loaded records" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="time-desc">Newest acquisition</option><option value="time-asc">Oldest acquisition</option><option value="frp-desc">Highest FRP · MW</option>
            </select></label>
            <label><span className="sr-only">Observation table density</span><select aria-label="Observation table density" value={density} onChange={(event) => setDensity(event.target.value)}><option value="compact">Compact rows</option><option value="comfortable">Comfortable rows</option></select></label>
            <details className="platform-observation-columns"><summary>Columns</summary><label><input type="checkbox" checked={coordinates} onChange={(event) => setCoordinates(event.target.checked)} />Coordinates</label><label><input type="checkbox" checked={confidence} onChange={(event) => setConfidence(event.target.checked)} />Raw confidence</label></details>
            <span>
              {features.length} of {loaded.length} loaded records{detections.hasNextPage ? ' · More available' : ''}
            </span>
          </div>
          <ApiError
            error={detections.error}
            retry={() => {
              void detections.refetch()
            }}
          />
          {detections.isPending && intervalValid && (
            <Skeleton height={160} label="Loading observation records…" />
          )}
          {detections.isError && detections.data && <Banner tone="warning">Previously loaded records are shown; the latest refresh failed.</Banner>}
          {features.length ? (
            <div className="platform-observation-layout" data-inspecting={!!selected}>
            <div className="fb-table-scroll">
              <table className={`fb-record-table platform-observations-${density}`}>
                <caption className="sr-only">
                  Native detection records from the selected analysis
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Record / UTC acquisition</th>
                    <th scope="col">Platform</th>
                    {coordinates && <><th scope="col">Longitude</th><th scope="col">Latitude</th></>}
                    <th scope="col">FRP, MW</th>
                    <th scope="col">Day / night</th>
                    {confidence && <th scope="col">Confidence · raw</th>}
                  </tr>
                </thead>
                <tbody>
                  {features.map((feature) => (
                    <tr key={feature.properties.detection_id} data-selected={selected?.properties.detection_id === feature.properties.detection_id}>
                      <td data-label="Record / UTC acquisition">
                        <button type="button" className="geo-record-link" aria-label={`Inspect detection ${feature.properties.detection_id}`} onClick={() => setSelected(feature)}><strong className="fb-record-id">#{feature.properties.detection_id}</strong></button>
                        <time dateTime={feature.properties.acquired_at}>
                          {feature.properties.acquired_at.replace('T', ' ')}
                        </time>
                      </td>
                      <td data-label="Platform / processing level">
                        {feature.properties.platform}
                        <small>{feature.properties.processing_level}</small>
                      </td>
                      {coordinates && <><td className="fb-numeric" data-label="Longitude">{feature.geometry.coordinates[0].toFixed(5)}</td><td className="fb-numeric" data-label="Latitude">{feature.geometry.coordinates[1].toFixed(5)}</td></>}
                      <td className="fb-numeric" data-label="FRP, MW">
                        {feature.properties.frp_mw === null ? (
                          <span className="fb-unmeasured">Not measured</span>
                        ) : (
                          feature.properties.frp_mw
                        )}
                      </td>
                      <td data-label="Day / night">{feature.properties.day_night ?? 'Unknown'}</td>
                      {confidence && <td data-label="Confidence · raw">{feature.properties.confidence_raw ?? 'Not supplied'}<small>{feature.properties.confidence_scheme ?? 'Scheme not supplied'}</small></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected && loaded.some((feature) => feature.properties.detection_id === selected.properties.detection_id) && <DetectionDetails feature={selected} onClose={() => setSelected(null)} />}
            </div>
          ) : (
            !detections.isPending &&
            !detections.error && (
              <Empty>
                {intervalValid ? 'No loaded records match this selection. This does not establish an absence of fire.' : 'Correct the date interval to load observation records.'}
              </Empty>
            )
          )}
          <div className="fb-table-footer">
            <p>Search and sort apply to loaded records. Signed pagination preserves source and time filters.</p>
            {detections.hasNextPage && intervalValid && (
              <button
                type="button"
                className="button button-secondary"
                disabled={detections.isFetchingNextPage}
                onClick={() => {
                  void detections.fetchNextPage()
                }}
              >
                <ArrowDown size={14} />
                {detections.isFetchingNextPage ? 'Loading more…' : 'Load more records'}
              </button>
            )}
          </div>
        </>
      )}
      <NativeActivity analysisId={analysisId} sourceId={filters?.sourceId ?? sourceId} />
    </section>
  )
}

function NativeActivity({ analysisId, sourceId }: { analysisId?: string; sourceId?: string }) {
  const calendar = useNativeCalendar(analysisId)
  const rows = useMemo(
    () =>
      calendar.data?.periods.map((period) => ({
        start: period.start,
        ...summarizeCounts(period.counts_by_source.filter((source) => !sourceId || source.source_id === sourceId)),
      })) ?? [],
    [calendar.data, sourceId],
  )
  const max = rows.reduce(
    (value, row) => (row.value !== null && row.value > value ? row.value : value),
    1n,
  )
  return (
    <div className="fb-native-activity">
      <div>
        <h3>Native record activity</h3>
        <p>Full saved interval · selected source inventory. Missing coverage remains unknown.</p>
      </div>
      <ApiError
        error={calendar.error}
        retry={() => {
          void calendar.refetch()
        }}
      />
      {analysisId && calendar.isPending && <p role="status">Loading daily record counts…</p>}
      {rows.length > 0 && (
        <div
          className="fb-activity-bars"
          role="img"
          aria-label={rows
            .map(
              (row) =>
                `${row.start.slice(0, 10)}: ${row.value === null ? 'unknown' : `${row.lowerBound ? 'at least ' : ''}${row.value}`} records`,
            )
            .join('; ')}
        >
          {rows.map((row) => (
            <div key={row.start}>
              <span>
                {row.value === null
                  ? '—'
                  : `${row.lowerBound ? '≥ ' : ''}${row.value.toLocaleString()}`}
              </span>
              <div
                className={`fb-activity-track ${row.value === null ? 'astra-activity-unknown' : ''}`}
              >
                <i
                  style={{
                    height: `${row.value === null || row.value === 0n ? 0 : Math.max(2, Number((row.value * 10000n) / max) / 100)}%`,
                  }}
                />
              </div>
              <time dateTime={row.start}>{row.start.slice(5, 10)}</time>
            </div>
          ))}
        </div>
      )}
      {calendar.data && rows.length === 0 && (
        <Empty>
          No daily inventory counts were returned. Observation coverage remains unknown.
        </Empty>
      )}
      {calendar.data && <Status value={calendar.data.status} />}
    </div>
  )
}
