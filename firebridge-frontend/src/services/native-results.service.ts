import { getResource, segment } from './resource'
import type { CalendarQuery, CalendarView, DetectionQuery, DetectionsView, PageQuery, ProvenanceView, SummaryView } from './data.types'
const path = (id: string, endpoint: string) => `/analyses/${segment(id)}/${endpoint}`
export const nativeResults = {
  summary: (id: string, signal?: AbortSignal) => getResource<SummaryView>(path(id, 'summary'), {}, signal),
  detections: (id: string, params: DetectionQuery = {}, signal?: AbortSignal) =>
    getResource<DetectionsView>(path(id, 'detections'), params, signal),
  calendar: (id: string, params: CalendarQuery = {}, signal?: AbortSignal) =>
    getResource<CalendarView>(path(id, 'calendar'), params, signal),
  provenance: (id: string, params: PageQuery & { asset_id?: string } = {}, signal?: AbortSignal) =>
    getResource<ProvenanceView>(path(id, 'provenance'), params, signal),
}

