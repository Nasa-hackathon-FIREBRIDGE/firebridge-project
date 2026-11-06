import { getResource, postResource, segment } from './resource'
import type { AvailabilityQuery, AvailabilityView, BackfillInput, FetchRunView, GapsQuery, GapsView, IngestionPlan, RefreshInput, SubscriptionsQuery, SubscriptionsView } from './data.types'
const admin = '/admin/ingestion'
/** The token belongs to one temporary admin session; never set it on Axios defaults. */
export const ingestion = {
  availability: (sourceId: string, params: AvailabilityQuery, signal?: AbortSignal) =>
    getResource<AvailabilityView>(`/sources/${segment(sourceId)}/availability`, params, signal),
  subscriptions: (token: string, params: SubscriptionsQuery = {}, signal?: AbortSignal) =>
    getResource<SubscriptionsView>(`${admin}/subscriptions`, params, signal, token),
  gaps: (token: string, params: GapsQuery = {}, signal?: AbortSignal) =>
    getResource<GapsView>(`${admin}/gaps`, params, signal, token),
  run: (token: string, id: string, signal?: AbortSignal) =>
    getResource<FetchRunView>(`${admin}/runs/${segment(id)}`, {}, signal, token),
  backfill: (token: string, input: BackfillInput, key: string, signal?: AbortSignal) =>
    postResource<IngestionPlan>(`${admin}/backfills`, input, key, signal, token),
  refresh: (token: string, id: string, input: RefreshInput, key: string, signal?: AbortSignal) =>
    postResource<IngestionPlan>(`${admin}/subscriptions/${segment(id)}/refresh`, input, key, signal, token),
}

