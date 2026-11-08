import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { results } from '../../services/results.service'
import { useCatalog } from '../../hooks/useCatalog'
import { workspaceKeys } from '../../hooks/useWorkspace'

const key = (id: string | undefined, resource: string) =>
  ['firebridge', 'results', id ?? '', resource] as const
export function useCatalogue(enabled = true) {
  return useCatalog(undefined, { enabled, staleTime: 60_000 })
}
export function useRelease(id?: string) {
  return useQuery({
    queryKey: ['firebridge', 'release', id ?? ''],
    queryFn: ({ signal }) => results.release(id!, signal),
    enabled: !!id,
    staleTime: 60_000,
  })
}
export function useNativeSummary(id?: string) {
  return useQuery({
    queryKey: key(id, 'summary'),
    queryFn: ({ signal }) => results.summary(id!, signal),
    enabled: !!id,
  })
}
export function useNativeCalendar(id?: string) {
  return useQuery({
    queryKey: key(id, 'calendar'),
    queryFn: ({ signal }) => results.calendar(id!, signal),
    enabled: !!id,
  })
}
export function useDetections(id: string | undefined, sourceId?: string, interval?: { start?: string; end_exclusive?: string }, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...key(id, 'detections'), sourceId ?? 'all', interval?.start ?? '', interval?.end_exclusive ?? ''],
    queryFn: ({ signal, pageParam }) => results.detections(id!, sourceId, pageParam, signal, interval),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: !!id && enabled,
  })
}
export function useProvenance(id?: string) {
  return useInfiniteQuery({
    queryKey: key(id, 'provenance'),
    queryFn: ({ signal, pageParam }) => results.provenance(id!, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: !!id,
  })
}
export function useContextRead(
  id: string | undefined,
  kind: 'coverage' | 'comparison' | 'weather' | 'reports',
  enabled: boolean,
) {
  return useQuery({
    queryKey: key(id, kind),
    queryFn: ({ signal }) => results.context(id!, kind, signal),
    enabled: !!id && enabled,
  })
}
export function useCreateExplanation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => results.createExplanation(id, key),
    onSuccess: async (value) => {
      client.setQueryData(key(value.explanation_id, 'explanation'), value)
      await client.invalidateQueries({ queryKey: workspaceKeys.jobs })
    },
  })
}
export function useExplanation(id?: string) {
  return useQuery({
    queryKey: key(id, 'explanation'),
    queryFn: ({ signal }) => results.explanation(id!, signal),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.status !== 'error' &&
      q.state.data &&
      ['queued', 'running'].includes(q.state.data.status)
        ? 3000
        : false,
  })
}
export function useSourceAvailability(sourceId: string | undefined, scope?: string) {
  return useQuery({
    queryKey: ['firebridge', 'availability', scope ?? '', sourceId ?? ''],
    queryFn: ({ signal }) => results.availability(sourceId!, scope!, signal),
    enabled: !!sourceId && !!scope,
  })
}
