import { DEMO_DETECTIONS, DEMO_REPORTS, DEMO_SOURCES } from './fixtures'
import type { ActivitySummary, AnalysisSelection, CatalogEntry, DemoRepository, Detection, SensorComparison, TemporalSummary } from './types'

function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function withinArea(record: Detection, selection: AnalysisSelection): boolean {
  const geometry = selection.area.geometry
  const point: [number, number] = [record.longitude, record.latitude]
  if (geometry.type === 'Polygon') return pointInRing(point, geometry.coordinates[0] as number[][])
  return geometry.coordinates.some((polygon) => pointInRing(point, polygon[0] as number[][]))
}

export function filterDetections(records: Detection[], selection: AnalysisSelection): Detection[] {
  const query = selection.searchText.trim().toLowerCase()
  return records.filter((record) => {
    const day = record.observedAtUtc.slice(0, 10)
    const text = `${record.id} ${record.sensor} ${record.platform} ${record.productIdentifier ?? ''}`.toLowerCase()
    return day >= selection.startDate && day <= selection.endDate
      && selection.platforms.includes(record.platform)
      && (selection.frpThresholdMw === null || (record.frpMw !== null && record.frpMw >= selection.frpThresholdMw))
      && (!query || text.includes(query))
      && withinArea(record, selection)
  })
}

function byDay(records: Detection[]): TemporalSummary[] {
  const counts = new Map<string, number>()
  records.forEach((record) => {
    const day = record.observedAtUtc.slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  })
  return [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([period, detections]) => ({ period, detections, coverage: 'unknown' }))
}

function dashboardSummary(records: Detection[]): ActivitySummary {
  const frp = records.flatMap((record) => record.frpMw === null ? [] : [record.frpMw])
  const days = new Set(records.map((record) => record.observedAtUtc.slice(0, 10)))
  return {
    rawDetections: records.length,
    exploratoryClusterCount: new Set(records.flatMap((record) => record.clusterGroup ? [record.clusterGroup] : [])).size,
    meanFrpMw: frp.length ? frp.reduce((sum, value) => sum + value, 0) / frp.length : null,
    coverage: { fraction: null, status: 'unknown', denominator: null, explanation: 'Full fire masks, QA and valid-observation support are not connected in this demo.' },
    selectedDaysWithDetections: days.size,
    status: 'synthetic_demo',
  }
}

export const demoRepository: DemoRepository = {
  async getCatalog(): Promise<CatalogEntry[]> {
    return DEMO_SOURCES.map((source) => ({ id: source.id, label: `${source.sensor} · ${source.platform}`, sensor: source.sensor, platform: source.platform, productIdentifier: source.productIdentifier, collection: source.collection, status: source.status }))
  },
  async loadDetections(selection) { return filterDetections(DEMO_DETECTIONS, selection) },
  async loadDashboardSummary(selection) { return dashboardSummary(filterDetections(DEMO_DETECTIONS, selection)) },
  async loadTemporalSummary(selection) { return byDay(filterDetections(DEMO_DETECTIONS, selection)) },
  async loadSensorComparison(selection): Promise<SensorComparison> {
    const records = filterDetections(DEMO_DETECTIONS, selection)
    const counts = new Map<string, { sensor: Detection['sensor']; platform: Detection['platform']; detections: number }>()
    records.forEach(({ sensor, platform }) => {
      const key = `${sensor}-${platform}`
      const row = counts.get(key) ?? { sensor, platform, detections: 0 }
      row.detections += 1
      counts.set(key, row)
    })
    return { sourceCounts: [...counts.values()], comparableResponse: { value: null, unit: null, status: 'unavailable', reason: 'No validated harmonization product or common observation support is connected.' } }
  },
  async loadEvidence() { return DEMO_REPORTS },
}

export function csvForDetections(records: Detection[]): string {
  const columns = ['observation_id', 'acquired_at_utc', 'latitude', 'longitude', 'sensor', 'platform', 'product_identifier', 'frp_mw', 'frp_unit', 'native_confidence_scheme', 'native_confidence_value', 'provenance', 'synthetic_demo']
  const escape = (value: string | number | boolean | null): string => `"${String(value ?? '').replaceAll('"', '""')}"`
  const lines = records.map((record) => [record.id, record.observedAtUtc, record.latitude, record.longitude, record.sensor, record.platform, record.productIdentifier, record.frpMw, record.frpMw === null ? '' : 'MW', record.confidence?.scheme ?? null, record.confidence?.value ?? null, record.provenance, true].map(escape).join(','))
  return [columns.join(','), ...lines].join('\r\n')
}

export function downloadCsv(records: Detection[]): void {
  const url = URL.createObjectURL(new Blob([csvForDetections(records)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'astra-mind-demo-detections.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}