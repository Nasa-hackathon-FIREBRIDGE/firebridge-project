import { useEffect, useState } from 'react'
import { useDownloadExport, useJob } from '../../hooks/useFirebridge'
import { isRecord } from '../../lib/api.validation'
import { ApiError, Status } from './Feedback'
import { ApiClientError } from '../../lib/axios'
import { Button } from '../../components/ui/Button'
import { CopyableId } from '../../components/ui/CopyableId'
import { Skeleton } from '../../components/ui/Skeleton'

export function JobPanel({ id, allowDownload = false }: { id: string; allowDownload?: boolean }) {
  const query = useJob(id)
  const download = useDownloadExport()
  const [downloaded, setDownloaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const job = query.data
  const percent =
    job &&
    isRecord(job.progress) &&
    typeof job.progress.percent === 'number' &&
    Number.isFinite(job.progress.percent) &&
    job.progress.percent >= 0 &&
    job.progress.percent <= 100
      ? job.progress.percent
      : undefined
  const expired = !!job?.expires_at && Date.parse(job.expires_at) <= now
  useEffect(() => {
    if (!job?.expires_at || expired) return
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(Date.parse(job.expires_at) - now, 2_147_483_647)),
    )
    return () => window.clearTimeout(timer)
  }, [job?.expires_at, now, expired])
  async function save() {
    setDownloaded(false)
    try {
      const result = await download.mutateAsync({ id })
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloaded(true)
      download.reset()
    } catch {
      /* The mutation error is rendered below. */
    }
  }
  return (
    <div className="fb-job" aria-label={allowDownload ? 'Export job' : 'Analysis job'}>
      <div className="fb-health-heading">
        <h3>{allowDownload ? 'Export job' : 'Processing job'}</h3>
        <Button
          type="button"
          variant="secondary"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          Refresh job
        </Button>
      </div>
      <CopyableId value={id} label="job ID" />
      {query.isPending && <Skeleton height={100} label="Loading job…" />}
      <ApiError
        context="job"
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
      {job && (
        <>
          <div className="fb-job-state" aria-live="polite">
            <Status value={job.status} />
            <span>{stageLabel(job.current_stage, job.status)}</span>
          </div>
          <label className="fb-progress">
            {percent === undefined ? 'Progress not supplied' : `Reported progress ${percent}%`}
            {percent !== undefined && <progress max={100} value={percent} />}
          </label>
          <p className="fb-muted">
            Attempt {job.attempt} of {job.max_attempts}
            {['queued', 'running'].includes(job.status)
              ? ' · Updates every 3 seconds while this page is visible.'
              : ' · Automatic polling stopped.'}
          </p>
          {job.status === 'failed' && (
            <div className="fb-job-failure">
              <ApiError
                context={allowDownload ? 'export' : 'job'}
                operation="write"
                error={new ApiClientError('', 'EXECUTION_FAILED')}
              />
              <p className="fb-muted">
                Job failed.{' '}
                {job.retryable
                  ? 'The server allows recovery, but this workspace has no job retry action. Ask an operator to inspect it.'
                  : 'Automatic retries have stopped. Review the inputs before starting a new request.'}
              </p>
            </div>
          )}
          {job.status === 'partial' && (
            <p>Processing ended with partial results. Check component availability.</p>
          )}
          {job.status === 'cancelled' && <p>This job was cancelled.</p>}
          {allowDownload && (
            <>
              {job.expires_at && (
                <p className="fb-muted">
                  {expired ? 'Expired' : 'Expires'}: {new Date(job.expires_at).toLocaleString()}
                </p>
              )}
              {expired ? (
                <p role="status">Export expired. Request a new export.</p>
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={
                    query.isError ||
                    job.status !== 'succeeded' ||
                    !job.download_url ||
                    download.isPending
                  }
                  onClick={() => {
                    void save()
                  }}
                >
                  {download.isPending ? 'Downloading…' : 'Download file'}
                </button>
              )}
              {!expired && job.status !== 'succeeded' && (
                <p className="fb-muted">
                  Download becomes available only after the export succeeds.
                </p>
              )}
            </>
          )}
        </>
      )}
      <ApiError context="export" error={download.error} />
      {downloaded && <p role="status">File handed to your browser for download.</p>}
    </div>
  )
}

function stageLabel(stage: string, status: string) {
  const labels: Record<string, string> = {
    queued: 'Waiting for a worker',
    running: 'Processing',
    completed: 'Processing complete',
    succeeded: 'Processing complete',
    failed: 'Processing stopped',
    partial: 'Partial results available',
    cancelled: 'Cancelled',
    loading: 'Loading inputs',
    exporting: 'Preparing the file',
    validating: 'Validating inputs',
    preparing_history: 'Preparing archived observations for your selection',
    writing: 'Writing results',
  }
  return labels[stage] ?? labels[status] ?? 'Processing status received'
}
