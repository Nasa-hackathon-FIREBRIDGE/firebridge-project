/** Wire values: identifiers and bigint counts stay strings; null means unknown. */
export interface PageQuery { limit?: number; cursor?: string }
export interface DateQuery { start_date?: string; end_date_exclusive?: string }
export interface TimeQuery { start?: string; end_exclusive?: string }
export interface Page { returned?: number; next_cursor?: string | null }
export interface DataStatus {
  status?: string
  reasons?: string[]
  limitations?: string[]
}
export type Detail = Record<string, unknown>
export interface ReleaseSummary {
  id: string; name: string; scope_key: string; dataset_kind: string
  published_at: string; parent_release_id: string | null
}
export interface ReleaseView extends ReleaseSummary {
  validation_status: string
  membership: Page & { kind: 'partitions' | 'assets'; items: Detail[] }
  partition_counts: Detail[]; source_composition: Detail[]; change_summary: Detail[]
}
export interface UpdatesQuery {
  scope_key: string; after_release_id?: string
  component?: 'satellite' | 'weather' | 'reports'; alias?: string
}
export interface UpdatesView {
  scope_key: string; has_updates: boolean; comparison: string; history_complete: boolean
  current: Detail[]; changes: Detail[]; checked_at: string
}
export interface AnalysisData extends DataStatus {
  analysis_id: string; data_release_id: string; metric_key: string
  grid_id: string | null; resolved_releases: Detail[]
}
export interface SourceCount {
  source_id: string; platform?: string | null; count: string | null
  observed_count: string; count_status: string; inventory_status: string
}
export interface SummaryView extends AnalysisData {
  native_detections_by_source: SourceCount[]
  comparable_response: { value: number | null; status: string; reasons: string[] }
  coverage: { fraction: number | null; status: string; reasons: string[] }
}
export interface Detection {
  type: 'Feature'; geometry: { type: 'Point'; coordinates: number[] }
  properties: {
    detection_id: string; source_id: string; platform: string | null
    acquired_at: string; frp_mw: number | null; day_night: string | null
  }
}
export interface DetectionQuery extends PageQuery, TimeQuery { source_ids?: string; bbox?: string }
export interface DetectionsView extends AnalysisData, Page {
  features: Detection[]; truncated: boolean
}
export interface CalendarQuery extends DateQuery { resolution?: 'day' | 'week' | 'month' }
export interface CalendarView extends AnalysisData {
  resolution: string
  periods: { start: string; end_exclusive: string; counts_by_source: SourceCount[] }[]
}
export interface ProvenanceView extends AnalysisData, Page {
  assets: Detail[]; data_versions: Detail[]; model_versions: Detail[] | null
}
export interface CoverageQuery extends DateQuery { cell_id?: string }
export interface CoverageView extends AnalysisData {
  observation_coverage_status: string; coverage_fraction: number | null
  eligible_land_m2_days: number | null; possible_land_m2_days: number | null
  observed_cell_days: string | null; estimated_cell_days: string | null; missing_cell_days: string | null
}
export interface CellView extends AnalysisData, Page {
  cell: Detail | null; observations: Detail[]
}
export interface ComparisonQuery {
  view?: 'native_counts' | 'common_response' | 'withheld_reference'
  resolution?: 'week' | 'month'
}
export interface ComparisonView extends AnalysisData {
  view: string; series?: Detail[] | null; periods?: Detail[]
  [key: string]: unknown
}
export interface WeatherQuery extends PageQuery {
  context?: 'historical' | 'recent' | 'both'
  resolution?: 'hour' | 'day' | 'period'; variables?: string
}
export interface WeatherView extends AnalysisData, Page {
  context: string; resolution: string
  series: { id: string; variable: string; value: number | null; unit: string
    valid_start: string; valid_end: string; context_component: string; source_id: string
    quality_status: string; citation: string | null }[]
}
export interface ReportsQuery extends PageQuery {
  relation?: 'candidate' | 'consistent' | 'conflicting' | 'unresolved' | 'rejected'
  review_status?: 'unreviewed' | 'reviewed' | 'rejected'
}
export interface ReportsView extends AnalysisData, Page {
  reports: { event_id: string; report_id: string; title: string; publisher: string
    event_start: string; event_end_exclusive: string; relation: string
    claim_summary: string; claim_review_status: string; report_review_status: string
    url: string | null }[]
}
export interface AvailabilityQuery extends TimeQuery { scope_key: string }
export interface AvailabilityView extends DataStatus {
  source_id: string; scope_key: string; provider_status: string
  last_attempt_at?: string | null; last_success_at?: string | null
  queried_through?: string | null; latest_observation_at?: string | null
  published_at?: string | null; next_check_at?: string | null
  ingestion_completeness: string; observation_coverage: unknown
  stale: boolean; stale_reason: string | null; gaps: Detail[]; gaps_truncated: boolean
  feeds: Detail[]
}
export interface SubscriptionsQuery extends PageQuery {
  scope_key?: string; feed_id?: string
  mode?: 'backfill' | 'incremental' | 'reconciliation'
  state?: 'active' | 'paused' | 'retired' | 'unverified'; enabled?: 'true' | 'false'
}
export interface SubscriptionsView extends Page {
  subscriptions: (Detail & { id: string; feed_id: string; scope_key: string })[]
}
export interface GapsQuery extends PageQuery, TimeQuery {
  scope_key?: string; feed_id?: string
  status?: 'open' | 'retrying' | 'resolved' | 'accepted_unavailable'
}
export interface GapsView extends Page { gaps: Detail[] }
export interface ResourceBudget { max_chunks: number; max_bytes: number }
export interface BackfillInput extends Required<TimeQuery> {
  feed_id: string; area_id: string; scope_key: string
  source_ids: string[]; products: string[]; collection: string; resource_budget: ResourceBudget
}
export interface RefreshInput extends TimeQuery {
  mode: 'poll' | 'repair' | 'reconcile'
  reason?: 'manual' | 'gap_repair' | 'provider_revision'; resource_budget: ResourceBudget
}
export interface IngestionPlan extends DataStatus {
  job_id: string; planned_chunks: number; estimated_bytes: number | null
  execution_support: 'planning_only'; missing_access_requirements: string[]; reused: boolean
}
export interface FetchRunView extends DataStatus {
  id: string; record_count: string | null; successful_empty: boolean
  sanitized_request: Detail; assets: Detail[]; quality_issues: Detail[]
  [key: string]: unknown
}
export interface ExplanationInput { language: 'fr' | 'en'; question?: string }
export interface ExplanationAccepted {
  explanation_id: string; analysis_id: string; job_id: string; status: string
  language: 'fr' | 'en'; generation_mode: 'deterministic_template'; output: unknown
}

