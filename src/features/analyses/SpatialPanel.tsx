import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Layers2, Maximize2 } from 'lucide-react'
import type { AreaOfInterest } from '../../types'
import { SectionHeading } from '../../components/workspace/SectionHeading'
import { ApiError } from './Feedback'
import { logDiagnostic } from '../../lib/userFeedback'

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
}) {
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
        <span>{analysisId ? 'Aggregated vector tiles' : 'Awaiting satellite results'}</span>
      </div>
      <MapBoundary>
        <Suspense
          fallback={
            <div className="fb-map-loading" role="status">
              Loading spatial tools…
            </div>
          }
        >
          <MapView
            apiMode
            records={noRecords}
            selectedId={null}
            onSelect={() => {}}
            area={area}
            showArea
            showDetections={showLayer}
            apiAnalysisId={analysisId}
            clearDrawingToken={clearToken}
            onAreaDrawn={onDraw}
            onAreaRejected={onReject}
            onClearArea={onClear}
          />
        </Suspense>
      </MapBoundary>
      <ApiError error={error} />
      <div className="fb-map-caption">
        <div>
          <span className="fb-legend-record" />
          Native records
          <span className="fb-legend-boundary" />
          Study boundary
        </div>
        <p>
          {analysisId
            ? 'Marker size reflects aggregated record count. Empty tiles do not establish an absence of fire.'
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
