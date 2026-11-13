import { useInfiniteQuery } from '@tanstack/react-query'
import { workspace, type AnalysisFilter, type WorkspacePage } from '../services/workspace.service'

export const workspaceKeys = {
  all: ['firebridge', 'workspace'] as const,
  analyses: ['firebridge', 'workspace', 'analyses'] as const,
  areas: ['firebridge', 'workspace', 'areas'] as const,
  jobs: ['firebridge', 'workspace', 'jobs'] as const,
}
const nextPage = <T>(page: WorkspacePage<T>) => page.nextCursor ?? undefined
export function useWorkspaceAnalyses(status: AnalysisFilter = '') {
  return useInfiniteQuery({
    queryKey: [...workspaceKeys.analyses, status],
    queryFn: ({ signal, pageParam }) => workspace.analyses(status, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
    refetchInterval: (query) =>
      query.state.status !== 'error' &&
      query.state.data?.pages.some((page) =>
        page.items.some((item) => ['queued', 'running'].includes(item.status)),
      )
        ? 3000
        : false,
  })
}
export function useWorkspaceAreas() {
  return useInfiniteQuery({
    queryKey: workspaceKeys.areas,
    queryFn: ({ signal, pageParam }) => workspace.areas(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
  })
}
export function useWorkspaceJobs() {
  return useInfiniteQuery({
    queryKey: workspaceKeys.jobs,
    queryFn: ({ signal, pageParam }) => workspace.jobs(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextPage,
    refetchInterval: (query) =>
      query.state.status !== 'error' &&
      query.state.data?.pages.some((page) =>
        page.items.some((item) => ['queued', 'running'].includes(item.status)),
      )
        ? 3000
        : false,
  })
}
