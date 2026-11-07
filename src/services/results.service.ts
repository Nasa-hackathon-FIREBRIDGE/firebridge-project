import type { ApiEnvelope } from '@firebridge/contracts'
import api, { unwrap } from '../lib/axios'
import { checked, isRecord } from '../lib/api.validation'
import type {
  Catalogue,
  ContextRead,
  DetectionPage,
  Explanation,
  NativeCalendar,
  NativeSummary,
  ProvenancePage,
  PublishedRelease,
} from '../features/observations/types'

const text = (v: unknown): v is string => typeof v === 'string'
const count = (v: unknown) => text(v) && /^\d+$/.test(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const texts = (v: unknown) => Array.isArray(v) && v.every(text)
const source = (v: unknown) =>
  isRecord(v) &&
  ['source_id', 'platform', 'product', 'collection', 'processing_stream'].every((k) =>
    text(v[k]),
  ) &&
  (v.instrument === undefined || text(v.instrument))
const release = (v: Record<string, unknown>) =>
  ['id', 'name', 'scope_key', 'dataset_kind', 'code_version', 'config_sha256'].every((k) =>
    text(v[k]),
  ) &&
  date(v.published_at) &&
  (v.observation_cutoff === undefined || date(v.observation_cutoff))
const page = (v: Record<string, unknown>) =>
  text(v.analysis_id) && (v.next_cursor === null || text(v.next_cursor))
const explanation = (v: Record<string, unknown>) =>
  ['explanation_id', 'analysis_id', 'job_id', 'snapshot_sha256'].every((k) => text(v[k])) &&
  ['queued', 'running', 'succeeded', 'template_fallback', 'failed', 'cancelled'].includes(
    String(v.status),
  ) &&
  ['fr', 'en'].includes(String(v.language)) &&
  v.generation_mode === 'deterministic_template' &&
  date(v.created_at) &&
  (v.completed_at === null || date(v.completed_at)) &&
  (v.output === null || isRecord(v.output))
async function read<T>(
  path: string,
  valid: (v: Record<string, unknown>) => boolean,
  signal?: AbortSignal,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const response = await api.get<ApiEnvelope<T>>(path, { signal, params })
  return checked(unwrap(response.data), valid)
}
const analysisPath = (id: string) => `/analyses/${encodeURIComponent(id)}`
export const results = {
  catalogue: (signal?: AbortSignal) =>
    read<Catalogue>(
      '/catalog',
      (v) =>
        text(v.scope_key) &&
        Array.isArray(v.sources) &&
        v.sources.every(source) &&
        Array.isArray(v.releases) &&
        v.releases.every((r) => isRecord(r) && release(r)) &&
        isRecord(v.limits) &&
        ['max_aoi_vertices', 'max_aoi_area_km2', 'max_points_per_page'].every((k) =>
          finite(v.limits && (v.limits as Record<string, unknown>)[k]),
        ),
      signal,
    ),
  release: (id: string, signal?: AbortSignal) =>
    read<PublishedRelease>(`/releases/${encodeURIComponent(id)}`, release, signal),
  summary: (id: string, signal?: AbortSignal) =>
    read<NativeSummary>(
      analysisPath(id) + '/summary',
      (v) =>
        text(v.analysis_id) &&
        text(v.status) &&
        text(v.inventory_status) &&
        Array.isArray(v.native_detections_by_source) &&
        v.native_detections_by_source.every(
          (s) =>
            isRecord(s) &&
            source(s) &&
            (count(s.count) || (s.count === null && s.count_status === 'unknown')) &&
            (s.observed_count === null || count(s.observed_count)) &&
            text(s.count_status),
        ) &&
        isRecord(v.coverage) &&
        text(v.coverage.status) &&
        (v.coverage.fraction === null ||
          (finite(v.coverage.fraction) && v.coverage.fraction >= 0 && v.coverage.fraction <= 1)) &&
        texts(v.limitations),
      signal,
    ),
  detections: (
    id: string,
    sourceId: string | undefined,
    cursor: string | undefined,
    signal?: AbortSignal,
  ) =>
    read<DetectionPage>(
      analysisPath(id) + '/detections',
      (v) =>
        page(v) &&
        text(v.status) &&
        text(v.inventory_status) &&
        Number.isSafeInteger(v.returned) &&
        Array.isArray(v.features) &&
        v.returned === v.features.length &&
        v.features.every(
          (f) =>
            isRecord(f) &&
            f.type === 'Feature' &&
            isRecord(f.geometry) &&
            f.geometry.type === 'Point' &&
            Array.isArray(f.geometry.coordinates) &&
            f.geometry.coordinates.length === 2 &&
            f.geometry.coordinates.every(finite) &&
            Math.abs(f.geometry.coordinates[0]) <= 180 &&
            Math.abs(f.geometry.coordinates[1]) <= 90 &&
            isRecord(f.properties) &&
            ['detection_id', 'platform', 'source_id', 'processing_level'].every((k) =>
              text(f.properties && (f.properties as Record<string, unknown>)[k]),
            ) &&
            date(f.properties.acquired_at) &&
            (f.properties.frp_mw === null ||
              (finite(f.properties.frp_mw) && f.properties.frp_mw >= 0)) &&
            (f.properties.day_night === null || text(f.properties.day_night)),
        ),
      signal,
      { limit: 20, source_ids: sourceId, cursor },
    ),
  calendar: (id: string, signal?: AbortSignal) =>
    read<NativeCalendar>(
      analysisPath(id) + '/calendar',
      (v) =>
        text(v.analysis_id) &&
        text(v.status) &&
        Array.isArray(v.periods) &&
        v.periods.every(
          (p) =>
            isRecord(p) &&
            date(p.start) &&
            date(p.end_exclusive) &&
            Array.isArray(p.counts_by_source) &&
            p.counts_by_source.every((s) => isRecord(s) && (count(s.count) || (s.count === null && s.count_status === 'unknown')) && text(s.source_id)),
        ),
      signal,
    ),
  provenance: (id: string, cursor?: string, signal?: AbortSignal) =>
    read<ProvenancePage>(
      analysisPath(id) + '/provenance',
      (v) =>
        page(v) &&
        Array.isArray(v.data_versions) &&
        v.data_versions.every((r) => isRecord(r) && release(r)) &&
        Array.isArray(v.assets) &&
        v.assets.every(
          (a) =>
            isRecord(a) &&
            [
              'asset_id',
              'source_id',
              'role',
              'validation_status',
              'product',
              'citation',
              'license_info',
            ].every((k) => text(a[k])) &&
            text(a.sha256) &&
            /^[a-f0-9]{64}$/i.test(a.sha256),
        ),
      signal,
      { limit: 20, cursor },
    ),
  context: (
    id: string,
    kind: 'coverage' | 'comparison' | 'weather' | 'reports',
    signal?: AbortSignal,
  ) =>
    read<ContextRead>(
      analysisPath(id) + '/' + kind,
      (v) =>
        text(v.analysis_id) &&
        text(v.status) &&
        (v.reasons === undefined || texts(v.reasons)) &&
        (v.observation_coverage_status === undefined || text(v.observation_coverage_status)),
      signal,
    ),
  availability: (sourceId: string, scope: string, signal?: AbortSignal) =>
    read<Record<string, unknown>>(
      `/sources/${encodeURIComponent(sourceId)}/availability`,
      (v) => text(v.source_id),
      signal,
      { scope_key: scope },
    ),
  async createExplanation(id: string, key: string): Promise<Explanation> {
    return checked(
      unwrap(
        (
          await api.post<ApiEnvelope<Explanation>>(
            analysisPath(id) + '/explanations',
            { language: 'en', question: '' },
            { headers: { 'Idempotency-Key': key } },
          )
        ).data,
      ),
      explanation,
    )
  },
  explanation: (id: string, signal?: AbortSignal) =>
    read<Explanation>(`/explanations/${encodeURIComponent(id)}`, explanation, signal),
}
