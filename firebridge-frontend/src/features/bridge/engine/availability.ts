import { SENSORS, sensorKeyOf, type SensorKey } from '../../../lib/sensors.ts'

/** Inventory state of one sensor for one calendar month. "unknown" is missing information,
 *  never zero detections. */
export type MonthState = 'complete' | 'partial' | 'unknown'

export interface CalendarPeriodInput {
  start: string
  end_exclusive: string
  counts_by_source: { source_id: string; count: string | null; count_status: string }[]
}

export interface SourceSpan {
  sourceId: string
  sensor: SensorKey
  first: string
  last: string
}

export interface RecordEvent {
  date: string
  sensors: SensorKey[]
  /** joins/leaves: one satellite record starts or stops; collection: the same satellite
   *  continues under a new processing collection; horizon: several standard records stop
   *  together near the end of the window (processing latency, not a satellite event). */
  kind: 'joins' | 'leaves' | 'collection' | 'horizon'
  label: string
  sourceIds: string[]
}

export interface Availability {
  months: string[]
  bySensor: Partial<Record<SensorKey, Record<string, MonthState>>>
  spans: SourceSpan[]
  events: RecordEvent[]
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function monthsBetween(start: string, endExclusive: string) {
  const out: string[] = []
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`)
  const last = new Date(Date.parse(`${endExclusive.slice(0, 10)}T00:00:00Z`) - 86_400_000)
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return out
}

const collectionOf = (sourceId: string) => /-c(\d+)-/.exec(sourceId)?.[1]

/**
 * Derive per-sensor monthly inventory from the native UTC calendar (any resolution).
 * A sensor-month is complete when every calendar period inside it has a complete count
 * for at least one of that sensor's sources; partial when only some do.
 */
export function availabilityFromCalendar(periods: readonly CalendarPeriodInput[], start: string, endExclusive: string): Availability {
  const months = monthsBetween(start, endExclusive)
  const totals = new Map<string, number>()
  const complete = new Map<string, number>()
  const spans = new Map<string, SourceSpan>()
  for (const period of periods) {
    const month = period.start.slice(0, 7)
    const first = period.start.slice(0, 10)
    const last = new Date(Date.parse(period.end_exclusive) - 86_400_000).toISOString().slice(0, 10)
    const sensorsComplete = new Set<SensorKey>()
    const sensorsSeen = new Set<SensorKey>()
    for (const source of period.counts_by_source) {
      const sensor = sensorKeyOf(source.source_id)
      sensorsSeen.add(sensor)
      if (source.count_status === 'complete') {
        sensorsComplete.add(sensor)
        const span = spans.get(source.source_id)
        if (!span) spans.set(source.source_id, { sourceId: source.source_id, sensor, first, last })
        else {
          if (first < span.first) span.first = first
          if (last > span.last) span.last = last
        }
      }
    }
    for (const sensor of sensorsSeen) {
      const key = `${sensor}|${month}`
      totals.set(key, (totals.get(key) ?? 0) + 1)
      if (sensorsComplete.has(sensor)) complete.set(key, (complete.get(key) ?? 0) + 1)
    }
  }
  const bySensor: Availability['bySensor'] = {}
  for (const [key, total] of totals) {
    const [sensor, month] = key.split('|') as [SensorKey, string]
    const done = complete.get(key) ?? 0
    ;(bySensor[sensor] ??= {})[month] = done === total ? 'complete' : done > 0 ? 'partial' : 'unknown'
  }
  for (const sensor of Object.keys(bySensor) as SensorKey[]) for (const month of months) bySensor[sensor]![month] ??= 'unknown'
  return { months, bySensor, spans: [...spans.values()].sort((a, b) => a.first.localeCompare(b.first)), events: recordEvents([...spans.values()], start, endExclusive) }
}

/** Fallback when no calendar is available: a sensor is treated as inventoried between its
 *  first and last detection month. Weaker; reported as such by the engine. */
export function availabilityFromDetections(sensorMonths: Map<SensorKey, Set<string>>, start: string, endExclusive: string): Availability {
  const months = monthsBetween(start, endExclusive)
  const bySensor: Availability['bySensor'] = {}
  for (const [sensor, seen] of sensorMonths) {
    const sorted = [...seen].sort()
    bySensor[sensor] = Object.fromEntries(months.map((month) => [month, month >= sorted[0] && month <= sorted[sorted.length - 1] ? 'complete' : 'unknown']))
  }
  return { months, bySensor, spans: [], events: [] }
}

const DAY = 86_400_000
const collectionLabel = (sourceId: string) => {
  const value = collectionOf(sourceId)
  return value ? `C${value.replace(/^(\d)(\d)$/, '$1.$2')}` : sourceId
}

function recordEvents(spans: SourceSpan[], start: string, endExclusive: string): RecordEvent[] {
  const lastDay = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - DAY).toISOString().slice(0, 10)
  const events: RecordEvent[] = []
  const leaves: RecordEvent[] = []
  const bySensor = new Map<SensorKey, SourceSpan[]>()
  for (const span of spans) bySensor.set(span.sensor, [...(bySensor.get(span.sensor) ?? []), span])
  for (const [sensor, list] of bySensor) {
    const meta = SENSORS[sensor]
    const sorted = [...list].sort((a, b) => a.first.localeCompare(b.first))
    for (let i = 0; i + 1 < sorted.length; i++) {
      const before = sorted[i]
      const after = sorted[i + 1]
      // The same satellite continues under another source within a few days (archives may
      // overlap briefly at the switch): a collection/processing change, not a new record.
      if (Date.parse(after.first) <= Date.parse(nextDay(before.last)) + 3 * DAY && after.last > before.last)
        events.push({ date: after.first, sensors: [sensor], kind: 'collection', label: `${meta.label} ${meta.instrument} ${collectionLabel(before.sourceId)} → ${collectionLabel(after.sourceId)}`, sourceIds: [before.sourceId, after.sourceId] })
    }
    const first = sorted[0]
    const last = sorted.reduce((latest, span) => (span.last > latest.last ? span : latest), sorted[0])
    if (first.first > start) events.push({ date: first.first, sensors: [sensor], kind: 'joins', label: `${meta.label} record begins`, sourceIds: [first.sourceId] })
    if (last.last < lastDay) leaves.push({ date: nextDay(last.last), sensors: [sensor], kind: 'leaves', label: `${meta.label} record ends in this archive`, sourceIds: [last.sourceId] })
  }
  // Several standard records stopping near the end of the window is the processing horizon.
  const horizonFrom = Date.parse(`${lastDay}T00:00:00Z`) - 180 * DAY
  const late = leaves.filter((event) => Date.parse(`${event.date}T00:00:00Z`) >= horizonFrom)
  if (late.length >= 2) {
    const date = late.map((event) => event.date).sort()[0]
    events.push({ date, sensors: late.flatMap((event) => event.sensors), kind: 'horizon', label: 'Standard-quality archive ends; later data are near-real-time only', sourceIds: late.flatMap((event) => event.sourceIds) })
    events.push(...leaves.filter((event) => !late.includes(event)))
  } else events.push(...leaves)
  return events.sort((a, b) => a.date.localeCompare(b.date))
}
