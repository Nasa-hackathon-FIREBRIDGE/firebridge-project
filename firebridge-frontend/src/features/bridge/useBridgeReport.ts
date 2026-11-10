import { useEffect, useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAnalysis } from '../../hooks/useFirebridge'
import { results } from '../../services/results.service'
import { useNativeCalendar, useNativeSummary } from '../observations/useResults'
import { runBridge, type BridgeInput, type BridgeReport, type RawDetection } from './engine/index.ts'
import type { DetectionFeature } from '../observations/types'

/** In-browser analysis ceiling. Beyond it the selection should be narrowed (or computed server-side). */
export const MAX_BRIDGE_DETECTIONS = 150_000
const PAGE_SIZE = 5000

export type BridgeState =
  | { status: 'idle' }
  | { status: 'loading'; phase: 'detections' | 'computing'; loaded: number; total: number | null }
  | { status: 'ready'; report: BridgeReport }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'too-large'; total: number }

const toRaw = (feature: DetectionFeature): RawDetection => ({
  sourceId: feature.properties.source_id,
  platform: feature.properties.platform,
  lon: feature.geometry.coordinates[0],
  lat: feature.geometry.coordinates[1],
  acquiredAt: feature.properties.acquired_at,
  dayNight: feature.properties.day_night,
  frp: feature.properties.frp_mw,
  confidence: feature.properties.confidence_raw,
  confidenceScheme: feature.properties.confidence_scheme,
  type: feature.properties.type_raw ?? null,
})

/** Run the engine in a module worker when the browser supports it; otherwise inline. */
export function computeBridge(input: BridgeInput): Promise<BridgeReport> {
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => runBridge(input))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./bridge.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(runBridge(input))
      return
    }
    worker.onmessage = (event: MessageEvent<{ ok: true; report: BridgeReport } | { ok: false; message: string }>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.report)
      else reject(new Error(event.data.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
      // A worker that cannot load (e.g. blocked) falls back to the main thread.
      event.preventDefault()
      try {
        resolve(runBridge(input))
      } catch (error) {
        reject(error)
      }
    }
    worker.postMessage(input)
  })
}

/** Every native detection of the saved analysis, harmonization study included. */
export function useBridgeReport(analysisId?: string): BridgeState {
  const analysis = useAnalysis(analysisId)
  const summary = useNativeSummary(analysisId)
  const calendar = useNativeCalendar(analysisId)
  const total = useMemo(() => {
    const sources = summary.data?.native_detections_by_source
    if (!sources) return null
    return sources.reduce((sum, source) => sum + (source.count && /^\d+$/.test(source.count) ? Number(source.count) : 0), 0)
  }, [summary.data])
  const tooLarge = total !== null && total > MAX_BRIDGE_DETECTIONS
  const pages = useInfiniteQuery({
    queryKey: ['firebridge', 'results', analysisId ?? '', 'detections-all'],
    queryFn: ({ signal, pageParam }) => results.detectionsBulk(analysisId!, pageParam, signal, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: !!analysisId && summary.isSuccess && !tooLarge,
    staleTime: Infinity,
    gcTime: 15 * 60_000,
  })
  const loaded = pages.data?.pages.reduce((sum, page) => sum + page.features.length, 0) ?? 0
  useEffect(() => {
    if (pages.hasNextPage && !pages.isFetchingNextPage && !pages.isError && loaded < MAX_BRIDGE_DETECTIONS) void pages.fetchNextPage()
  }, [pages, loaded])

  const complete = pages.isSuccess && !pages.hasNextPage
  const calendarSettled = calendar.isSuccess || calendar.isError
  const start = analysis.data?.start_date
  const endExclusive = analysis.data?.end_date_exclusive
  const ready = complete && calendarSettled && !!start && !!endExclusive
  const report = useQuery({
    queryKey: ['firebridge', 'results', analysisId ?? '', 'bridge-report', loaded, calendar.isSuccess],
    queryFn: () =>
      computeBridge({
        detections: pages.data!.pages.flatMap((page) => page.features.map(toRaw)),
        start: start!,
        endExclusive: endExclusive!,
        calendar: calendar.data?.periods,
      }),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 15 * 60_000,
    retry: false,
  })

  if (!analysisId) return { status: 'idle' }
  if (tooLarge) return { status: 'too-large', total: total! }
  const failure = summary.error ?? pages.error ?? analysis.error ?? report.error
  if (failure)
    return {
      status: 'error',
      error: failure,
      retry: () => {
        if (summary.isError) void summary.refetch()
        if (pages.isError) void pages.refetch()
        if (report.isError) void report.refetch()
      },
    }
  if (report.data) return { status: 'ready', report: report.data }
  return { status: 'loading', phase: complete ? 'computing' : 'detections', loaded, total }
}
