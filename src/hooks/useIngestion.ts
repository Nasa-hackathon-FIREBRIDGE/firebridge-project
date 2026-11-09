import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiKeys } from '../services/api.keys'
import { ingestion } from '../services/ingestion.service'
import type { BackfillInput, GapsQuery, RefreshInput, SubscriptionsQuery } from '../services/data.types'
import { workspaceKeys } from './useWorkspace'
import { jobs } from '../services/jobs.service'

export interface AdminSession { id: string; token: string; controller: AbortController }
export function useIngestionJob(session: AdminSession, id: string) {
  return useQuery({
    queryKey: apiKeys.admin(session.id, 'plan-job', { id }),
    queryFn: ({ signal }) => jobs.get(id, signal),
    enabled: !!id, gcTime: 0, retry: false,
    refetchInterval: (query) => query.state.status !== 'error' && query.state.data &&
      ['queued', 'running'].includes(query.state.data.status) &&
      query.state.data.current_stage !== 'awaiting_fetch_executor' ? 3000 : false,
  })
}
export function useSubscriptions(session: AdminSession, params: SubscriptionsQuery) {
  return useQuery({ queryKey: apiKeys.admin(session.id, 'subscriptions', params),
    queryFn: ({ signal }) => ingestion.subscriptions(session.token, params, signal), gcTime: 0, retry: false })
}
export function useIngestionGaps(session: AdminSession, params: GapsQuery) {
  return useQuery({ queryKey: apiKeys.admin(session.id, 'gaps', params),
    queryFn: ({ signal }) => ingestion.gaps(session.token, params, signal), gcTime: 0, retry: false })
}
export function useFetchRun(session: AdminSession, id: string) {
  return useQuery({ queryKey: apiKeys.admin(session.id, 'run', { id }),
    queryFn: ({ signal }) => ingestion.run(session.token, id, signal), enabled: !!id, gcTime: 0, retry: false })
}
export function useIngestionActions(session: AdminSession) {
  const client = useQueryClient()
  const refreshLists = () => Promise.all([
    client.invalidateQueries({ queryKey: apiKeys.adminSession(session.id) }),
    client.invalidateQueries({ queryKey: workspaceKeys.jobs }),
  ])
  const backfill = useMutation({
    mutationFn: ({ input, key }: { input: BackfillInput; key: string }) =>
      ingestion.backfill(session.token, input, key, session.controller.signal),
    retry: false, gcTime: 0, onSuccess: refreshLists,
  })
  const refresh = useMutation({
    mutationFn: ({ id, input, key }: { id: string; input: RefreshInput; key: string }) =>
      ingestion.refresh(session.token, id, input, key, session.controller.signal),
    retry: false, gcTime: 0, onSuccess: refreshLists,
  })
  return { backfill, refresh }
}

