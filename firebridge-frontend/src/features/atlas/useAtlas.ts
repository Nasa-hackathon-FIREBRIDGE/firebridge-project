import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObservationFilters } from '../observations/filters'
import { DAY, dayIndex, fmtSpan, isoDay, lowerBound, selectIndices, sensorsOf, summarize, type AtlasData, type AtlasFilter, type Instrument, type Summary } from './atlas'
import type { AtlasHit, AtlasLayerConfig, AtlasPick } from './useAtlasLayers'

/** Replay speeds, relative to a pace that plays any period in about 40 seconds. */
export const SPEEDS = [
  { factor: 0.5, label: 'Slow' },
  { factor: 1, label: 'Normal' },
  { factor: 2, label: 'Fast' },
] as const
const REPLAY_SECONDS = 40
const TICK_MS = 110

export function fmtRate(daysPerSecond: number) {
  if (daysPerSecond < 1.5) return '1 day / s'
  if (daysPerSecond < 10) return `${Math.round(daysPerSecond)} days / s`
  if (daysPerSecond < 45) return `${Math.round(daysPerSecond / 7)} wk / s`
  return `${Math.round(daysPerSecond / 30)} mo / s`
}
/** A short period is a question about specific fires: frame them. */
const FOCUS_DAYS = 62

const keyOf = (start: string, end: string) => `${start}|${end}`
type Focus = AtlasLayerConfig['focus']

export interface AtlasController {
  data: AtlasData
  window: { start: number; end: number }
  /** Move the period while dragging; `commit` publishes it to the workspace filters. */
  setWindow: (start: number, end: number, commit?: boolean) => void
  instrument: Instrument
  setInstrument: (instrument: Instrument) => void
  sensors: number[]
  /** The selected period with the selected satellites. */
  summary: Summary
  /** The selected period with every satellite: for the MODIS/VIIRS comparison. */
  allSatellites: Summary
  label: string
  playing: boolean
  togglePlay: () => void
  stopReplay: () => void
  /** Replay instant in ms, or null when not replaying. */
  playhead: number | null
  speed: (typeof SPEEDS)[number]
  /** Days of record per second of replay, and how long a detection keeps glowing. */
  daysPerSecond: number
  glowDays: number
  cycleSpeed: () => void
  /** Detections glowing at the replay instant. */
  glowing: number
  hover: AtlasHit | null
  pick: (AtlasPick & { summary: Summary }) | null
  closePick: () => void
  focusOn: (bounds: [number, number, number, number], maxZoom?: number) => void
  showDay: (day: number) => void
  popupNode: HTMLElement | null
  layer: AtlasLayerConfig
}

const EMPTY: AtlasData = {
  n: 0, ids: [], t: new Float64Array(0), lon: new Float64Array(0), lat: new Float64Array(0), sensor: new Uint8Array(0), frp: new Float32Array(0),
  confidence: [], dayNight: [], sourceIndex: new Uint16Array(0), sources: [], firstDay: 0, endDay: 1, daily: [], sensorsPresent: [], points: [],
}

/** Atlas state. Null until every detection of the analysis is loaded. */
export function useAtlas({ data: ready, filters, onFiltersChange }: {
  data: AtlasData | null
  filters: ObservationFilters
  onFiltersChange?: (value: ObservationFilters) => void
}): AtlasController | null {
  const data = ready ?? EMPTY
  const [span, setSpan] = useState({ start: data.firstDay, end: data.endDay })
  const [instrument, setInstrument] = useState<Instrument>('all')
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speedIndex, setSpeedIndex] = useState(1)
  const [hover, setHover] = useState<AtlasHit | null>(null)
  const [pick, setPick] = useState<AtlasPick | null>(null)
  const [focus, setFocus] = useState<Focus>(null)
  const [published, setPublished] = useState<string | null>(null)
  const [synced, setSynced] = useState<string | null>(null)
  const [dataSeen, setDataSeen] = useState<AtlasData | null>(ready)
  const [popupNode] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')))

  const clamp = (day: number) => Math.min(data.endDay, Math.max(data.firstDay, day))
  const source = filters.sourceId ? data.sources.indexOf(filters.sourceId) : -1
  const sourceFilter = filters.sourceId ? (source >= 0 ? source : 65535) : null
  const sensors = useMemo(() => sensorsOf(instrument, data.sensorsPresent), [instrument, data])

  if (dataSeen !== ready) {
    setDataSeen(ready)
    setSpan({ start: data.firstDay, end: data.endDay })
    setInstrument('all')
    setPick(null)
    setPlaying(false)
    setPlayhead(null)
    setSynced(null)
  }

  // The calendar, the copilot or the date inputs changed the workspace period: follow it.
  const external = keyOf(filters.start, filters.endExclusive)
  if (ready && external !== synced) {
    setSynced(external)
    if (external !== published) {
      const start = filters.start ? clamp(dayIndex(filters.start)) : data.firstDay
      const end = filters.endExclusive ? clamp(dayIndex(filters.endExclusive)) : data.endDay
      if (start < end) {
        setSpan({ start, end })
        setPlaying(false)
        setPlayhead(null)
        setPick(null)
        if (end - start <= FOCUS_DAYS) {
          const bounds = summarize(data, selectIndices(data, { startDay: start, endDay: end, sensors, source: sourceFilter })).bounds
          if (bounds) setFocus((f) => ({ bounds, nonce: (f?.nonce ?? 0) + 1, maxZoom: 11 }))
        }
      }
    }
    setPublished(null)
  }

  const publish = (start: number, end: number) => {
    const value = { ...filters, start: start <= data.firstDay ? '' : isoDay(start), endExclusive: end >= data.endDay ? '' : isoDay(end) }
    const key = keyOf(value.start, value.endExclusive)
    setPublished(key)
    setSynced(key)
    if (key !== keyOf(filters.start, filters.endExclusive)) onFiltersChange?.(value)
  }

  const setWindow = (start: number, end: number, commit = false) => {
    const s = clamp(Math.min(start, end - 1))
    const e = clamp(Math.max(end, s + 1))
    setSpan({ start: s, end: e })
    setPick(null)
    if (playhead !== null && !playing) setPlayhead(null)
    if (commit) publish(s, e)
  }

  const speed = SPEEDS[speedIndex]
  const daysPerSecond = Math.min(120, Math.max(1, (span.end - span.start) / REPLAY_SECONDS)) * speed.factor
  // A detection glows for about a second of replay, whatever the speed.
  const glowDays = Math.min(60, Math.max(3, daysPerSecond * 0.9))
  const clock = useRef({ span, playhead })
  useEffect(() => {
    clock.current = { span, playhead }
  })
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const { span: current, playhead: at } = clock.current
      const end = current.end * DAY
      const next = (at ?? current.start * DAY) + (daysPerSecond * DAY * TICK_MS) / 1000
      clock.current = { span: current, playhead: Math.min(next, end) }
      setPlayhead(Math.min(next, end))
      if (next >= end) setPlaying(false)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [playing, daysPerSecond])

  const filter = useMemo<AtlasFilter>(() => ({ startDay: span.start, endDay: span.end, sensors, source: sourceFilter }), [span, sensors, sourceFilter])
  const indices = useMemo(() => selectIndices(data, filter), [data, filter])
  const visible = useMemo(() => indices.map((i) => data.points[i]), [indices, data])
  const summary = useMemo(() => summarize(data, indices), [data, indices])
  const allSatellites = useMemo(() => summarize(data, selectIndices(data, { ...filter, sensors: data.sensorsPresent })), [data, filter])
  const pickSummary = useMemo(() => (pick ? summarize(data, pick.indices) : null), [data, pick])

  if (!ready) return null

  const focusOn = (bounds: [number, number, number, number], maxZoom?: number) => setFocus((f) => ({ bounds, nonce: (f?.nonce ?? 0) + 1, maxZoom }))
  const replaying = playhead !== null
  const glowing = replaying ? lowerBound(data.t, playhead) - lowerBound(data.t, playhead - glowDays * DAY) : 0

  const layer: AtlasLayerConfig = {
    data,
    visible,
    replay: replaying ? { now: playhead, sensors, glowDays } : null,
    popup: pick && popupNode ? { lngLat: pick.lngLat, node: popupNode } : null,
    focus,
    onHover: setHover,
    onPick: (value) => setPick(value && value.indices.length ? value : null),
  }

  return {
    data,
    window: span,
    setWindow,
    instrument,
    setInstrument: (value) => {
      setInstrument(value)
      setPick(null)
    },
    sensors,
    summary,
    allSatellites,
    label: fmtSpan(span.start, span.end),
    playing,
    togglePlay: () => {
      if (playing) {
        setPlaying(false)
        return
      }
      setPick(null)
      if (playhead === null || playhead >= span.end * DAY) {
        setPlayhead(span.start * DAY)
        // A short period is one fire season or one episode: bring its fires into view.
        if (span.end - span.start <= FOCUS_DAYS && summary.bounds) focusOn(summary.bounds, 11)
      }
      setPlaying(true)
    },
    stopReplay: () => {
      setPlaying(false)
      setPlayhead(null)
    },
    playhead,
    speed,
    daysPerSecond,
    glowDays,
    cycleSpeed: () => setSpeedIndex((i) => (i + 1) % SPEEDS.length),
    glowing,
    hover,
    pick: pick && pickSummary ? { ...pick, summary: pickSummary } : null,
    closePick: () => setPick(null),
    focusOn,
    showDay: (day) => {
      setPlaying(false)
      setPlayhead(null)
      setWindow(day, day + 1, true)
    },
    popupNode,
    layer,
  }
}
