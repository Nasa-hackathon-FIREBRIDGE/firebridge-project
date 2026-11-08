import { QueryClient } from '@tanstack/react-query'
import { ApiClientError } from './axios'
export function retryApiQuery(failureCount: number, error: unknown) {
  if (!(error instanceof ApiClientError) || failureCount >= 2) return false
  return ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code) || (error.status !== undefined && [502, 503, 504].includes(error.status))
}
// The existing provider imports this one instance. Mutations never retry automatically.
export const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: retryApiQuery, retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000), refetchOnWindowFocus: false },
  mutations: { retry: false },
} })
