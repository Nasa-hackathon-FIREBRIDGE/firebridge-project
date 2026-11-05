import { useRef, useState, type FormEvent } from 'react'
import type { AnalysisView } from '@firebridge/contracts'
import { useCreateAnalysis } from '../../hooks/useFirebridge'
import { createIdempotencyKey } from '../../services/analyses.service'
import { ApiError, Empty, Status } from './Feedback'
import { JobPanel } from './JobPanel'
import { validDateRange, validId } from './validation'

function reasonText(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value || '—'
  if (Array.isArray(value)) return value.length ? value.map(reasonText).join('; ') : '—'
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length
      ? entries.map(([key, entry]) => `${key}: ${reasonText(entry)}`).join('; ')
      : '—'
  }
  return String(value)
}

export function AnalysisPanel({
  areaId,
  analysis,
  loading,
  error,
  onSelect,
  refresh,
}: {
  areaId?: string
  analysis?: AnalysisView
  loading: boolean
  error: unknown
  onSelect: (id: string) => void
  refresh: () => void
}) {
  const create = useCreateAnalysis()
  const [formError, setFormError] = useState<unknown>(null)
  const intent = useRef<{ payload: string; key: string } | null>(null)
  const lock = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || !areaId) return
    setFormError(null)
    const form = new FormData(event.currentTarget)
    const start_date = String(form.get('start'))
    const end_date_exclusive = String(form.get('end'))
    if (!validDateRange(start_date, end_date_exclusive)) {
      setFormError(
        new Error('Use valid dates; the exclusive end date must be after the start date.'),
      )
      return
    }
    const input = { area_id: areaId, start_date, end_date_exclusive }
    const payload = JSON.stringify(input)
    if (intent.current?.payload !== payload)
      intent.current = { payload, key: createIdempotencyKey() }
    lock.current = true
    try {
      const result = await create.mutateAsync({ input, idempotencyKey: intent.current.key })
      onSelect(result.id)
    } catch (reason) {
      setFormError(reason)
    } finally {
      lock.current = false
    }
  }
  return (
    <section className="fb-section" aria-labelledby="analysis-heading">
      <div className="fb-section-heading">
        <span className="fb-step">02</span>
        <div>
          <h2 id="analysis-heading">Run a native analysis</h2>
          <p>Select a UTC interval for the saved area.</p>
        </div>
      </div>
      <details className="fb-editor" id="analysis-editor" open={!analysis}>
        <summary>
          {analysis ? 'Request another analysis' : 'Set the analysis interval'}
          <span>UTC / Native counts</span>
        </summary>
        <form
          className="fb-form"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          <fieldset disabled={!areaId || create.isPending}>
            <div className="fb-field-pair">
              <label>
                Start date (UTC)
                <input name="start" type="date" required />
              </label>
              <label>
                End date, exclusive (UTC)
                <input name="end" type="date" required />
              </label>
            </div>
            <p className="fb-muted">
              Native detections v1 · Standard data only · No grid. The end date is excluded from the
              interval.
            </p>
            <button type="submit" className="button button-primary">
              {create.isPending ? 'Submitting analysis…' : 'Request analysis'}
            </button>
          </fieldset>
        </form>
      </details>
      {!areaId && <p className="fb-muted">Save or open an area to enable analysis creation.</p>}
      <ApiError error={formError} />
      {create.data && (
        <div className="fb-feedback" role="status">
          <strong>Analysis request accepted: {create.data.status}</strong>
          <span>
            Analysis <code>{create.data.id}</code>
          </span>
          <span>
            Job <code>{create.data.job_id ?? 'No job returned'}</code>
          </span>
        </div>
      )}
      <details className="fb-resource-loader">
        <summary>Open an existing analysis</summary>
        <form
          className="fb-load-form"
          onSubmit={(event) => {
            event.preventDefault()
            const value = String(new FormData(event.currentTarget).get('analysis-id')).trim()
            if (!validId(value)) {
              setFormError(new Error('Enter a valid analysis UUID.'))
              return
            }
            setFormError(null)
            create.reset()
            onSelect(value)
          }}
        >
          <label>
            Open existing analysis
            <input name="analysis-id" placeholder="Analysis UUID" required />
          </label>
          <button type="submit" className="button button-secondary">
            Open analysis
          </button>
        </form>
      </details>
      {loading && <p role="status">Loading analysis…</p>}
      <ApiError error={error} retry={refresh} />
      {analysis ? (
        <div className="fb-details">
          <div className="fb-health-heading">
            <h3>Analysis status</h3>
            <Status value={analysis.status} />
          </div>
          <dl>
            <div>
              <dt>Analysis ID</dt>
              <dd>
                <code>{analysis.id}</code>
              </dd>
            </div>
            <div>
              <dt>Release ID</dt>
              <dd>
                <code>{analysis.release_id}</code>
              </dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>
                {analysis.start_date} → {analysis.end_date_exclusive} (exclusive)
              </dd>
            </div>
          </dl>
          {analysis.status === 'partial' && (
            <p className="fb-feedback">
              Partial analysis. Available components can be explored independently; missing
              components are not completed results.
            </p>
          )}
          {analysis.error_code && <p role="alert">Analysis error: {analysis.error_code}</p>}
          {analysis.components.length ? (
            <div className="fb-table-scroll">
              <table>
                <caption>Component availability</caption>
                <thead>
                  <tr>
                    <th scope="col">Component</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.components.map((component) => (
                    <tr key={component.component}>
                      <th scope="row">{component.component}</th>
                      <td>
                        <Status value={component.status} />
                      </td>
                      <td>{reasonText(component.reasons)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No component statuses have been supplied.</Empty>
          )}
          {analysis.job ? (
            <details
              className="fb-job-details"
              open={['queued', 'running'].includes(analysis.job.status)}
            >
              <summary>
                Processing history <Status value={analysis.job.status} />
              </summary>
              <JobPanel key={analysis.job.id} id={analysis.job.id} />
            </details>
          ) : (
            <Empty>No processing job is attached to this analysis.</Empty>
          )}
        </div>
      ) : (
        !loading &&
        !error && <Empty>No analysis selected. Request an analysis or open its identifier.</Empty>
      )}
    </section>
  )
}
