import type { ReactNode } from 'react'
import { ApiClientError } from '../../lib/axios'

export function ApiError({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null
  const api = error instanceof ApiClientError ? error : undefined
  const message =
    api?.status === 404
      ? 'This resource was not found. Check its identifier.'
      : api?.status === 410
        ? 'This export or download link has expired. Request a new export.'
        : api?.status === 409
          ? 'This request conflicts with the current state. Results or files may still be processing.'
          : api?.status === 503
            ? 'The API cannot serve this request yet. Check dependency readiness and try again.'
            : error instanceof Error
              ? error.message
              : 'The request could not be completed.'
  return (
    <div className="fb-feedback fb-error" role="alert">
      <strong>{message}</strong>
      {api && (
        <small>
          {api.code}
          {api.status ? ` · HTTP ${api.status}` : ''}
          {api.requestId ? ` · Request ${api.requestId}` : ''}
        </small>
      )}
      {retry && (
        <button className="button button-secondary" type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  )
}
export function Status({ value }: { value: string }) {
  return (
    <span className="fb-status" data-status={value}>
      {value.replaceAll('_', ' ')}
    </span>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="fb-empty">{children}</p>
}
