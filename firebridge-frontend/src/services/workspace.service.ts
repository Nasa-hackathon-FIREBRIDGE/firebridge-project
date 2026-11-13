import type { AnalysisView, ApiEnvelope, AreaView, JobView } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
import {
  analysisStatuses,
  checked,
  isRecord,
  validateArea,
  validateJob,
} from '../lib/api.validation'

/** Exact list shapes from the existing Fastify controllers; no total is provided. */
export type AnalysisListItem = Omit<AnalysisView, 'components' | 'job' | 'error_code'>
export interface WorkspacePage<T> {
  items: T[]
  nextCursor: string | null
}
export type AnalysisFilter = '' | AnalysisView['status']
async function readPage<T>(
  path: string,
  collection: string,
  params: object,
  validate: (row: T) => T,
  signal?: AbortSignal,
): Promise<WorkspacePage<T>> {
  const response = await api.get<ApiEnvelope<Record<string, unknown>>>(path, { params, signal })
  const body = checked(
    unwrap(response.data),
    (value) =>
      Array.isArray(value[collection]) &&
      (value.nextCursor === null || typeof value.nextCursor === 'string'),
  )
  return {
    items: (body[collection] as T[]).map(validate),
    nextCursor: body.nextCursor as string | null,
  }
}
function validateListAnalysis(row: AnalysisListItem) {
  return checked(
    row,
    (value) =>
      ['id', 'area_id', 'release_id', 'start_date', 'end_date_exclusive', 'created_at'].every(
        (key) => typeof value[key] === 'string' && !!value[key],
      ) &&
      analysisStatuses.includes(String(value.status)) &&
      value.metric_key === 'native_detections_v1' &&
      value.data_mode === 'standard_only' &&
      value.grid_id === null &&
      (value.completed_at === null || typeof value.completed_at === 'string'),
  )
}
export const workspace = {
  analyses: (status: AnalysisFilter, cursor?: string, signal?: AbortSignal) =>
    readPage<AnalysisListItem>(
      '/analyses',
      'analyses',
      { limit: 20, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) },
      validateListAnalysis,
      signal,
    ),
  areas: (cursor?: string, signal?: AbortSignal) =>
    readPage<AreaView>(
      '/areas',
      'areas',
      { limit: 6, ...(cursor ? { cursor } : {}) },
      validateArea,
      signal,
    ),
  jobs: (cursor?: string, signal?: AbortSignal) =>
    readPage<JobView>(
      '/jobs',
      'jobs',
      { limit: 6, ...(cursor ? { cursor } : {}) },
      (row) => {
        // List responses intentionally omit signed download URLs.
        if (isRecord(row) && row.download_url === undefined)
          return validateJob({ ...row, download_url: null })
        return validateJob(row)
      },
      signal,
    ),
}
