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
  CalendarDays,
  SlidersHorizontal,
  LayoutDashboard,
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
import { ApiError, Status } from './Feedback'
import { ObservationFilterBar } from '../observations/ObservationFilters'
import { TemporalPanel, SourceComparison } from '../observations/TemporalPanel'
import { emptyObservationFilters, type ObservationFilters } from '../observations/filters'
import { useRelease } from '../observations/useResults'
import { Banner } from '../../components/ui/Banner'
import { Button } from '../../components/ui/Button'
import { CopyableId } from '../../components/ui/CopyableId'
import { Skeleton } from '../../components/ui/Skeleton'
import { Stepper } from '../../components/ui/Stepper'
import { requestDisabledReason, workflowSteps, type WorkflowPresentation } from './workspace.presentation'
import './workspace.presentation.css'
import { TabIndicator } from '../../components/ui/TabIndicator'

const sections = [
  { id: 'workspace-top', label: 'Map workspace', icon: MapPinned },
  { id: 'analysis-overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'observation-records', label: 'Observations', icon: Table2 },
  { id: 'temporal-analysis', label: 'Timeline', icon: CalendarDays },
  { id: 'source-comparison', label: 'Compare sources', icon: Layers2 },
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
  const [filterState, setFilterState] = useState<{ id?: string; value: ObservationFilters }>({ value: emptyObservationFilters })
  const filters = filterState.id === analysisId ? filterState.value : emptyObservationFilters
  const changeFilters = (value: ObservationFilters) => setFilterState({ id: analysisId, value })
  const analysis = useAnalysis(analysisId)
  const release = useRelease(analysis.data?.release_id)
  const areaId = analysis.data?.area_id ?? (params.get('area') || undefined)
  const area = useArea(areaId)
  const [geometryText, setGeometryText] = useState('')
  const [drawingError, setDrawingError] = useState<unknown>(null)
  const [clearToken, setClearToken] = useState(0)
  const [showLayer, setShowLayer] = useState(true)
  const [copyMessage, setCopyMessage] = useState('')
  const setupRequested = useRef(false)
  const setupPanel = useRef<HTMLDetailsElement>(null)
  const savedAreaAvailable = !!area.data && !area.isError
  const [workflowState, setWorkflowState] = useState<WorkflowPresentation>({ start: '', end: '', pending: false })
  const [areaSaving, setAreaSaving] = useState(false)
  const disabledReason = requestDisabledReason(savedAreaAvailable, workflowState)
  const steps = workflowSteps(savedAreaAvailable, workflowState, analysis.isError ? undefined : analysis.data)
  const openAreaForm = () => {
    if (setupPanel.current) setupPanel.current.open = true
    const editor = document.querySelector<HTMLDetailsElement>('#study-area .fb-editor')
    if (editor) editor.open = true
  }
  const startDrawing = () => {
    const draw = document.querySelector<HTMLButtonElement>('#spatial-workspace [aria-label="Draw area of interest"]')
    draw?.click()
    const target = document.getElementById('spatial-workspace')
    target?.scrollIntoView({ block: 'nearest' })
    document.querySelector<HTMLButtonElement>('#spatial-workspace [aria-label="Cancel area drawing"]')?.focus({ preventScroll: true })
  }
  const focusSetup = useCallback(() => {
    if (setupPanel.current) setupPanel.current.open = true
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
    <div className={`fb-workspace geo-analysis-page fw-workspace ${activeSection === 'workspace-top' ? 'geo-map-active' : ''}`} id="workspace-top">
      <header className="fb-page-heading">
        <div>
          <span className="fb-eyebrow">
            <Compass size={13} />
            RESEARCH / NATIVE OBSERVATIONS
          </span>
          <h1>Analysis workspace</h1>
          <p>Satellite context, native observations and the evidence behind each record.</p>
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
            className="ui-button ui-button--primary"
          >
            {analysisId ? 'New analysis' : 'Set up an analysis'}
            <ArrowDown size={14} />
          </a>
          <Button
            type="button"
            variant="secondary"
            disabled={!analysisId && !areaId}
            onClick={() => {
              void copyLink()
            }}
          >
            <Link2 size={14} />
            Copy workspace link
          </Button>
        </div>
      </header>
      {copyMessage && (
        <p className="fb-copy-message" role="status">
          {copyMessage}
        </p>
      )}
      {analysis.data && (
        <div className="astra-analysis-selection">
          <div>
            <strong>{area.data?.name ?? 'Selected study area'}</strong>
            <small>
              {analysis.data.start_date} → {analysis.data.end_date_exclusive} · end excluded · UTC
            </small>
            <CopyableId value={analysis.data.id} label="analysis ID" />
          </div>
          <Status value={analysis.data.status} />
        </div>
      )}
      {analysis.data && <Banner tone="info" title="Pinned dataset" className="fw-release-banner"><strong>{release.data?.name ?? 'Release metadata unavailable'}</strong><CopyableId value={analysis.data.release_id} label="release ID" />{release.isError && <p>Release metadata unavailable</p>}</Banner>}
      {analysisId && analysis.isPending && <Skeleton height={88} label="Loading the selected analysis…" />}
      {analysis.isError && analysis.data && <Banner tone="warning">Previously loaded analysis details are shown; the latest refresh failed. Result availability still follows the existing checks.</Banner>}
      <ApiError context="analysis" error={analysis.error} retry={() => { void analysis.refetch() }} />
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
        <TabIndicator />
      </div>
      <div id="panel-analysis-overview" role="tabpanel" aria-labelledby="tab-analysis-overview" hidden={activeSection !== 'analysis-overview'}>
        {mounted('analysis-overview') && <><ObservationSummary analysisId={resultId} releaseId={analysis.data?.release_id} status={analysis.data?.status} /><SourceComparison analysisId={resultId} /></>}
      </div>
      {['workspace-top', 'observation-records', 'temporal-analysis'].includes(activeSection) &&
        <ObservationFilterBar analysisId={resultId} value={filters} onChange={changeFilters} />}
      <div
        id="panel-workspace-top"
        role="tabpanel"
        aria-labelledby="tab-workspace-top"
        hidden={activeSection !== 'workspace-top'}
      >
        <div className="fw-action-strip" aria-label="Workflow actions">
          <p id="fw-request-reason">{disabledReason ?? 'Ready to request using the saved area and visible UTC interval.'}</p>
          <Button onClick={focusSetup}>Open workflow</Button>
          {!savedAreaAvailable && <Button type="submit" form="area-create-form" aria-label="Save area from workflow" loading={areaSaving} onClick={openAreaForm}>Save area</Button>}
          <Button type="submit" form="analysis-create-form" variant="primary" aria-label="Request analysis from workflow" disabled={!!disabledReason} aria-describedby="fw-request-reason" onClick={() => { if (setupPanel.current) setupPanel.current.open = true; const editor = document.getElementById('analysis-editor'); if (editor instanceof HTMLDetailsElement) editor.open = true }}>Request analysis</Button>
        </div>
        <div className="fb-workspace-grid geo-workspace-grid">
          <details ref={setupPanel} className="geo-setup" open={!analysisId}>
          <summary><SlidersHorizontal size={15} /><strong>Analysis configuration</strong><span>Area · UTC interval · processing</span></summary>
          <div className="fw-steps"><Stepper label="Analysis workflow" steps={steps} /></div>
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
                onStartDrawing={startDrawing}
                onSavingState={setAreaSaving}
              />
            </div>
            <div id="request-analysis">
              <AnalysisPanel
                areaId={area.data && !area.isError ? areaId : undefined}
                analysis={analysis.data}
                loading={!!analysisId && analysis.isPending}
                error={null}
                refresh={() => {
                  void analysis.refetch()
                }}
                onSelect={(id) => setParams({ analysis: id })}
                onWorkflowState={setWorkflowState}
              />
            </div>
          </div>
          </details>
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
              filters={filters}
              onSetup={focusSetup}
            />
            <TemporalPanel analysisId={resultId} filters={filters} onChange={changeFilters} compact />
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
          <ObservationsPanel key={`observations-${analysisId ?? 'empty'}`} analysisId={resultId} filters={filters} />
        )}
      </div>
      <div id="panel-temporal-analysis" role="tabpanel" aria-labelledby="tab-temporal-analysis" hidden={activeSection !== 'temporal-analysis'}>
        {mounted('temporal-analysis') && <TemporalPanel analysisId={resultId} filters={filters} onChange={changeFilters} />}
      </div>
      <div id="panel-source-comparison" role="tabpanel" aria-labelledby="tab-source-comparison" hidden={activeSection !== 'source-comparison'}>
        {mounted('source-comparison') && <SourceComparison analysisId={resultId} />}
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
              metadata={{ releaseId: analysis.data.release_id, start: analysis.data.start_date, endExclusive: analysis.data.end_date_exclusive, areaName: area.data?.name }}
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
      <details className="geo-system-status"><summary>Service health & data readiness</summary><HealthStatus /></details>
      <footer className="fb-workspace-footer">
        <span>FIREBRIDGE / Evidence-led earth observation</span>
        <span>Public workspace · Native records · UTC time basis</span>
      </footer>
    </div>
  )
}
