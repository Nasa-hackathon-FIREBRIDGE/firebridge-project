import type { ApiEnvelope, HealthLive, HealthReady } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
export const health = {
  async getHealthLive(signal?: AbortSignal): Promise<HealthLive> {
    return unwrap((await api.get<ApiEnvelope<HealthLive>>('/health/live', { signal })).data)
  },
  async getHealthReady(signal?: AbortSignal): Promise<HealthReady> {
    return unwrap((await api.get<ApiEnvelope<HealthReady>>('/health/ready', { signal })).data)
  },
}
