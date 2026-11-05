/** Public read contracts verified against the existing Phase 1/3/5/6 handlers. */
export interface SourceDescriptor {
  source_id: string
  platform: string
  product: string
  collection: string
  instrument?: string
  processing_stream: string
}
export interface PublishedRelease {
  id: string
  name: string
  scope_key: string
  dataset_kind: string
  published_at: string
  observation_cutoff?: string
  code_version: string
  config_sha256: string
  source_composition?: SourceDescriptor[]
  validation_status?: string
}
export interface Catalogue {
  scope_key: string
  sources: SourceDescriptor[]
  releases: PublishedRelease[]
  limits: { max_aoi_vertices: number; max_aoi_area_km2: number; max_points_per_page: number }
}
export interface SourceCount extends SourceDescriptor {
  count: string
  observed_count: string
  inventory_status: string
  count_status: string
  citation?: string
  license_info?: string
}
export interface NativeSummary {
  analysis_id: string
  data_release_id: string
  status: string
  inventory_status: string
  native_detections_by_source: SourceCount[]
  coverage: { fraction: number | null; status: string; reasons: string[] }
  limitations: string[]
}
export interface DetectionFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    detection_id: string
    source_id: string
    platform: string
    acquired_at: string
    confidence_raw: string | null
    confidence_scheme: string | null
    day_night: string | null
    frp_mw: number | null
    processing_level: string
  }
}
export interface DetectionPage {
  analysis_id: string
  status: string
  inventory_status: string
  features: DetectionFeature[]
  returned: number
  next_cursor: string | null
}
export interface NativeCalendar {
  analysis_id: string
  status: string
  resolution: string
  periods: {
    start: string
    end_exclusive: string
    counts_by_source: { source_id: string; count: string; count_status: string }[]
  }[]
}
export interface ProvenancePage {
  analysis_id: string
  status: string
  data_versions: PublishedRelease[]
  assets: {
    asset_id: string
    source_id: string
    role: string
    sha256: string
    validation_status: string
    product: string
    citation: string
    license_info: string
  }[]
  next_cursor: string | null
}
export interface ContextRead {
  analysis_id: string
  status: string
  reasons?: string[]
  observation_coverage_status?: string
  coverage_fraction?: number | null
  series?: unknown[]
  reports?: unknown[]
  limitations?: string[]
}
export interface Explanation {
  explanation_id: string
  analysis_id: string
  job_id: string
  status: string
  language: 'fr' | 'en'
  generation_mode: 'deterministic_template'
  snapshot_sha256: string
  output: unknown
  created_at: string
  completed_at: string | null
}
