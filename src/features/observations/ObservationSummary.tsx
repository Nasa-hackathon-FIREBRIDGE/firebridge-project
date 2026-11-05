import { CalendarDays, Database, ScanLine } from 'lucide-react'
import { ApiError } from '../analyses/Feedback'
import { useNativeSummary, useRelease } from './useResults'

export function ObservationSummary({
  analysisId,
  releaseId,
}: {
  analysisId?: string
  releaseId?: string
}) {
  const summary = useNativeSummary(analysisId)
  const release = useRelease(releaseId)
  const count = summary.data?.native_detections_by_source.reduce(
    (total, source) => total + BigInt(source.count),
    0n,
  )
  return (
    <>
      <div className="fb-data-strip" aria-label="Selected analysis facts">
        <div>
          <Database size={18} />
          <span>
            Native records<strong>{count === undefined ? '—' : count.toLocaleString()}</strong>
            <small>
              {summary.data
                ? 'Selected source inventory · lower bounds may apply'
                : 'Select an analysis to load its records'}
            </small>
          </span>
        </div>
        <div>
          <ScanLine size={18} />
          <span>
            Source streams
            <strong>{summary.data ? summary.data.native_detections_by_source.length : '—'}</strong>
            <small>Separate native sensor records</small>
          </span>
        </div>
        <div>
          <CalendarDays size={18} />
          <span>
            Observation coverage<strong>{summary.data?.coverage.status ?? 'Not assessed'}</strong>
            <small>Detection counts do not establish coverage</small>
          </span>
        </div>
      </div>
      <ApiError
        error={summary.error}
        retry={() => {
          void summary.refetch()
        }}
      />
      {release.data && (
        <div className="fb-release-ribbon">
          <span className="fb-release-label">PINNED DATASET</span>
          <strong>{release.data.name}</strong>
          <span>
            {release.data.scope_key} / {release.data.dataset_kind}
          </span>
        </div>
      )}
      <ApiError
        error={release.error}
        retry={() => {
          void release.refetch()
        }}
      />
    </>
  )
}
