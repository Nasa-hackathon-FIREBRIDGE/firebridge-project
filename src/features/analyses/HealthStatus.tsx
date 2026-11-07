import { useHealthLive, useHealthReady } from '../../hooks/useFirebridge'
import { ApiError, Status } from './Feedback'
import { Activity } from 'lucide-react'

export function HealthStatus() {
  const live = useHealthLive()
  const ready = useHealthReady()
  return (
    <section className="fb-health" aria-label="API health">
      <div className="fb-health-heading">
        <h2>
          <Activity size={15} />
          System status
        </h2>
        <button
          type="button"
          className="button button-secondary"
          disabled={live.isFetching || ready.isFetching}
          onClick={() => {
            void live.refetch()
            void ready.refetch()
          }}
        >
          Refresh status
        </button>
      </div>
      <div className="fb-health-probes" aria-live="polite">
        <p>
          <strong>API process</strong>
          <Status value={live.isError ? 'unavailable' : live.isPending ? 'checking' : 'alive'} />
        </p>
        <p>
          <strong>Data readiness</strong>
          <Status
            value={
              ready.isError
                ? 'unavailable'
                : ready.isPending
                  ? 'checking'
                  : ready.data.status === 'ok'
                    ? 'ready'
                    : 'not_ready'
            }
          />
        </p>
      </div>
      {ready.data && (
        <details className="fb-health-details">
          <summary>Dependency checks</summary>
          <div className="fb-health-probes">
            {Object.entries(ready.data.checks).map(([key, value]) => (
              <p key={key}>
                <span>{key}</span>
                <Status value={value} />
              </p>
            ))}
          </div>
        </details>
      )}
      {ready.data?.status === 'error' && (
        <p className="fb-muted">
          The service responded, but its data dependencies are not ready. A missing published
          catalogue is a readiness condition.
        </p>
      )}
      {(live.error || ready.error) && (
        <div className="fb-health-errors">
          {live.error && (
            <div>
              <h3>API process check</h3>
              <ApiError error={live.error} />
            </div>
          )}
          {ready.error && (
            <div>
              <h3>Data readiness check</h3>
              <ApiError error={ready.error} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
