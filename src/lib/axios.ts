import axios from 'axios'
import type { ApiEnvelope } from '@firebridge/contracts'
import { env } from '../config/env'

export class ApiClientError extends Error {
  readonly code: string
  readonly status?: number
  readonly requestId?: string
  readonly retryAfterMs?: number
  readonly details?: unknown
  readonly responseBody?: unknown
  constructor(
    message: string,
    code: string,
    status?: number,
    requestId?: string,
    retryAfterMs?: number,
    details?: unknown,
    responseBody?: unknown,
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.retryAfterMs = retryAfterMs
    this.details = details
    this.responseBody = responseBody
  }
}
const api = axios.create({
  baseURL: env.api_url,
  timeout: 15_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  withCredentials: false,
})
api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (axios.isCancel(error)) throw error
    if (!axios.isAxiosError(error))
      throw new ApiClientError('Unexpected HTTP client error.', 'CLIENT_ERROR')
    const response = error.response
    let payload: unknown = response?.data
    if (typeof Blob !== 'undefined' && payload instanceof Blob && payload.type.includes('json')) {
      try {
        payload = JSON.parse(await payload.text())
      } catch {
        payload = undefined
      }
    }
    if (payload instanceof ArrayBuffer) {
      try {
        payload = JSON.parse(new TextDecoder().decode(payload))
      } catch {
        payload = undefined
      }
    }
    const body =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined
    const rawRetry = response?.headers['retry-after']
    const delay =
      rawRetry === undefined
        ? undefined
        : /^\d+$/.test(String(rawRetry))
          ? Number(rawRetry) * 1000
          : Math.max(0, Date.parse(String(rawRetry)) - Date.now())
    const timeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
    throw new ApiClientError(
      typeof body?.message === 'string'
        ? body.message
        : timeout
          ? 'API request timed out.'
          : response
            ? 'API request failed.'
            : 'Unable to reach the API.',
      typeof body?.code === 'string'
        ? body.code
        : timeout
          ? 'TIMEOUT'
          : response
            ? 'HTTP_ERROR'
            : 'NETWORK_ERROR',
      response?.status,
      typeof body?.request_id === 'string' ? body.request_id : response?.headers['x-request-id'],
      delay !== undefined && Number.isFinite(delay) ? delay : undefined,
      body?.data,
      body,
    )
  },
)
export function unwrap<T>(body: ApiEnvelope<T>): T {
  if (
    !body ||
    typeof body !== 'object' ||
    body.schema_version !== '1' ||
    typeof body.request_id !== 'string' ||
    !body.request_id ||
    body.status === 'error' ||
    body.data == null ||
    !Array.isArray(body.warnings) ||
    !body.warnings.every((warning) => typeof warning === 'string')
  )
    throw new ApiClientError('Unexpected API response format.', 'INVALID_RESPONSE')
  return body.data
}
export default api
