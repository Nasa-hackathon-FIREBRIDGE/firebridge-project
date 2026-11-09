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

const MapView = lazy(() =>
  import('../../components/MapView').then((module) => ({ default: module.MapView })),
)
const noRecords: [] = []
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
  /** Retained for callers; the map now guides drawing directly. */
  onSetup?: () => void
}) {
  const [recordMode, setRecordMode] = useState(false)
  const [showArea, setShowArea] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filtered = !!(filters.sourceId || filters.start || filters.endExclusive)
  const inspectRecords = recordMode || filtered
  const intervalValid = validObservationInterval(filters)
  const detections = useDetections(analysisId, filters.sourceId || undefined, {
    start: filters.start ? filters.start + 'T00:00:00Z' : undefined,
    end_exclusive: filters.endExclusive ? filters.endExclusive + 'T00:00:00Z' : undefined,
  }, inspectRecords && intervalValid && showLayer)
  const features = useMemo(() => detections.data?.pages.flatMap((page) => page.features) ?? [], [detections.data])
  const selected = features.find((feature) => feature.properties.detection_id === selectedId)
  return (
    <section
      className="fb-section fb-map-panel"
      id="spatial-workspace"
      aria-labelledby="map-heading"
    >
      <SectionHeading
        id="map-heading"
        eyebrow="SPATIAL EXPLORER"
        title="Spatial workspace"
        description={area?.name ?? 'Draw a study boundary or load a saved area.'}
        action={
          <span className="fb-map-reference">
            <Maximize2 size={13} />
            WGS 84
          </span>
        }
      />
      <div className="fb-map-toolbar">
        <label>
          <Layers2 size={14} />
          <input
            type="checkbox"
            checked={showLayer}
            disabled={!analysisId}
            onChange={(event) => onShowLayer(event.target.checked)}
          />
          Native detections
        </label>
        <div className="geo-map-modes" aria-label="Detection display">
          <button type="button" aria-pressed={!inspectRecords} disabled={filtered} onClick={() => setRecordMode(false)}>Aggregate tiles</button>
          <button type="button" aria-pressed={inspectRecords} onClick={() => setRecordMode(true)}>Inspect records</button>
        </div>
      </div>
      <div className="geo-spatial-body">
      <MapBoundary>
        <Suspense
          fallback={
            <div className="fb-map-loading"><Skeleton height={480} label="Loading spatial tools…" /></div>
          }
        >
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
            apiAnalysisId={inspectRecords ? undefined : analysisId}
            clearDrawingToken={clearToken}
            onAreaDrawn={onDraw}
            onAreaRejected={onReject}
            onClearArea={onClear}
            promptDraw={!area && !analysisId}
          />
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
      <div className="fb-map-caption">
        <div>
          <span className="fb-legend-record" />
          Native records
          <span className="fb-legend-boundary" />
          Study boundary · WGS 84
        </div>
        <p>
          {analysisId
            ? inspectRecords ? 'Equal-size points represent loaded records. Select a point to inspect its raw values.' : 'Marker size reflects aggregated record count for the full saved interval. Empty tiles do not establish an absence of fire.'
            : 'Your boundary is a draft until saved. Background imagery, when configured, is contextual.'}
        </p>
      </div>
    </section>
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
