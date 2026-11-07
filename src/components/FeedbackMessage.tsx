import { useEffect } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { ApiClientError } from '../lib/axios'
import {
  logDiagnostic,
  safeReference,
  userFeedback,
  type ErrorContext,
  type Operation,
} from '../lib/userFeedback'

export function FeedbackMessage({
  error,
  retry,
  context = 'request',
  operation = 'read',
}: {
  error: unknown
  retry?: () => void
  context?: ErrorContext
  operation?: Operation
}) {
  useEffect(() => {
    if (error) logDiagnostic(error, context)
  }, [error, context])
  if (!error) return null
  const feedback = userFeedback(error, context, operation)
  const reference = error instanceof ApiClientError ? safeReference(error.requestId) : undefined
  return (
    <div className="astra-feedback fb-feedback fb-error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <div className="astra-feedback-content">
        <strong>{feedback.title}</strong>
        <p>{feedback.message}</p>
        {reference && (
          <details>
            <summary>Support reference</summary>
            <code>{reference}</code>
          </details>
        )}
        {retry && feedback.retryable && (
          <button className="button button-secondary" type="button" onClick={retry}>
            <RotateCcw size={14} />
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
