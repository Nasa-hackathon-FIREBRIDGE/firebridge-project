import type { ApiEnvelope } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'

export interface Resource<T> { data: T; warnings: string[]; requestId: string }
export function resource<T>(body: ApiEnvelope<T>): Resource<T> {
  return { data: unwrap(body), warnings: body.warnings, requestId: body.request_id }
}
export async function getResource<T>(
  path: string, params: object = {}, signal?: AbortSignal, token?: string,
): Promise<Resource<T>> {
  const response = await api.get<ApiEnvelope<T>>(path, {
    params, signal, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  })
  return resource(response.data)
}
export async function postResource<T>(
  path: string, input: object, key: string, signal?: AbortSignal, token?: string,
): Promise<Resource<T>> {
  const response = await api.post<ApiEnvelope<T>>(path, input, {
    signal, headers: { 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  return resource(response.data)
}
export const segment = encodeURIComponent

