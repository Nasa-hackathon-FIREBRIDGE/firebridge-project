import { getResource, segment } from './resource'
import type { PageQuery, ReleaseView, UpdatesQuery, UpdatesView } from './data.types'
export interface ReleaseQuery extends PageQuery { membership?: 'partitions' | 'assets' }
export const releases = {
  get: (id: string, params: ReleaseQuery = {}, signal?: AbortSignal) =>
    getResource<ReleaseView>(`/releases/${segment(id)}`, params, signal),
  updates: (params: UpdatesQuery, signal?: AbortSignal) =>
    getResource<UpdatesView>('/updates', params, signal),
}

