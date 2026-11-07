import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  Compass,
  Database,
  FileDown,
  Layers2,
  Link2,
  MapPinned,
  Table2,
} from 'lucide-react'
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
import { UserInputError } from '../../lib/userFeedback'
import { Status } from './Feedback'

const sections = [
  { id: 'workspace-top', label: 'Set up & map', icon: MapPinned },
  { id: 'observation-records', label: 'Observations', icon: Table2 },
  { id: 'data-provenance', label: 'Data & provenance', icon: Database },
  { id: 'analysis-context', label: 'Context & notes', icon: Layers2 },
  { id: 'export-results', label: 'Exports', icon: FileDown },
]

export default function AnalysisWorkspace() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection =
    sections.find((section) => '#' + section.id === location.hash)?.id ?? 'workspace-top'
  const [visited, setVisited] = useState<string[]>(['workspace-top', activeSection])
  function selectSection(id: string) {
    setVisited((current) => (current.includes(id) ? current : [...current, id]))
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: id === 'workspace-top' ? '' : '#' + id,
      },
      { replace: true, preventScrollReset: true },
    )
  }
  const mounted = (id: string) => visited.includes(id) || activeSection === id
  const analysisId = params.get('analysis') || undefined
  const analysis = useAnalysis(analysisId)
  const areaId = analysis.data?.area_id ?? (params.get('area') || undefined)
  const area = useArea(areaId)
  const [geometryText, setGeometryText] = useState('')
  const [drawingError, setDrawingError] = useState<unknown>(null)
  const [clearToken, setClearToken] = useState(0)
  const [showLayer, setShowLayer] = useState(true)
  const [copyMessage, setCopyMessage] = useState('')
  const setupRequested = useRef(false)
  const savedAreaAvailable = !!area.data && !area.isError
  const focusSetup = useCallback(() => {
    const target = document.getElementById(savedAreaAvailable ? 'request-analysis' : 'study-area')
    const editor = target?.querySelector('details')
    if (editor instanceof HTMLDetailsElement) editor.open = true
    target?.scrollIntoView({ block: 'center' })
    target?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
  }, [savedAreaAvailable])
  useEffect(() => {
    if (activeSection !== 'workspace-top' || !setupRequested.current) return
    setupRequested.current = false
    focusSetup()
  }, [activeSection, focusSetup])
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
  const onReject = useCallback((reason: string) => setDrawingError(new UserInputError(reason)), [])
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
            RESEARCH / NATIVE OBSERVATIONS
          </span>
          <h1>Analysis workspace</h1>
          <p>A clear view of the records, their spatial context and the evidence behind them.</p>
        </div>
        <div className="fb-heading-actions">
          <a
            href="#request-analysis"
            onClick={(event) => {
              event.preventDefault()
              if (activeSection === 'workspace-top') focusSetup()
              else {
                setupRequested.current = true
                selectSection('workspace-top')
              }
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
      <ol className="astra-analysis-steps" aria-label="Analysis workflow">
        <li data-complete={!!area.data}>
          <span>01</span>Define your area
        </li>
        <li data-complete={!!analysis.data}>
          <span>02</span>Configure & run
        </li>
        <li data-complete={available}>
          <span>03</span>Explore the evidence
        </li>
      </ol>
      <HealthStatus />
      {analysis.data && (
        <div className="astra-analysis-selection">
          <div>
            <strong>{area.data?.name ?? 'Selected study area'}</strong>
            <small>
              {analysis.data.start_date} → {analysis.data.end_date_exclusive} · End excluded · UTC
            </small>
            <code>{analysis.data.id}</code>
          </div>
          <Status value={analysis.data.status} />
        </div>
      )}
      <ObservationSummary
        analysisId={resultId}
        releaseId={analysis.data?.release_id}
        status={analysis.data?.status}
      />
      <div
        className="astra-analysis-tabs"
        role="tablist"
        aria-label="Analysis sections"
        onKeyDown={(event) => {
          const index = sections.findIndex((section) => section.id === activeSection)
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % sections.length
              : event.key === 'ArrowLeft'
                ? (index + sections.length - 1) % sections.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? sections.length - 1
                    : -1
          if (next < 0) return
          event.preventDefault()
          selectSection(sections[next].id)
          document.getElementById('tab-' + sections[next].id)?.focus()
        }}
      >
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={'tab-' + id}
            type="button"
            role="tab"
            aria-selected={activeSection === id}
            aria-controls={'panel-' + id}
            tabIndex={activeSection === id ? 0 : -1}
            onClick={() => selectSection(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div
        id="panel-workspace-top"
        role="tabpanel"
        aria-labelledby="tab-workspace-top"
        hidden={activeSection !== 'workspace-top'}
      >
        <div className="fb-workspace-grid">
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
              showLayer={showLayer && activeSection === 'workspace-top'}
              onShowLayer={setShowLayer}
              clearToken={clearToken}
              onDraw={onDraw}
              onReject={onReject}
              onClear={onClear}
              error={drawingError}
            />
          </div>
        </div>
      </div>
      <div
        id="panel-observation-records"
        role="tabpanel"
        aria-labelledby="tab-observation-records"
        hidden={activeSection !== 'observation-records'}
      >
        {mounted('observation-records') && (
          <ObservationsPanel key={`observations-${analysisId ?? 'empty'}`} analysisId={resultId} />
        )}
      </div>
      <div
        id="panel-data-provenance"
        role="tabpanel"
        aria-labelledby="tab-data-provenance"
        hidden={activeSection !== 'data-provenance'}
      >
        {mounted('data-provenance') && <ProvenancePanel analysisId={resultId} initiallyExpanded />}
      </div>
      <div
        id="panel-analysis-context"
        role="tabpanel"
        aria-labelledby="tab-analysis-context"
        hidden={activeSection !== 'analysis-context'}
      >
        {mounted('analysis-context') && (
          <ContextPanel
            key={`context-${analysisId ?? 'empty'}`}
            analysisId={resultId}
            initiallyExpanded
          />
        )}
      </div>
      <div
        id="panel-export-results"
        role="tabpanel"
        aria-labelledby="tab-export-results"
        hidden={activeSection !== 'export-results'}
      >
        {mounted('export-results') &&
          (analysis.data ? (
            <ExportPanel
              key={analysis.data.id}
              analysisId={analysis.data.id}
              available={available}
            />
          ) : (
            <section className="fb-section">
              <h2>Export results</h2>
              <p className="fb-empty">
                Save an area and request an analysis to prepare CSV, GeoJSON or Parquet files.
              </p>
            </section>
          ))}
      </div>
      <footer className="fb-workspace-footer">
        <span>FIREBRIDGE / Evidence-led earth observation</span>
        <span>Public workspace · Native records · UTC time basis</span>
      </footer>
    </div>
  )
}
