import { CalendarDays, Database, ScanLine } from 'lucide-react'
import { ApiError } from '../analyses/Feedback'
import { useNativeSummary, useRelease } from './useResults'
import { summarizeCounts } from '../../lib/nativeCounts'
import { Banner } from '../../components/ui/Banner'
import { CopyableId } from '../../components/ui/CopyableId'
import { Skeleton } from '../../components/ui/Skeleton'

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
                ? analysisId && summary.isPending ? <Skeleton width={80} height={36} label="Loading native records…" /> : '—'
                : `${count.lowerBound ? '≥ ' : ''}${count.value.toLocaleString()}`}
            </strong>
            <small>
              {summary.data
                ? count?.value === null
                  ? 'Source inventory is incomplete; total unknown'
                  : count?.lowerBound
                    ? 'Lower bound · inventory is incomplete'
                    : 'Full saved analysis · source inventory'
                : waiting}
            </small>
          </span>
        </div>
        <div>
          <ScanLine size={18} />
          <span>
            Source streams
            <strong>{summary.data ? summary.data.native_detections_by_source.length : analysisId && summary.isPending ? <Skeleton width={48} height={36} label="Loading source streams…" /> : '—'}</strong>
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
      {summary.isError && summary.data && <Banner tone="warning">Previously loaded source inventory is shown; the latest refresh failed.</Banner>}
      {release.data && (
        <Banner className="fw-summary-release" title="PINNED DATASET">
          <strong>{release.data.name}</strong>
          <span>
            {release.data.scope_key} / {release.data.dataset_kind}
          </span>
          <CopyableId value={release.data.id} label="release ID" />
        </Banner>
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
