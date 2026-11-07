import { ApiClientError } from './axios'

/** Only messages authored by the frontend may be displayed verbatim. */
export class UserInputError extends Error {
  readonly field?: string
  constructor(message: string, field?: string) {
    super(message)
    this.name = 'UserInputError'
    this.field = field
  }
}

export type ErrorContext = 'request' | 'analysis' | 'area' | 'job' | 'export' | 'catalogue'
export type Operation = 'read' | 'write'
const references = /^[a-zA-Z0-9._:-]{1,100}$/
export const safeReference = (value?: string) =>
  value && references.test(value) ? value : undefined

export function userFeedback(
  error: unknown,
  context: ErrorContext = 'request',
  operation: Operation = 'read',
) {
  const api = error instanceof ApiClientError ? error : undefined
  const result = (title: string, message: string, retryable = false) => ({
    title,
    message,
    retryable,
  })
  if (error instanceof UserInputError) return result('Check your input', error.message)
  const oversized =
    api?.code === 'VALIDATION_ERROR' && api.status === 400
      ? /^Polygon surface area \((\d+) km²\) exceeds the maximum allowed \(([\d,.]+) km²\)\.$/.exec(
          api.message,
        )
      : null
  if (oversized)
    return result(
      'Area is too large to save.',
      `Selected area: ${Number(oversized[1]).toLocaleString('en-US')} km². Maximum allowed: ${oversized[2]} km². Zoom in and draw a smaller boundary, or reduce your GeoJSON area, then save again.`,
    )
  if (api?.code === 'NO_COMPATIBLE_RELEASE')
    return result(
      'Satellite data is unavailable for these dates.',
      'No published satellite dataset covers the selected period. Try an earlier end date or check the data catalogue before requesting another analysis.',
    )
  if (api?.code === 'SOURCE_OUTSIDE_SCOPE')
    return result(
      'Source not available in this scope',
      'No ingestion feed is registered for this source and scope. You can still explore its published detection records.',
    )
  if (
    ['EXECUTION_FAILED', 'JOB_FAILED', 'ANALYSIS_FAILED', 'EVIDENCE_VALIDATION_FAILED'].includes(
      api?.code ?? '',
    )
  )
    return result(
      'Processing did not complete',
      'Review the selected area, dates and component availability. No automatic resubmission was made. If this continues, ask an operator to inspect the job.',
    )
  if (api?.status === 401 || api?.status === 403)
    return result(
      'Access could not be verified',
      'This operation requires an ingestion administrator token with permission for this action. Check the token with your administrator; do not share it in a report.',
    )
  if (api?.status === 404)
    return result(
      'This resource was not found. Check its identifier.',
      'The saved identifier may be incorrect or unavailable on this server. Open another record or check the copied link.',
    )
  if (api?.status === 410)
    return result(
      'This export or download link has expired.',
      'Request a new export from the analysis. An expired link cannot be reused.',
    )
  if (api?.status === 409)
    return result(
      'This request conflicts with the current state.',
      'Results or files may still be processing. Refresh their status before submitting another request.',
      operation === 'read',
    )
  if (
    api?.status === 400 ||
    api?.status === 422 ||
    ['VALIDATION_ERROR', 'INVALID_QUERY'].includes(api?.code ?? '')
  )
    return result(
      'Some details need attention',
      'Check the identifier, required fields, geometry and date range. The exclusive end date must come after the start date. Correct the form before submitting again.',
    )
  if (api?.status === 429)
    return result(
      'The server is receiving too many requests',
      'Wait a moment before trying again. Avoid submitting the same operation repeatedly.',
      operation === 'read',
    )
  const uncertain =
    operation === 'write'
      ? ' The server may have received the request. Check the saved area, analysis or job status before submitting again.'
      : ''
  if (api?.code === 'NETWORK_ERROR')
    return result(
      'We couldn’t connect to the server.',
      `Check your internet connection and try again.${uncertain}`,
      operation === 'read',
    )
  if (api?.code === 'TIMEOUT')
    return result(
      'The request took too long',
      `The server did not respond in time. Try again in a moment.${uncertain}`,
      operation === 'read',
    )
  if (api?.code === 'INVALID_RESPONSE')
    return result(
      'We couldn’t read the server response',
      'The response did not match the expected data format. Refresh once; if this continues, share the support reference with your administrator.',
      operation === 'read',
    )
  if (api?.status === 503)
    return result(
      'The data service is not ready yet',
      `The server cannot serve this request right now. Check service availability and try again later.${uncertain}`,
      operation === 'read',
    )
  const subject = {
    request: 'this request',
    analysis: 'your analysis',
    area: 'the study area',
    job: 'the processing job',
    export: 'the export',
    catalogue: 'the data catalogue',
  }[context]
  return result(
    `We couldn’t complete ${subject}`,
    `Something went wrong. Try again later, or share the support reference with your administrator.${uncertain}`,
    operation === 'read',
  )
}

/** Deliberately excludes raw bodies, URLs, tokens, arbitrary messages and paths. */
export function logDiagnostic(error: unknown, context: string) {
  const api = error instanceof ApiClientError ? error : undefined
  if (error instanceof UserInputError) return
  console.error('[Astra]', {
    context,
    type: api ? 'ApiClientError' : 'UnexpectedError',
    code: safeReference(api?.code),
    status: api?.status,
    requestId: safeReference(api?.requestId),
  })
}
