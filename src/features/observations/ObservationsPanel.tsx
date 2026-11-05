import { useMemo, useState } from 'react'
import { ArrowDown, Filter, Table2 } from 'lucide-react'
import { SectionHeading } from '../../components/workspace/SectionHeading'
import { ApiError, Empty, Status } from '../analyses/Feedback'
import { useDetections, useNativeCalendar, useNativeSummary } from './useResults'

export function ObservationsPanel({ analysisId }: { analysisId?: string }) {
  const [sourceId, setSourceId] = useState('')
  const summary = useNativeSummary(analysisId)
  const detections = useDetections(analysisId, sourceId || undefined)
  const features = detections.data?.pages.flatMap((page) => page.features) ?? []
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
            <span>
              {features.length} records loaded{detections.hasNextPage ? ' · More available' : ''}
            </span>
          </div>
          <ApiError
            error={detections.error}
            retry={() => {
              void detections.refetch()
            }}
          />
          {detections.isPending && (
            <p className="fb-loading-line" role="status">
              Loading observation records…
            </p>
          )}
          {features.length ? (
            <div className="fb-table-scroll">
              <table className="fb-record-table">
                <caption className="sr-only">
                  Native detection records from the selected analysis
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Record / UTC acquisition</th>
                    <th scope="col">Platform</th>
                    <th scope="col">Longitude</th>
                    <th scope="col">Latitude</th>
                    <th scope="col">FRP, MW</th>
                    <th scope="col">Day / night</th>
                  </tr>
                </thead>
                <tbody>
                  {features.map((feature) => (
                    <tr key={feature.properties.detection_id}>
                      <td>
                        <strong className="fb-record-id">#{feature.properties.detection_id}</strong>
                        <time dateTime={feature.properties.acquired_at}>
                          {feature.properties.acquired_at
                            .replace('T', ' ')
                            .replace(/\.\d+Z$/, ' UTC')}
                        </time>
                      </td>
                      <td>
                        {feature.properties.platform}
                        <small>{feature.properties.processing_level}</small>
                      </td>
                      <td className="fb-numeric">{feature.geometry.coordinates[0].toFixed(5)}</td>
                      <td className="fb-numeric">{feature.geometry.coordinates[1].toFixed(5)}</td>
                      <td className="fb-numeric">
                        {feature.properties.frp_mw === null ? (
                          <span className="fb-unmeasured">Not measured</span>
                        ) : (
                          feature.properties.frp_mw
                        )}
                      </td>
                      <td>{feature.properties.day_night ?? 'Unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !detections.isPending &&
            !detections.error && (
              <Empty>
                No records were returned for this selection. This does not establish an absence of
                fire.
              </Empty>
            )
          )}
          <div className="fb-table-footer">
            <p>Signed pagination preserves the saved analysis and source filter.</p>
            {detections.hasNextPage && (
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
      <NativeActivity analysisId={analysisId} />
    </section>
  )
}

function NativeActivity({ analysisId }: { analysisId?: string }) {
  const calendar = useNativeCalendar(analysisId)
  const rows = useMemo(
    () =>
      calendar.data?.periods.map((period) => ({
        start: period.start,
        count: period.counts_by_source.reduce((total, source) => total + BigInt(source.count), 0n),
      })) ?? [],
    [calendar.data],
  )
  const max = rows.reduce((value, row) => (row.count > value ? row.count : value), 1n)
  return (
    <div className="fb-native-activity">
      <div>
        <h3>Native record activity</h3>
        <p>Daily counts from the saved source inventory. Missing coverage remains unknown.</p>
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
            .map((row) => `${row.start.slice(0, 10)}: ${row.count.toString()} records`)
            .join('; ')}
        >
          {rows.map((row) => (
            <div key={row.start}>
              <span>{row.count.toLocaleString()}</span>
              <div className="fb-activity-track">
                <i
                  style={{
                    height: `${row.count === 0n ? 0 : Math.max(2, (Number(row.count) / Number(max)) * 100)}%`,
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
