import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, Compass, Link2 } from 'lucide-react'
import { useAnalysis, useArea } from '../../hooks/useFirebridge'
import type { AreaOfInterest } from '../../types'
import { ObservationSummary } from '../observations/ObservationSummary'
import { ObservationsPanel } from '../observations/ObservationsPanel'
import { ProvenancePanel } from '../observations/ProvenancePanel'
import { ContextPanel } from '../observations/ContextPanel'
import { AreaPanel } from './AreaPanel'
import { AnalysisPanel } from './AnalysisPanel'
import { ExportPanel } from './ExportPanel'
import { HealthStatus } from './HealthStatus'
import { SpatialPanel } from './SpatialPanel'
import { parseAreaGeometry } from './validation'
import './workspace.css'

export default function AnalysisWorkspace() {
  const [params, setParams] = useSearchParams()
  const analysisId = params.get('analysis') || undefined
  const analysis = useAnalysis(analysisId)
  const areaId = analysis.data?.area_id ?? (params.get('area') || undefined)
  const area = useArea(areaId)
  const [geometryText, setGeometryText] = useState('')
  const [drawingError, setDrawingError] = useState<unknown>(null)
  const [clearToken, setClearToken] = useState(0)
  const [showLayer, setShowLayer] = useState(true)
  const [copyMessage, setCopyMessage] = useState('')
  const mapArea = useMemo<AreaOfInterest | null>(() => {
    if (area.data)
      return {
        id: area.data.id,
        name: area.data.name,
        geometry: area.data.geometry,
        provenance: 'user-drawn',
      }
    try {
      return {
        id: 'unsaved-boundary',
        name: 'Unsaved boundary',
        geometry: parseAreaGeometry(geometryText),
        provenance: 'user-drawn',
      }
    } catch {
      return null
    } // Submission provides validation feedback; invalid draft text remains editable.
  }, [area.data, geometryText])
  const available =
    !!analysis.data &&
    !analysis.isError &&
    ['ready', 'partial'].includes(analysis.data.status) &&
    analysis.data.time_basis === 'utc' &&
    analysis.data.components.some((c) => c.component === 'satellite' && c.status === 'ready')
  const resultId = available ? analysisId : undefined
  const onDraw = useCallback(
    (geometry: GeoJSON.Polygon) => {
      setGeometryText(JSON.stringify(geometry, null, 2))
      setDrawingError(null)
      setParams({})
    },
    [setParams],
  )
  const onReject = useCallback((reason: string) => setDrawingError(new Error(reason)), [])
  const onClear = useCallback(() => {
    setGeometryText('')
    setParams({})
    setClearToken((value) => value + 1)
  }, [setParams])
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyMessage('Workspace link copied.')
    } catch {
      setCopyMessage('Copy the page address from your browser to share this selection.')
    }
  }
  return (
    <div className="fb-workspace" id="workspace-top">
      <header className="fb-page-heading">
        <div>
          <span className="fb-eyebrow">
            <Compass size={13} />
            FIELD WORKSPACE / NATIVE OBSERVATIONS
          </span>
          <h1>Analysis workspace</h1>
          <p>A clear view of the records, their spatial context and the evidence behind them.</p>
        </div>
        <div className="fb-heading-actions">
          <a
            href="#request-analysis"
            onClick={() => {
              const editor = document.getElementById('analysis-editor')
              if (editor instanceof HTMLDetailsElement) editor.open = true
            }}
            className="button button-primary"
          >
            {analysisId ? 'New analysis' : 'Set up an analysis'}
            <ArrowDown size={14} />
          </a>
          <button
            type="button"
            className="button button-secondary"
            disabled={!analysisId && !areaId}
            onClick={() => {
              void copyLink()
            }}
          >
            <Link2 size={14} />
            Copy workspace link
          </button>
        </div>
      </header>
      {copyMessage && (
        <p className="fb-copy-message" role="status">
          {copyMessage}
        </p>
      )}
      <HealthStatus />
      <ObservationSummary analysisId={resultId} releaseId={analysis.data?.release_id} />
      <div className="fb-workspace-grid grid gap-5 xl:grid-cols-2">
        <div className="fb-workflow">
          <div id="study-area">
            <AreaPanel
              id={areaId}
              onSelect={(id) => {
                setParams({ area: id })
                setDrawingError(null)
              }}
              geometryText={geometryText}
              onGeometryText={setGeometryText}
            />
          </div>
          <div id="request-analysis">
            <AnalysisPanel
              areaId={area.data && !area.isError ? areaId : undefined}
              analysis={analysis.data}
              loading={!!analysisId && analysis.isPending}
              error={analysis.error}
              refresh={() => {
                void analysis.refetch()
              }}
              onSelect={(id) => setParams({ analysis: id })}
            />
          </div>
        </div>
        <div className="fb-results">
          <SpatialPanel
            area={mapArea}
            analysisId={available ? analysis.data?.id : undefined}
            showLayer={showLayer}
            onShowLayer={setShowLayer}
            clearToken={clearToken}
            onDraw={onDraw}
            onReject={onReject}
            onClear={onClear}
            error={drawingError}
          />
          <div id="export-results">
            {analysis.data ? (
              <ExportPanel
                key={analysis.data.id}
                analysisId={analysis.data.id}
                available={available}
              />
            ) : (
              <div className="fb-export-placeholder">
                <span className="fb-eyebrow">EXPORTS</span>
                <p>
                  Save an area and request an analysis to prepare CSV, GeoJSON or Parquet files.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      <ObservationsPanel key={`observations-${analysisId ?? 'empty'}`} analysisId={resultId} />
      <ProvenancePanel analysisId={resultId} />
      <ContextPanel key={`context-${analysisId ?? 'empty'}`} analysisId={resultId} />
      <footer className="fb-workspace-footer">
        <span>FIREBRIDGE / Evidence-led earth observation</span>
        <span>Public workspace · Native records · UTC time basis</span>
      </footer>
    </div>
  )
}
