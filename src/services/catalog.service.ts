import type { ApiEnvelope } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
import type { ReleaseSummary } from './data.types'

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
  async get(
    scopeKey?: string,
    signal?: AbortSignal,
  ): Promise<CatalogView> {
    const { data } = await api.get<ApiEnvelope<CatalogView>>(
      '/catalog',
      {
        params: scopeKey ? { scope_key: scopeKey } : undefined,
        signal,
      },
    )

    return unwrap(data)
  },
}
