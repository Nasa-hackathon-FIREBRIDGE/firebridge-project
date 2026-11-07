import { useRef, useState, type FormEvent } from 'react'
import type { ExportFormat } from '@firebridge/contracts'
import { useCreateExport } from '../../hooks/useFirebridge'
import { createIdempotencyKey } from '../../services/analyses.service'
import { ApiError } from './Feedback'
import { JobPanel } from './JobPanel'

export function ExportPanel({ analysisId, available }: { analysisId: string; available: boolean }) {
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
          <p>The worker prepares the file asynchronously.</p>
        </div>
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
            disabled={create.isPending}
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
        <button
          type="submit"
          className="button button-primary"
          disabled={!available || create.isPending || !!jobId}
        >
          {create.isPending ? 'Requesting export…' : 'Prepare export'}
        </button>
      </form>
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
