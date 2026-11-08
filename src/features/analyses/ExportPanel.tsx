import { useRef, useState, type FormEvent } from 'react'
import type { ExportFormat } from '@firebridge/contracts'
import { useCreateExport } from '../../hooks/useFirebridge'
import { createIdempotencyKey } from '../../services/analyses.service'
import { ApiError } from './Feedback'
import { JobPanel } from './JobPanel'
import { Button } from '../../components/ui/Button'
import { CopyableId } from '../../components/ui/CopyableId'

export function ExportPanel({ analysisId, available, metadata }: { analysisId: string; available: boolean; metadata?: { releaseId: string; start: string; endExclusive: string; areaName?: string } }) {
  const create = useCreateExport()
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [jobId, setJobId] = useState<string>()
  const intent = useRef<{ format: ExportFormat; key: string } | null>(null)
  const lock = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!available || lock.current) return
    if (intent.current?.format !== format) intent.current = { format, key: createIdempotencyKey() }
    lock.current = true
    try {
      const result = await create.mutateAsync({
        analysisId,
        input: { format },
        idempotencyKey: intent.current.key,
      })
      setJobId(result.job_id)
    } catch {
      /* Render the mutation error, preserving the intent key for a safe retry. */
    } finally {
      lock.current = false
    }
  }
  return (
    <section className="fb-section" aria-labelledby="exports-heading">
      <div className="fb-section-heading">
        <span className="fb-step">03</span>
        <div>
          <h2 id="exports-heading">Export results</h2>
          <p>Export the saved analysis. The worker prepares your file asynchronously.</p>
        </div>
      </div>
      <div className="geo-export-summary">
        <span className="fb-eyebrow">EXPORT SCOPE / FULL SAVED ANALYSIS</span>
        <p>Map inspection filters and loaded-page search do not change this export. The file includes the saved analysis interval and sources.</p>
        <dl><div><dt>Analysis</dt><dd><CopyableId value={analysisId} label="analysis ID" /></dd></div>
          {metadata && <><div><dt>Study area</dt><dd>{metadata.areaName ?? 'Saved study area'}</dd></div><div><dt>UTC interval</dt><dd>{metadata.start} → {metadata.endExclusive} · end excluded · UTC</dd></div><div><dt>Release</dt><dd><CopyableId value={metadata.releaseId} label="release ID" /></dd></div></>}
        </dl>
      </div>
      {!available && (
        <p className="fb-muted">
          Exports require a ready satellite component in a ready or partial native UTC analysis. The
          server also checks the published snapshot.
        </p>
      )}
      <form
        className="fb-load-form"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <label>
          File format
          <select
            aria-label="File format"
            value={format}
            disabled={create.isPending || !!jobId}
            onChange={(event) => {
              setFormat(event.target.value as ExportFormat)
              create.reset()
            }}
          >
            <option value="csv">CSV</option>
            <option value="geojson">GeoJSON</option>
            <option value="parquet">Parquet</option>
          </select>
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={!available || create.isPending || !!jobId}
          disabledReason={!available ? 'A ready satellite component in a ready or partial native UTC analysis is required.' : create.isPending ? 'An export request is being submitted.' : jobId ? 'Review the existing export job before starting a new request.' : undefined}
        >
          {create.isPending ? 'Requesting export…' : 'Prepare export'}
        </Button>
      </form>
      <div className="geo-export-formats" aria-label="Available export formats"><span><strong>CSV</strong> Tabular records</span><span><strong>GeoJSON</strong> Geographic features</span><span><strong>Parquet</strong> Columnar data</span></div>
      <ApiError context="export" operation="write" error={create.error} />
      {jobId && (
        <>
          <JobPanel key={jobId} id={jobId} allowDownload />
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setJobId(undefined)
              intent.current = null
              create.reset()
            }}
          >
            Start a new export request
          </button>
        </>
      )}
    </section>
  )
}
