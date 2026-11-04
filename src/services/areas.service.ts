import type { ApiEnvelope, AreaView, CreateAreaRequest } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
export const areas = {
  async create(input: CreateAreaRequest, signal?: AbortSignal): Promise<AreaView> {
    return unwrap((await api.post<ApiEnvelope<AreaView>>('/areas', input, { signal })).data)
  },
  async get(id: string, signal?: AbortSignal): Promise<AreaView> {
    return unwrap((await api.get<ApiEnvelope<AreaView>>(`/areas/${encodeURIComponent(id)}`, { signal })).data)
  },
}
