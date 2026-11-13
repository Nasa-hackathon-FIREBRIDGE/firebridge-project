import { filterDetections } from './data'
import { DEMO_DETECTIONS } from './fixtures'
import { NO_RECORDS_LABEL, PLATFORMS, SENSOR_FAMILIES, hasDemoRecords, operationalNote, selectedWithoutRecords } from './platforms'
import type { AnalysisSelection, Detection } from './types'

export const ASSISTANT_STATUS = 'DEMO — Uses sample data. Live AI service is not connected.'

export const SUGGESTED_QUESTIONS = [
  'Explain the selected detections.',
  'What does FRP mean?',
  'Compare MODIS and VIIRS.',
  'Why is coverage unknown?',
  'Explain the selected satellites.',
  'What does the current filter show?',
]

export interface AssistantContext {
  selection: AnalysisSelection
  selectedDetectionId: string | null
  /** Defaults to the bundled synthetic fixtures. */
  records?: Detection[]
  now?: Date
}

/** Replaceable boundary: a future implementation may call a real service without changing the UI. */
export interface AssistantService {
  answer(question: string, context: AssistantContext): Promise<string>
}

function describeFilter(selection: AnalysisSelection): string {
  const parts = [
    `${selection.startDate} to ${selection.endDate}`,
    selection.platforms.length ? `platforms: ${selection.platforms.join(', ')}` : 'no platforms selected',
    `area: ${selection.area.name}`,
  ]
  if (selection.frpThresholdMw !== null) parts.push(`minimum FRP ${selection.frpThresholdMw} MW`)
  if (selection.searchText.trim()) parts.push(`text search "${selection.searchText.trim()}"`)
  return parts.join(' · ')
}

function explainFilter(context: AssistantContext, visible: Detection[]): string {
  const { selection } = context
  const lines = [`Current filter: ${describeFilter(selection)}.`]
  if (!selection.platforms.length) return `${lines[0]} No satellite is selected, so no records can be shown. Select at least one satellite in Settings.`
  lines.push(`${visible.length} synthetic demo record${visible.length === 1 ? '' : 's'} match.`)
  const empty = selectedWithoutRecords(selection.platforms)
  if (empty.length) lines.push(`${empty.join(', ')} ${empty.length === 1 ? 'has' : 'have'} no records in the demo dataset (${NO_RECORDS_LABEL}); this says nothing about real-world detections.`)
  if (!visible.length && !empty.length) lines.push('Try widening the date range, clearing the FRP minimum or resetting the area.')
  lines.push('These are synthetic demonstration records, not verified incidents.')
  return lines.join(' ')
}

function explainDetections(context: AssistantContext, visible: Detection[]): string {
  const picked = context.selectedDetectionId ? visible.find((record) => record.id === context.selectedDetectionId) : undefined
  if (picked) {
    return [
      `Selected record ${picked.id}: ${picked.sensor} on ${picked.platform}, observed ${picked.observedAtUtc.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, '')} UTC at ${picked.latitude.toFixed(4)}°, ${picked.longitude.toFixed(4)}°.`,
      picked.frpMw === null ? 'FRP is unavailable for this record.' : `Its illustrative FRP is ${picked.frpMw.toFixed(1)} MW.`,
      picked.confidence ? `Confidence label: ${picked.confidence.value} (${picked.confidence.scheme}).` : 'No confidence value is recorded.',
      'It is a synthetic demonstration point, not a verified incident.',
    ].join(' ')
  }
  if (context.selectedDetectionId) return 'The record you selected is hidden by the current filters, so I cannot describe it. Adjust the filters or select another record.'
  if (!visible.length) return 'No records match the current filters, so there is nothing to explain. Nothing can be concluded from an empty result: absence of records is not evidence of absence of fire.'
  const frp = visible.flatMap((record) => record.frpMw === null ? [] : [record.frpMw])
  const bySource = new Map<string, number>()
  visible.forEach((record) => bySource.set(`${record.sensor} · ${record.platform}`, (bySource.get(`${record.sensor} · ${record.platform}`) ?? 0) + 1))
  const sources = [...bySource].map(([key, count]) => `${key}: ${count}`).join('; ')
  return `No single record is selected. ${visible.length} synthetic records are visible (${sources}). ${frp.length ? `Illustrative FRP ranges from ${Math.min(...frp).toFixed(1)} to ${Math.max(...frp).toFixed(1)} MW across ${frp.length} records that have a value.` : 'No FRP values are available.'} Counts are native per source and are not harmonized. Select a marker or table row for record details.`
}

function explainSatellites(context: AssistantContext): string {
  const { selection } = context
  if (!selection.platforms.length) return 'No satellites are selected.'
  const lines = selection.platforms.map((id) => {
    const info = PLATFORMS.find((platform) => platform.id === id)
    return `${id} (${info?.sensor}): ${hasDemoRecords(id) ? 'demo records are loaded' : NO_RECORDS_LABEL}`
  })
  const notes = selection.platforms.flatMap((id) => operationalNote(id, context.now) ?? [])
  return `Selected satellites — ${lines.join('; ')}. ${notes.join(' ')} Satellites without demo records contribute nothing to counts; this is a property of the demo dataset only.`.trim()
}

const FRP_TEXT = 'FRP is Fire Radiative Power, measured in megawatts (MW): the rate at which a detected fire radiates energy as observed by the sensor. In this demo, FRP values are illustrative fixture numbers. Missing FRP is shown as unavailable, never as zero.'
const COMPARE_TEXT = `${SENSOR_FAMILIES.map((family) => `${family.label}: ${family.description}`).join('. ')}. Their detection counts reflect different instruments, overpass times and pixel sizes, so raw counts are not directly comparable. No harmonized or common-scale metric is implemented here, and no cross-sensor claims are made.`
const COVERAGE_TEXT = 'Observation coverage is unknown because this demo has no full fire masks, quality flags or valid-observation support. A missing detection is not a valid negative: it may mean no fire, cloud, an invalid pixel or no overpass.'

function matches(question: string, ...words: RegExp[]): boolean {
  return words.some((word) => word.test(question))
}

/** Deterministic, local, rule-based assistant. It never makes network requests. */
export const localAssistant: AssistantService = {
  async answer(question, context) {
    const q = question.toLowerCase()
    const visible = filterDetections(context.records ?? DEMO_DETECTIONS, context.selection)
    if (matches(q, /\bfrp\b/, /radiative/)) return FRP_TEXT
    if (matches(q, /compare.*(modis|viirs)/, /(modis|viirs).*(compare|differ|versus|vs)/)) return COMPARE_TEXT
    if (matches(q, /coverage/, /valid negative/, /observation support/)) return COVERAGE_TEXT
    if (matches(q, /satellite/, /platform/, /terra|aqua|suomi|noaa/)) return explainSatellites(context)
    if (matches(q, /filter/, /current (view|selection)/, /how many/, /count/)) return explainFilter(context, visible)
    if (matches(q, /detection/, /record/, /selected/, /marker/)) return explainDetections(context, visible)
    return `I don't have enough evidence to answer that. I only use the demo dataset and the current filters: ${describeFilter(context.selection)}. I can explain the selected detections, FRP, MODIS vs VIIRS, coverage, the selected satellites, or the current filter.`
  },
}
