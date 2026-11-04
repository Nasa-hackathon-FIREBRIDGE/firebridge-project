/** JSON wire types for the ten integration endpoints mounted under /api/v1. */
export interface ApiEnvelope<T> {
  request_id: string; schema_version: '1'; data: T; warnings: string[];
  status?: 'ok' | 'error'; message?: string;
}
export interface HealthLive { status: 'ok'; service: string; uptimeMs: number; timestamp: string }
export interface HealthReady {
  status: 'ok' | 'error'; service: string; timestamp: string;
  checks: { database: 'ready' | 'unavailable'; redis: 'ready' | 'unavailable'; workers: 'not_checked'; catalogue?: 'ready' | 'unavailable' };
}
export interface PolygonGeometry { type: 'Polygon'; coordinates: number[][][] }
export interface MultiPolygonGeometry { type: 'MultiPolygon'; coordinates: number[][][][] }
export interface CreateAreaRequest { geometry: PolygonGeometry; name: string; version: string; display_timezone: string; provenance: string }
export interface AreaView {
  id: string; name: string; version: string; geometry_sha256: string; display_timezone: string; provenance: string; created_at: string;
  geometry: PolygonGeometry | MultiPolygonGeometry; surface_km2?: number;
  coverage?: { weights_status: 'prepared' | 'not_prepared'; cells_count: number; total_overlap_land_area_m2: number; grid: { id: string; version: string; cell_size_m: number } | null };
}
export type AnalysisStatus = 'queued' | 'running' | 'ready' | 'partial' | 'unsupported' | 'failed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export interface CreateAnalysisRequest {
  area_id: string; start_date: string; end_date_exclusive: string;
  time_basis?: 'utc' | 'local_solar' | 'observation_time'; selection_policy?: string; weighting_version?: string;
  baseline_spec?: Record<string, unknown> | null; weather_policy?: Record<string, unknown>; news_policy?: Record<string, unknown>;
  metric_key?: 'native_detections_v1'; grid_id?: null; data_mode?: 'standard_only';
}
export interface AnalysisAccepted {
  id: string; status: AnalysisStatus; area_id: string; release_id: string;
  metric_key: 'native_detections_v1'; grid_id: null; data_mode: 'standard_only';
  start_date: string; end_date_exclusive: string; job_id: string | null; created_at: string;
}
export interface AnalysisView extends Omit<AnalysisAccepted, 'job_id'> {
  time_basis: string;
  components: { component: string; release_id: string | null; status: string; reasons: unknown }[];
  job: { id: string; status: JobStatus; progress: unknown; attempt: number } | null;
  error_code: string | null; completed_at: string | null;
}
export interface JobView {
  id: string; kind: string; status: JobStatus; progress: unknown; current_stage: string;
  attempt: number; max_attempts: number; retryable: boolean; error_code: string | null;
  expires_at: string | null; created_at: string; completed_at: string | null; analysis_id: string | null;
  download_url: string | null;
}
export type ExportFormat = 'csv' | 'geojson' | 'parquet';
export interface CreateExportRequest { format: ExportFormat; filters?: { source_id?: string; day_night?: 'day' | 'night' | 'unknown' }; options?: Record<string, never> }
export interface ExportAccepted { job_id: string; analysis_id: string; status: JobStatus; format: ExportFormat; created_at: string; status_url: string }
export interface DetectionTileRequest { id: string; layer: 'detections'; z: number; x: number; y: number }
