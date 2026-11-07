import { CalendarDays, Database, ScanLine } from 'lucide-react'
import { ApiError } from '../analyses/Feedback'
import { useNativeSummary, useRelease } from './useResults'
import { summarizeCounts } from '../../lib/nativeCounts'

export function ObservationSummary({
  analysisId,
  releaseId,
  status,
}: {
  analysisId?: string
  releaseId?: string
  status?: string
}) {
  const summary = useNativeSummary(analysisId)
  const release = useRelease(releaseId)
  const count = summary.data ? summarizeCounts(summary.data.native_detections_by_source) : undefined
  const waiting = analysisId
    ? summary.isError
      ? 'Records currently unavailable'
      : 'Loading native records…'
    : ['queued', 'running'].includes(status ?? '')
      ? 'Processing; satellite results are not ready yet'
      : status
        ? 'No ready satellite results are available'
        : 'Select an analysis to load its records'
  return (
    <>
      <div className="fb-data-strip" aria-label="Selected analysis facts">
        <div>
          <Database size={18} />
          <span>
            Native records
            <strong>
              {count?.value == null
                ? '—'
                : `${count.lowerBound ? '≥ ' : ''}${count.value.toLocaleString()}`}
            </strong>
            <small>
              {summary.data
                ? count?.value === null
                  ? 'Source inventory is incomplete; total unknown'
                  : count?.lowerBound
                    ? 'Lower bound · inventory is incomplete'
                    : 'Selected source inventory'
                : waiting}
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
