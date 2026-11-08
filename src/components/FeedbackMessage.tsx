import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { Banner } from './ui/Banner'
import { Button } from './ui/Button'
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
    <Banner tone="error" className="astra-feedback fb-feedback fb-error" role="alert">
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
          <Button variant="secondary" type="button" onClick={retry}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </Button>
        )}
      </div>
    </Banner>
  )
}
