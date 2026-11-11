import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { Layers2, Maximize2 } from 'lucide-react'
import type { AreaOfInterest } from '../../types'
import { SectionHeading } from '../../components/workspace/SectionHeading'
import { ApiError } from './Feedback'
import { logDiagnostic } from '../../lib/userFeedback'
import { useDetections } from '../observations/useResults'
import { DetectionDetails } from '../observations/DetectionDetails'
import { emptyObservationFilters, validObservationInterval, type ObservationFilters } from '../observations/filters'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAnalysis } from '../../hooks/useFirebridge'
import { useAllDetections } from '../bridge/useBridgeReport'
import { buildAtlas } from '../atlas/atlas'
import { useAtlas } from '../atlas/useAtlas'
import { AtlasDeck } from '../atlas/AtlasDeck'
import { AtlasLegend, AtlasLoading, AtlasPopup, AtlasTooltip, ReplayClock } from '../atlas/AtlasOverlays'
import { TemporalPanel } from '../observations/TemporalPanel'

const MapView = lazy(() =>
  import('../../components/MapView').then((module) => ({ default: module.MapView })),
)
const noRecords: [] = []

/** The fire atlas once every detection is in the browser; server tiles while loading, and for
 *  analyses too large to hold client-side. One map instance serves both. */
export function SpatialPanel({
  area,
  analysisId,
  showLayer,
  onShowLayer,
  clearToken,
  onDraw,
  onReject,
  onClear,
  error,
  filters = emptyObservationFilters,
  onFiltersChange,
}: {
  area: AreaOfInterest | null
  analysisId?: string
  showLayer: boolean
  onShowLayer: (value: boolean) => void
  clearToken: number
  onDraw: (geometry: GeoJSON.Polygon) => void
  onReject: (reason: string) => void
  onClear: () => void
  error: unknown
  filters?: ObservationFilters
  onFiltersChange?: (value: ObservationFilters) => void
  /** Retained for callers; the map now guides drawing directly. */
  onSetup?: () => void
}) {
  const analysis = useAnalysis(analysisId)
  const all = useAllDetections(analysisId)
  const start = analysis.data?.start_date
  const endExclusive = analysis.data?.end_date_exclusive
  const known = !!analysis.data
  const data = useMemo(
    () => (analysisId && all.features && known ? buildAtlas(all.features, { start, endExclusive }) : null),
    [analysisId, all.features, known, start, endExclusive],
  )
  const atlas = useAtlas({ data, filters, onFiltersChange })
  const building = !!analysisId && !atlas && !all.tooLarge && !all.pages.isError && !all.summary.isError

  const [recordMode, setRecordMode] = useState(false)
  const [showArea, setShowArea] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filtered = !!(filters.sourceId || filters.start || filters.endExclusive)
  const inspectRecords = !atlas && !building && (recordMode || filtered)
  const intervalValid = validObservationInterval(filters)
  const detections = useDetections(analysisId, filters.sourceId || undefined, {
    start: filters.start ? filters.start + 'T00:00:00Z' : undefined,
    end_exclusive: filters.endExclusive ? filters.endExclusive + 'T00:00:00Z' : undefined,
  }, inspectRecords && intervalValid && showLayer)
  const features = useMemo(() => detections.data?.pages.flatMap((page) => page.features) ?? [], [detections.data])
  const selected = features.find((feature) => feature.properties.detection_id === selectedId)
  const tiles = !atlas && !inspectRecords

  return (
    <>
      <section className="fb-section fb-map-panel" id="spatial-workspace" aria-labelledby="map-heading">
        <SectionHeading
          id="map-heading"
          eyebrow="SPATIAL EXPLORER"
          title={analysisId ? 'Fire atlas' : 'Spatial workspace'}
          description={area?.name ?? 'Draw a study boundary or load a saved area.'}
          action={<span className="fb-map-reference"><Maximize2 size={13} />WGS 84</span>}
        />
        <div className="fb-map-toolbar">
          <label>
            <Layers2 size={14} />
            <input type="checkbox" checked={showLayer} disabled={!analysisId} onChange={(event) => onShowLayer(event.target.checked)} />
            Native detections
          </label>
          {atlas ? (
            <p className="m-0 font-sans text-[12.5px] text-fg-3">{atlas.data.n.toLocaleString('en-US')} detections · click any circle to see what is inside</p>
          ) : !building && (
            <div className="geo-map-modes" aria-label="Detection display">
              <button type="button" aria-pressed={!inspectRecords} disabled={filtered} onClick={() => setRecordMode(false)}>Aggregate tiles</button>
              <button type="button" aria-pressed={inspectRecords} onClick={() => setRecordMode(true)}>Inspect records</button>
            </div>
          )}
        </div>
        <div className="geo-spatial-body">
          <MapBoundary>
            <Suspense fallback={<div className="fb-map-loading"><Skeleton height={480} label="Loading spatial tools…" /></div>}>
              <MapView
                apiMode
                records={noRecords}
                selectedId={selectedId}
                onSelect={setSelectedId}
                nativeRecords={inspectRecords ? intervalValid ? features : [] : undefined}
                area={area}
                showArea={showArea}
                onShowArea={setShowArea}
                onShowDetections={onShowLayer}
                showDetections={showLayer}
                apiAnalysisId={tiles ? analysisId : undefined}
                clearDrawingToken={clearToken}
                onAreaDrawn={onDraw}
                onAreaRejected={onReject}
                onClearArea={onClear}
                promptDraw={!area && !analysisId}
                atlas={atlas && showLayer ? atlas.layer : undefined}
                footer={atlas ? <AtlasDeck atlas={atlas} /> : undefined}
              >
                {building && showLayer && <AtlasLoading loaded={all.loaded} total={all.total} />}
                {atlas && showLayer && (
                  <>
                    <ReplayClock atlas={atlas} />
                    <AtlasLegend atlas={atlas} />
                    <AtlasTooltip atlas={atlas} />
                    <AtlasPopup atlas={atlas} />
                  </>
                )}
              </MapView>
            </Suspense>
          </MapBoundary>
          {selected && inspectRecords && intervalValid && showLayer && <DetectionDetails feature={selected} onClose={() => setSelectedId(null)} />}
        </div>
        {inspectRecords && <div className="geo-loaded-notice" role="status">
          <span>{!intervalValid ? 'Correct the date interval to load records.' : !analysisId ? 'Select an analysis to inspect its records.' : detections.isPending ? 'Loading matching observation records…' : `${features.length} matching records loaded${detections.hasNextPage ? ' · More available' : ''}. Only loaded records appear on the map.`}</span>
          {detections.hasNextPage && intervalValid && <button className="button button-secondary" type="button" disabled={detections.isFetchingNextPage} onClick={() => { void detections.fetchNextPage() }}>{detections.isFetchingNextPage ? 'Loading…' : 'Load more records'}</button>}
        </div>}
        {inspectRecords && <ApiError error={detections.error} retry={() => { void detections.refetch() }} />}
        <ApiError error={error} />
        {!atlas && (
          <div className="fb-map-caption">
            <div>
              <span className="fb-legend-record" />
              Native records
              <span className="fb-legend-boundary" />
              Study boundary · WGS 84
            </div>
            <p>
              {analysisId
                ? building ? 'Showing server-aggregated tiles while every detection loads for the fire atlas.' : inspectRecords ? 'Equal-size points represent loaded records. Select a point to inspect its raw values.' : 'Marker size reflects aggregated record count for the full saved interval. Empty tiles do not establish an absence of fire.'
                : 'Your boundary is a draft until saved. Background imagery, when configured, is contextual.'}
            </p>
          </div>
        )}
      </section>
      {analysisId && !atlas && !building && onFiltersChange && <TemporalPanel analysisId={analysisId} filters={filters} onChange={onFiltersChange} compact />}
    </>
  )
}

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) { logDiagnostic(error, 'map-render') }
  render() {
    return this.state.failed ? (
      <div className="fb-feedback" role="alert">
        <strong>The map could not start.</strong><p>Check that WebGL is available in your browser. You can still submit GeoJSON and monitor analyses.</p>
        <button className="button button-secondary" type="button" onClick={() => this.setState({ failed: false })}>Try loading the map again</button>
      </div>
    ) : (
      this.props.children
    )
  }
}
