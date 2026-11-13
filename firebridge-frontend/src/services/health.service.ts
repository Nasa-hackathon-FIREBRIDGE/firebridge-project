import type { ApiEnvelope, HealthLive, HealthReady } from '@firebridge/contracts'
import api, { ApiClientError, unwrap } from '../lib/axios'
import { validateLive, validateReady } from '../lib/api.validation'
export const health = {
  async getHealthLive(signal?: AbortSignal): Promise<HealthLive> {
    return validateLive(
      unwrap((await api.get<ApiEnvelope<HealthLive>>('/health/live', { signal })).data),
    )
  },
  async getHealthReady(signal?: AbortSignal): Promise<HealthReady> {
    try {
      return validateReady(
        unwrap((await api.get<ApiEnvelope<HealthReady>>('/health/ready', { signal })).data),
      )
    } catch (error) {
      // 503 is an expected readiness result, with dependency checks, not liveness.
      if (error instanceof ApiClientError && error.status === 503) {
        const readiness = validateReady(unwrap(error.responseBody as ApiEnvelope<HealthReady>))
        if (readiness.status !== 'error')
          throw new ApiClientError('Unexpected readiness status for HTTP 503.', 'INVALID_RESPONSE')
        return readiness
      }
      throw error
    }
  },
}
