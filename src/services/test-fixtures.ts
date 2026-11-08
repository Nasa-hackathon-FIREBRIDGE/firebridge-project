// Synthetic DTOs exclusively for isolated tests; never imported by application code.
import type {
  AnalysisAccepted,
  AnalysisView,
  AreaView,
  HealthReady,
  JobView,
} from '@firebridge/contracts'
export const timestamp = '2026-11-05T10:00:00Z'
export const areaFixture: AreaView = {
  id: 'a',
  name: 'TEST ONLY area',
  version: '1',
  geometry_sha256: 'test-hash',
  display_timezone: 'UTC',
  provenance: 'test',
  created_at: timestamp,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  surface_km2: 1,
  coverage: {
    weights_status: 'not_prepared',
    cells_count: 0,
    total_overlap_land_area_m2: 0,
    grid: null,
  },
}
export const acceptedFixture: AnalysisAccepted = {
  id: 'analysis',
  area_id: 'a',
  release_id: 'release',
  status: 'queued',
  metric_key: 'native_detections_v1',
  grid_id: null,
  data_mode: 'standard_only',
  start_date: '2024-01-01',
  end_date_exclusive: '2024-01-02',
  job_id: 'job',
  created_at: timestamp,
}
export const analysisFixture: AnalysisView = {
  ...acceptedFixture,
  time_basis: 'utc',
  components: [
    { component: 'satellite', release_id: 'release', status: 'ready', reasons: [] },
    { component: 'weather', release_id: null, status: 'missing', reasons: ['No weather release'] },
  ],
  job: { id: 'job', status: 'running', progress: { percent: 10 }, attempt: 1 },
  error_code: null,
  completed_at: null,
}
export const jobFixture: JobView = {
  id: 'job',
  kind: 'export',
  status: 'queued',
  progress: { stage: 'queued' },
  current_stage: 'queued',
  attempt: 0,
  max_attempts: 3,
  retryable: false,
  error_code: null,
  expires_at: null,
  created_at: timestamp,
  completed_at: null,
  analysis_id: 'analysis',
  download_url: null,
}
export const readyFixture: HealthReady = {
  status: 'error',
  service: 'firebridge-api',
  timestamp,
  checks: { database: 'ready', redis: 'ready', workers: 'not_checked', catalogue: 'unavailable' },
}
export const envelope = <T>(data: T) => ({
  schema_version: '1',
  request_id: 'test-request',
  warnings: [],
  data,
})
