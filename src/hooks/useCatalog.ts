import { useQuery } from '@tanstack/react-query'
import { apiKeys } from '../services/api.keys'
import { catalog } from '../services/catalog.service'

export function useCatalog(scopeKey?: string) {
  return useQuery({
    queryKey: apiKeys.catalog(scopeKey),
    queryFn: ({ signal }) => catalog.get(scopeKey, signal),
  })
}
