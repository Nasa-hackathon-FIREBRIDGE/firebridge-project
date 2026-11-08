import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiKeys } from '../services/api.keys'
import { releases, type ReleaseQuery } from '../services/releases.service'
import { nativeResults } from '../services/native-results.service'
import { context } from '../services/context.service'
import { ingestion } from '../services/ingestion.service'
import { explanations } from '../services/explanations.service'
import type { AvailabilityQuery, CalendarQuery, ComparisonQuery, CoverageQuery, DateQuery, DetectionQuery, PageQuery, ReportsQuery, UpdatesQuery, WeatherQuery } from '../services/data.types'
import type { Resource } from '../services/resource'
import { workspaceKeys } from './useWorkspace'

function useAnalysisResource<T>(id: string, name: string, params: object, load: (signal: AbortSignal) => Promise<Resource<T>>, enabled = true) {
  return useQuery({ queryKey: apiKeys.result(id, name, params), queryFn: ({ signal }) => load(signal), enabled: !!id && enabled })
}
export function useRelease(id: string, params: ReleaseQuery = {}) {
  return useQuery({ queryKey: apiKeys.release(id, params), queryFn: ({ signal }) => releases.get(id, params, signal), enabled: !!id })
}
export function useUpdates(params: UpdatesQuery) {
  return useQuery({ queryKey: apiKeys.updates(params), queryFn: ({ signal }) => releases.updates(params, signal), enabled: !!params.scope_key })
}
export function useAvailability(sourceId: string, params: AvailabilityQuery) {
  return useQuery({ queryKey: apiKeys.availability(sourceId, params), queryFn: ({ signal }) => ingestion.availability(sourceId, params, signal), enabled: !!sourceId && !!params.scope_key })
}
export function useNativeSummary(id: string) {
  return useAnalysisResource(id, 'summary', {}, (signal) => nativeResults.summary(id, signal))
}
export function useDetections(id: string, params: DetectionQuery = {}) {
  return useAnalysisResource(id, 'detections', params, (signal) => nativeResults.detections(id, params, signal))
}
export function useNativeCalendar(id: string, params: CalendarQuery = {}) {
  return useAnalysisResource(id, 'calendar', params, (signal) => nativeResults.calendar(id, params, signal))
}
export function useProvenance(id: string, params: PageQuery & { asset_id?: string } = {}) {
  return useAnalysisResource(id, 'provenance', params, (signal) => nativeResults.provenance(id, params, signal))
}
export function useCoverage(id: string, params: CoverageQuery = {}) {
  return useAnalysisResource(id, 'coverage', params, (signal) => context.coverage(id, params, signal))
}
export function useCell(id: string, cellId: string, params: PageQuery & DateQuery = {}) {
  return useAnalysisResource(id, 'cell', { ...params, cell_id: cellId }, (signal) => context.cell(id, cellId, params, signal), !!cellId)
}
export function useComparison(id: string, params: ComparisonQuery = {}) {
  return useAnalysisResource(id, 'comparison', params, (signal) => context.comparison(id, params, signal))
}
export function useWeather(id: string, params: WeatherQuery = {}) {
  return useAnalysisResource(id, 'weather', params, (signal) => context.weather(id, params, signal))
}
export function useReports(id: string, params: ReportsQuery = {}) {
  return useAnalysisResource(id, 'reports', params, (signal) => context.reports(id, params, signal))
}
export function useCreateExplanation() {
  const client = useQueryClient()
  return useMutation({ mutationFn: explanations.create, retry: false, onSuccess: async ({ data }) => {
    if (data.job_id) await client.invalidateQueries({ queryKey: apiKeys.job(data.job_id), exact: true })
    await client.invalidateQueries({ queryKey: workspaceKeys.jobs })
  } })
}
export function useExplanation(id: string) {
  return useQuery({
    queryKey: apiKeys.explanation(id),

    queryFn: ({ signal }) =>
      explanations.get(id, signal),

    enabled: !!id,

    refetchInterval: (query) => {
      if (query.state.status === 'error') return false

      const status = query.state.data?.data.status

      return status && ['queued', 'running'].includes(status)
        ? 2000
        : false
    },
  })
}


