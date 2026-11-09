import type {
  AnalysisAccepted,
  AnalysisView,
  AreaView,
  ExportAccepted,
  HealthLive,
  HealthReady,
  JobView,
} from '@firebridge/contracts'
import { ApiClientError } from './axios'

type RecordValue = Record<string, unknown>
export const isRecord = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' && value.length > 0
const nullableText = (value: unknown) => value === null || text(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const nullableDate = (value: unknown) => value === null || date(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
export const analysisStatuses = ['queued', 'running', 'ready', 'partial', 'unsupported', 'failed']
export const jobStatuses = ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']
export function checked<T>(value: T, valid: (data: RecordValue) => boolean): T {
  if (!isRecord(value) || !valid(value))
    throw new ApiClientError('Unexpected API response data.', 'INVALID_RESPONSE')
  return value
}
const statusIn = (value: unknown, statuses: string[]) =>
  typeof value === 'string' && statuses.includes(value)
const ring = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length >= 4 &&
  value.every((p) => Array.isArray(p) && p.length >= 2 && p.every(finite))
const polygon = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0 && value.every(ring)
export const validGeometry = (value: unknown): boolean =>
  isRecord(value) &&
  (value.type === 'Polygon'
    ? polygon(value.coordinates)
    : value.type === 'MultiPolygon' &&
      Array.isArray(value.coordinates) &&
      value.coordinates.length > 0 &&
      value.coordinates.every(polygon))
export const validateLive = (data: HealthLive) =>
  checked(
    data,
    (d) => d.status === 'ok' && text(d.service) && finite(d.uptimeMs) && text(d.timestamp),
  )
export const validateReady = (data: HealthReady) =>
  checked(data, (d) => {
    const checks = d.checks
    return (
      statusIn(d.status, ['ok', 'error']) &&
      text(d.service) &&
      text(d.timestamp) &&
      isRecord(checks) &&
      ['database', 'redis'].every((key) => statusIn(checks[key], ['ready', 'unavailable'])) &&
      checks.workers === 'not_checked' &&
      (checks.catalogue === undefined || statusIn(checks.catalogue, ['ready', 'unavailable']))
    )
  })
export const validateArea = (data: AreaView) =>
  checked(
    data,
    (d) =>
      text(d.id) &&
      text(d.name) &&
      text(d.version) &&
      text(d.display_timezone) &&
      text(d.provenance) &&
      text(d.geometry_sha256) &&
      text(d.created_at) &&
      validGeometry(d.geometry) &&
      (d.coverage === undefined ||
        (isRecord(d.coverage) &&
          statusIn(d.coverage.weights_status, ['prepared', 'not_prepared']) &&
          finite(d.coverage.cells_count) &&
          finite(d.coverage.total_overlap_land_area_m2) &&
          (d.coverage.grid === null ||
            (isRecord(d.coverage.grid) &&
              text(d.coverage.grid.id) &&
              text(d.coverage.grid.version) &&
              finite(d.coverage.grid.cell_size_m))))),
  )
const analysis = (d: RecordValue) =>
  text(d.id) &&
  text(d.area_id) &&
  text(d.release_id) &&
  statusIn(d.status, analysisStatuses) &&
  text(d.metric_key) &&
  nullableText(d.grid_id) &&
  d.data_mode === 'standard_only' &&
  text(d.start_date) &&
  text(d.end_date_exclusive) &&
  text(d.created_at)
export const validateAccepted = (data: AnalysisAccepted) =>
  checked(data, (d) => analysis(d) && d.metric_key === 'native_detections_v1' &&
    d.grid_id === null && nullableText(d.job_id))
export const validateAnalysis = (data: AnalysisView) =>
  checked(
    data,
    (d) =>
      analysis(d) &&
      text(d.time_basis) &&
      nullableText(d.error_code) &&
      nullableText(d.completed_at) &&
      Array.isArray(d.components) &&
      d.components.every(
        (c) => isRecord(c) && text(c.component) && text(c.status) && nullableText(c.release_id),
      ) &&
      (d.job === null ||
        (isRecord(d.job) &&
          text(d.job.id) &&
          statusIn(d.job.status, jobStatuses) &&
          finite(d.job.attempt))),
  )
export const validateJob = (data: JobView) =>
  checked(
    data,
    (d) =>
      text(d.id) &&
      text(d.kind) &&
      statusIn(d.status, jobStatuses) &&
      text(d.current_stage) &&
      finite(d.attempt) &&
      finite(d.max_attempts) &&
      typeof d.retryable === 'boolean' &&
      nullableText(d.error_code) &&
      nullableDate(d.expires_at) &&
      nullableText(d.analysis_id) &&
      nullableText(d.download_url) &&
      text(d.created_at) &&
      nullableText(d.completed_at),
  )
export const validateExport = (data: ExportAccepted) =>
  checked(
    data,
    (d) =>
      text(d.job_id) &&
      text(d.analysis_id) &&
      statusIn(d.status, jobStatuses) &&
      statusIn(d.format, ['csv', 'geojson', 'parquet']) &&
      text(d.status_url) &&
      text(d.created_at),
  )
