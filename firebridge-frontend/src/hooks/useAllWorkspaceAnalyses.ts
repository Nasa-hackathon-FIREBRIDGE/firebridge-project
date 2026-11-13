import { useQuery } from '@tanstack/react-query'
import { workspace, type AnalysisListItem } from '../services/workspace.service'
import { ApiClientError } from '../lib/axios'
import { workspaceKeys } from './useWorkspace'

/** Populate the saved-analysis selector completely, following the API's cursors. */
export function useAllWorkspaceAnalyses() {
  return useQuery({
    queryKey: [...workspaceKeys.analyses, 'all'],
    queryFn: async ({ signal }) => {
      const items = new Map<string, AnalysisListItem>()
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        signal.throwIfAborted()
        const page = await workspace.analyses('', cursor, signal)
        for (const item of page.items) items.set(item.id, item)
        cursor = page.nextCursor ?? undefined
        if (cursor && cursors.has(cursor))
          throw new ApiClientError('The saved-analysis list could not be completed. Please retry.', 'INVALID_PAGINATION')
        if (cursor) cursors.add(cursor)
      } while (cursor)
      return [...items.values()]
    },
    staleTime: 60_000,
  })
}
