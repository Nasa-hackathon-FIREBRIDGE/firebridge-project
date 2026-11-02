export type SatellitePlatform = 'Terra' | 'Aqua' | 'Suomi-NPP' | 'NOAA-20' | 'NOAA-21'
export type Sensor = 'MODIS' | 'VIIRS'
export type EvidenceStatus = 'candidate' | 'consistent' | 'conflicting' | 'unresolved' | 'rejected'
export type LoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable' | 'error'
export type SourceStatus = 'synthetic_demo' | 'connected' | 'missing' | 'unsupported'

export interface Detection {
  id: string
  observedAtUtc: string
  latitude: number
  longitude: number
  sensor: Sensor
  platform: SatellitePlatform
  productIdentifier: string | null
  frpMw: number | null
  confidence: { scheme: string; value: string | number } | null
  clusterGroup: string | null
  sourceDatasetId: string
  provenance: string
  synthetic: true
}

export interface SourceDataset {
  id: string
  sensor: Sensor
  platform: SatellitePlatform
  productIdentifier: string | null
  collection: string | null
  status: SourceStatus
  description: string
}

export interface AreaOfInterest {
  id: string
  name: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  provenance: 'default-demo' | 'user-drawn'
}

export interface AnalysisSelection {
  area: AreaOfInterest
  startDate: string
  endDate: string
  platforms: SatellitePlatform[]
  searchText: string
  frpThresholdMw: number | null
}

export interface ObservationCoverage {
  fraction: number | null
  status: 'unknown' | 'available' | 'unsupported'
  denominator: number | null
  explanation: string
}

export interface ActivitySummary {
  rawDetections: number
  exploratoryClusterCount: number
  meanFrpMw: number | null
  coverage: ObservationCoverage
  selectedDaysWithDetections: number
  status: SourceStatus
}

export interface SensorComparison {
  sourceCounts: { sensor: Sensor; platform: SatellitePlatform; detections: number }[]
  comparableResponse: { value: number | null; unit: string | null; status: 'unavailable' | 'available'; reason: string }
}

export interface WeatherContext {
  provider: string | null
  status: LoadState
  variables: { name: string; unit: string; values: number[] | null }[]
  explanation: string
}

export interface ReportEvidence {
  id: string
  title: string
  publisher: string
  publishedAt: string | null
  reportedEventDate: string | null
  locationPrecision: string
  status: EvidenceStatus
  sourceUrl: string | null
  synthetic: true
}

export interface AnalysisExplanation {
  id: string
  status: LoadState
  summary: string
  findings: { text: string; evidenceIds: string[]; claimKind: 'measured' | 'interpretation' }[]
  limitations: string[]
  synthetic: true
}

export interface DataProvenance {
  id: string
  label: string
  value: string
  status: SourceStatus
}

export interface LoadingStatus {
  state: LoadState
  message?: string
}

export interface TemporalSummary {
  period: string
  detections: number
  coverage: 'unknown'
}

export interface CatalogEntry {
  id: string
  label: string
  sensor: Sensor
  platform: SatellitePlatform
  productIdentifier: string | null
  collection: string | null
  status: SourceStatus
}

export interface DemoRepository {
  getCatalog(): Promise<CatalogEntry[]>
  loadDetections(selection: AnalysisSelection): Promise<Detection[]>
  loadDashboardSummary(selection: AnalysisSelection): Promise<ActivitySummary>
  loadTemporalSummary(selection: AnalysisSelection): Promise<TemporalSummary[]>
  loadSensorComparison(selection: AnalysisSelection): Promise<SensorComparison>
  loadEvidence(selection: AnalysisSelection): Promise<ReportEvidence[]>
}