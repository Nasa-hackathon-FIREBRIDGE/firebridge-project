import type { ApiEnvelope, AreaView, CreateAreaRequest } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
import { validateArea } from '../lib/api.validation'
export interface AreaCreation extends AreaView {
  created: boolean
}
export const areas = {
  async create(input: CreateAreaRequest, signal?: AbortSignal): Promise<AreaCreation> {
    const response = await api.post<ApiEnvelope<AreaView>>('/areas', input, { signal })
    return { ...validateArea(unwrap(response.data)), created: response.status === 201 }
  },
  async get(id: string, signal?: AbortSignal): Promise<AreaView> {
    return validateArea(
      unwrap(
        (await api.get<ApiEnvelope<AreaView>>(`/areas/${encodeURIComponent(id)}`, { signal })).data,
      ),
    )
  },
}
