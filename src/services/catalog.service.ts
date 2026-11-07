import type { ApiEnvelope } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
import type { ReleaseSummary } from './data.types'
import { checked, isRecord } from '../lib/api.validation'

export interface CatalogSource {
  source_id: string
  platform: string | null
  instrument: string | null
  product: string
  collection: string
  processing_stream: string
  availability_status: string
}

export interface CatalogView {
  scope_key: string
  sources: CatalogSource[]
  releases: ReleaseSummary[]
}

export const catalog = {
  async get(scopeKey?: string, signal?: AbortSignal): Promise<CatalogView> {
    const { data } = await api.get<ApiEnvelope<CatalogView>>('/catalog', {
      params: scopeKey ? { scope_key: scopeKey } : undefined,
      signal,
    })

    return checked(
      unwrap(data),
      (value) =>
        typeof value.scope_key === 'string' &&
        Array.isArray(value.sources) &&
        value.sources.every(
          (source) =>
            isRecord(source) &&
            ['source_id', 'product', 'collection', 'processing_stream'].every(
              (key) => typeof source[key] === 'string',
            ) &&
            (source.platform === null || typeof source.platform === 'string') &&
            (source.instrument === undefined ||
              source.instrument === null ||
              typeof source.instrument === 'string'),
        ) &&
        Array.isArray(value.releases) &&
        value.releases.every(
          (release) =>
            isRecord(release) && typeof release.id === 'string' && typeof release.name === 'string',
        ),
    )
  },
}
