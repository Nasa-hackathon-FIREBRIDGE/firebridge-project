import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateAreaRequest, DetectionTileRequest } from '@firebridge/contracts'
import { apiKeys } from '../services/api.keys'
import { health } from '../services/health.service'
import { areas } from '../services/areas.service'
import { analyses, type AnalysisMutation, type ExportMutation } from '../services/analyses.service'
import { jobs } from '../services/jobs.service'
export function useHealthLive() { return useQuery({ queryKey: apiKeys.health('live'), queryFn: ({ signal }) => health.getHealthLive(signal), staleTime: 10_000 }) }
export function useHealthReady() { return useQuery({ queryKey: apiKeys.health('ready'), queryFn: ({ signal }) => health.getHealthReady(signal), staleTime: 10_000 }) }
export function useArea(id: string | undefined) {
  return useQuery({ queryKey: apiKeys.area(id ?? ''), queryFn: ({ signal }) => areas.get(id!, signal), enabled: !!id })
}
export function useCreateArea() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (input: CreateAreaRequest) => areas.create(input), onSuccess: (area) => client.invalidateQueries({ queryKey: apiKeys.area(area.id), exact: true }) })
}
export function useAnalysis(id: string | undefined) {
  return useQuery({ queryKey: apiKeys.analysis(id ?? ''), queryFn: ({ signal }) => analyses.get(id!, signal), enabled: !!id,
    refetchInterval: (query) => query.state.data && ['queued', 'running'].includes(query.state.data.status) ? 2000 : false })
}
export function useCreateAnalysis() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (request: AnalysisMutation) => analyses.create(request), onSuccess: async (analysis) => {
    await client.invalidateQueries({ queryKey: apiKeys.analysis(analysis.id), exact: true })
    if (analysis.job_id) await client.invalidateQueries({ queryKey: apiKeys.job(analysis.job_id), exact: true })
  } })
}
export function useJob(id: string | undefined) {
  const client = useQueryClient()
  return useQuery({ queryKey: apiKeys.job(id ?? ''), queryFn: async ({ signal }) => {
    const job = await jobs.get(id!, signal)
    if (job.analysis_id && !['queued', 'running'].includes(job.status)) {
      void client.invalidateQueries({ queryKey: apiKeys.analysis(job.analysis_id), exact: true })
      void client.invalidateQueries({ queryKey: apiKeys.tiles(job.analysis_id) })
    }
    return job
  }, enabled: !!id, refetchInterval: (query) => query.state.data && ['queued', 'running'].includes(query.state.data.status) ? 2000 : false })
}
export function useDetectionTile(params: DetectionTileRequest, enabled = true) {
  return useQuery({ queryKey: apiKeys.tile(params), queryFn: ({ signal }) => analyses.tile(params, signal), enabled, staleTime: 60_000 })
}
export function useCreateExport() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (request: ExportMutation) => analyses.createExport(request), onSuccess: (job) => client.invalidateQueries({ queryKey: apiKeys.job(job.job_id), exact: true }) })
}
// Download is an explicit action; its bytes never accumulate in the query cache.
export function useDownloadExport() { return useMutation({ mutationFn: ({ id, signal }: { id: string; signal?: AbortSignal }) => jobs.download(id, signal), gcTime: 0 }) }
