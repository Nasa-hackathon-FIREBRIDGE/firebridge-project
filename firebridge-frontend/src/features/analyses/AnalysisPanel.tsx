import { UserInputError } from '../../lib/userFeedback'
import { ApiClientError } from '../../lib/axios'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AnalysisView } from '@firebridge/contracts'
import { useCreateAnalysis } from '../../hooks/useFirebridge'
import { createIdempotencyKey } from '../../services/analyses.service'
import { ApiError, Empty, Status } from './Feedback'
import { JobPanel } from './JobPanel'
import { validDateRange, validId } from './validation'
import { Button } from '../../components/ui/Button'
import { CopyableId } from '../../components/ui/CopyableId'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { requestDisabledReason, type WorkflowPresentation } from './workspace.presentation'

function reasonText(value: unknown): string {
  if (value == null || (Array.isArray(value) && !value.length))
    return 'No additional reason supplied'
  const reasons: Record<string, string> = {
    NO_WEATHER_RELEASE: 'No weather release is available for this analysis.',
    NO_REPORTS_RELEASE: 'No reports release is available for this analysis.',
    NO_COMPATIBLE_RELEASE: 'No compatible published dataset covers the selected period.',
    GRID_REQUIRED: 'A prepared grid is required for this component.',
    NO_OBSERVATION_MASKS: 'Observation masks have not been provided.',
    'No weather release': 'No weather release is available for this analysis.',
  }
  if (Array.isArray(value)) return [...new Set(value.map(reasonText))].join(' ')
  return typeof value === 'string' && reasons[value]
    ? reasons[value]
    : 'This component has incomplete or unavailable published inputs. Review its data provenance.'
}

export function AnalysisPanel({
  areaId,
  analysis,
  loading,
  error,
  onSelect,
  refresh,
  onWorkflowState,
}: {
  areaId?: string
  analysis?: AnalysisView
  loading: boolean
  error: unknown
  onSelect: (id: string) => void
  refresh: () => void
  onWorkflowState?: (state: WorkflowPresentation) => void
}) {
  const create = useCreateAnalysis()
  const [formError, setFormError] = useState<unknown>(null)
  const [dateDraft, setDateDraft] = useState({ start: '', end: '' })
  useEffect(() => { onWorkflowState?.({ ...dateDraft, pending: create.isPending }) }, [dateDraft, create.isPending, onWorkflowState])
  const disabledReason = requestDisabledReason(!!areaId, { ...dateDraft, pending: create.isPending })
  const changeStart = (start: string) => { setDateDraft(current => ({ ...current, start })); setFormError(null) }
  const changeEnd = (end: string) => { setDateDraft(current => ({ ...current, end })); setFormError(null) }
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
        new UserInputError(
          'Use valid dates; the exclusive end date must be after the start date.',
          'end',
        ),
      )
      const field = event.currentTarget.elements.namedItem('end')
      if (field instanceof HTMLElement) field.focus()
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
    <section className="fb-section fw-analysis-panel" aria-labelledby="analysis-heading">
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
          id="analysis-create-form"
          className="fb-form"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          <fieldset disabled={!areaId || create.isPending}>
            <DateRangePicker start={dateDraft.start} end={dateDraft.end} onStartChange={changeStart} onEndChange={changeEnd} disabled={!areaId || create.isPending} triggerLabel="Open analysis date picker">
            <div className="fb-field-pair">
              <label>
                Start date (UTC)
                <input name="start" type="date" required value={dateDraft.start} onChange={event => changeStart(event.target.value)} />
              </label>
              <label>
                End date, exclusive (UTC)
                <input
                  name="end"
                  aria-label="End date, exclusive (UTC)"
                  type="date"
                  required
                  value={dateDraft.end}
                  aria-invalid={formError instanceof UserInputError && formError.field === 'end'}
                  aria-describedby={
                    formError instanceof UserInputError && formError.field === 'end'
                      ? 'analysis-date-error'
                      : undefined
                  }
                  onChange={event => changeEnd(event.target.value)}
                />
                {formError instanceof UserInputError && formError.field === 'end' && (
                  <span className="fb-field-error" id="analysis-date-error">
                    Choose an end date after the start date. The end day is excluded.
                  </span>
                )}
              </label>
            </div>
            </DateRangePicker>
            <p className="fb-muted">
              Native detections v1 · Standard data only · No grid. The end date is excluded from the
              interval.
            </p>
            <Button type="submit" variant="primary" className="fw-primary-submit" disabled={!!disabledReason} disabledReason={disabledReason} loading={create.isPending}>
              {create.isPending ? 'Submitting analysis…' : 'Request analysis'}
            </Button>
          </fieldset>
        </form>
      </details>
      {!areaId && <p className="fb-muted">Save or open an area to enable analysis creation.</p>}
      <ApiError context="analysis" operation="write" error={formError} />
      {create.data && (
        <div className="fb-feedback" role="status">
          <strong>Analysis request accepted: {create.data.status}</strong>
          <span>
            Analysis <CopyableId value={create.data.id} label="accepted analysis ID" />
          </span>
          <span>
            Job {create.data.job_id ? <CopyableId value={create.data.job_id} label="accepted job ID" /> : 'No job returned'}
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
              setFormError(new UserInputError('Enter a valid analysis UUID.'))
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
      <ApiError context="analysis" error={error} retry={refresh} />
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
                <CopyableId value={analysis.id} label="analysis ID" />
              </dd>
            </div>
            <div>
              <dt>Release ID</dt>
              <dd>
                <CopyableId value={analysis.release_id} label="release ID" />
              </dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>
                {analysis.start_date} → {analysis.end_date_exclusive} · end excluded · UTC
              </dd>
            </div>
          </dl>
          {analysis.status === 'partial' && (
            <p className="fb-feedback">
              Partial analysis. Available components can be explored independently; missing
              components are not completed results.
            </p>
          )}
          {analysis.status === 'failed' && (
            <ApiError
              context="analysis"
              operation="write"
              error={new ApiClientError('', 'EXECUTION_FAILED')}
            />
          )}
          {analysis.components.length ? (
            <div className="fb-table-scroll">
              <table className="fw-component-table">
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
                      <th scope="row" data-label="Component">{component.component}</th>
                      <td data-label="Status">
                        <Status value={component.status} />
                      </td>
                      <td data-label="Reason">{reasonText(component.reasons)}</td>
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
                Processing status <Status value={analysis.job.status} />
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
