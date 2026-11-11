import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  CalendarRange,
  ChevronDown,
  Database,
  FileDown,
  Layers2,
  Link2,
  MapPinned,
  MessageSquareText,
  Plus,
  Sparkles,
  Table2,
  CalendarDays,
  SlidersHorizontal,
  Satellite,
  GitCompareArrows,
  CalendarSearch,
} from 'lucide-react'
import { useAnalysis, useArea } from '../../hooks/useFirebridge'
import type { AreaOfInterest } from '../../types'
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
import { AnalysisInsights, InsightsRail } from '../insights/AnalysisInsights'
import type { DayCell } from '../insights/computeInsights'
import { Banner } from '../../components/ui/Banner'
import { Button } from '../../components/ui/Button'
import { CopyableId } from '../../components/ui/CopyableId'
import { Skeleton } from '../../components/ui/Skeleton'
import { Stepper } from '../../components/ui/Stepper'
import { analysisPreparationStage, requestDisabledReason, workflowSteps, type WorkflowPresentation } from './workspace.presentation'
import { useAnalysisLaunch } from './useAnalysisLaunch'
import { TabIndicator } from '../../components/ui/TabIndicator'
import { AnalysisPreparation } from './AnalysisPreparation'
import { BridgePanel } from '../bridge/BridgePanel'
import { EpisodesCard } from '../bridge/EpisodesCard'
import { CalendarPanel } from '../bridge/CalendarPanel'
import { VerdictCard } from '../bridge/VerdictCard'
import { CopilotProvider } from '../copilot/CopilotProvider'
import { reveal } from '../copilot/reveal'
import type { CopilotNav } from '../copilot/actions'

const sections = [
  { id: 'workspace-top', label: 'Map workspace', icon: MapPinned },
  { id: 'analysis-overview', label: 'Overview', icon: Sparkles },
  { id: 'fire-calendar', label: 'Fire calendar', icon: CalendarSearch },
  { id: 'sensor-bridge', label: 'Sensor bridge', icon: GitCompareArrows },
  { id: 'observation-records', label: 'Observations', icon: Table2 },
  { id: 'temporal-analysis', label: 'Timeline', icon: CalendarDays },
  { id: 'source-comparison', label: 'Compare sources', icon: Layers2 },
  { id: 'data-provenance', label: 'Data & provenance', icon: Database },
  { id: 'analysis-context', label: 'Context & notes', icon: MessageSquareText },
  { id: 'export-results', label: 'Exports', icon: FileDown },
]

function humanInterval(start: string, endExclusive: string) {
  const s = new Date(`${start.slice(0, 10)}T00:00:00Z`)
  const e = new Date(Date.parse(`${endExclusive.slice(0, 10)}T00:00:00Z`) - 86_400_000)
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return `${start} → ${endExclusive}`
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return s.valueOf() === e.valueOf() ? fmt(s) : `${fmt(s)} – ${fmt(e)}`
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

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
  // Until the new analysis is first read, its acceptance describes it (status, area); the previous selection
  // the URL may still show during the router transition is ignored.
  const { accepted, awaitingRoute, accept } = useAnalysisLaunch(analysisId)
  const selectedAnalysis = awaitingRoute ? undefined : analysis.data
  const areaId = selectedAnalysis?.area_id ?? accepted?.areaId ?? (params.get('area') || undefined)
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
  const preparationStage = analysisPreparationStage(workflowState.pending, selectedAnalysis, analysis.isError && !awaitingRoute, accepted?.status)
  // While a request is in flight the selected analysis (if any) is the previous one: describe the request instead.
  const draftInterval = workflowState.start && workflowState.end ? humanInterval(workflowState.start, workflowState.end) : undefined
  const preparationInterval = preparationStage === 'submitting' || !selectedAnalysis
    ? draftInterval
    : humanInterval(selectedAnalysis.start_date, selectedAnalysis.end_date_exclusive)
  const openAreaForm = () => {
    if (setupPanel.current) setupPanel.current.open = true
    const editor = document.querySelector<HTMLDetailsElement>('#study-area .fb-editor')
    if (editor) editor.open = true
  }
  const startDrawing = () => {
    // Rectangles are the quickest study areas; polygons stay one click away on the map toolbar.
    const draw = document.querySelector<HTMLButtonElement>('#spatial-workspace [aria-label="Draw rectangle"]')
    draw?.click()
    const target = document.getElementById('spatial-workspace')
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#spatial-workspace [data-draw-cancel]')?.focus({ preventScroll: true }))
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
      // Guide straight to the next action: name and save the drawn area.
      requestAnimationFrame(() => {
        if (setupPanel.current) setupPanel.current.open = true
        const editor = document.querySelector<HTMLDetailsElement>('#study-area .fb-editor')
        if (editor) editor.open = true
        document.querySelector<HTMLInputElement>('#study-area input[name="name"], #study-area input[type="text"]')?.focus({ preventScroll: true })
      })
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
  const showIntervalOnMap = (start: string, endExclusive: string) => {
    changeFilters({ ...filters, start, endExclusive })
    selectSection('workspace-top')
    requestAnimationFrame(() => document.getElementById('spatial-workspace')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const showDayOnMap = (cell: DayCell) => showIntervalOnMap(cell.date, nextDay(cell.date))
  const openSection = (id: string, anchor?: string) => {
    selectSection(id)
    if (anchor) reveal(anchor)
    else requestAnimationFrame(() => document.querySelector('.fbx-tabs-wrap')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  // The copilot navigates the workspace; a stable object keeps its answers from re-rendering.
  const navTargets = useRef({ openSection, showIntervalOnMap })
  useEffect(() => {
    navTargets.current = { openSection, showIntervalOnMap }
  })
  const copilotNav = useMemo<Omit<CopilotNav, 'focusMonth'>>(
    () => ({ openSection: (id, anchor) => navTargets.current.openSection(id, anchor), showInterval: (start, end) => navTargets.current.showIntervalOnMap(start, end) }),
    [],
  )
  const setupAction = (event: React.MouseEvent) => {
    event.preventDefault()
    if (activeSection === 'workspace-top') focusSetup()
    else {
      setupRequested.current = true
      selectSection('workspace-top')
    }
  }

  return (
    <CopilotProvider analysisId={resultId} releaseId={analysis.data?.release_id} section={activeSection} nav={copilotNav}>
    <div
      className={`fb-workspace geo-analysis-page fw-workspace fbx-workspace ${activeSection === 'workspace-top' ? 'geo-map-active' : ''}`}
      id="workspace-top"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <p className="m-0 mb-2 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-300">
            <Satellite size={13} aria-hidden="true" />
            {analysis.data ? 'Analysis' : 'Native observations'}
          </p>
          <h1 className="m-0 text-[clamp(24px,2.4vw,32px)] font-semibold leading-tight tracking-[-0.03em] text-fg">
            {analysis.data ? area.data?.name ?? 'Selected study area' : 'Analysis workspace'}
          </h1>
          {analysis.data ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] [&>*]:shrink-0 [&>*]:whitespace-nowrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-fg-2" title={`${analysis.data.start_date} → ${analysis.data.end_date_exclusive} · end excluded · UTC`}>
                <CalendarRange size={13} aria-hidden="true" />
                {humanInterval(analysis.data.start_date, analysis.data.end_date_exclusive)}
                <span className="font-mono text-[10.5px] text-fg-3">UTC</span>
              </span>
              <Status value={analysis.data.status} />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] py-0.5 pl-3 pr-1 text-fg-2" title={release.data?.name ?? 'Release metadata unavailable'}>
                <Database size={13} aria-hidden="true" />
                Pinned release
                <CopyableId value={analysis.data.release_id} label="release ID" />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] py-0.5 pl-3 pr-1 text-fg-2">
                ID
                <CopyableId value={analysis.data.id} label="analysis ID" />
              </span>
            </div>
          ) : (
            <p className="mb-0 mt-2 max-w-2xl text-[14.5px] text-fg-2">
              Draw a study area on the map, choose a UTC interval and request an analysis of native MODIS and VIIRS detections.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={!analysisId && !areaId} onClick={() => { void copyLink() }}>
            <Link2 size={14} />
            Copy workspace link
          </Button>
          <a href="#request-analysis" onClick={setupAction} className="ui-button ui-button--primary">
            {analysisId ? <Plus size={15} aria-hidden="true" /> : null}
            {analysisId ? 'New analysis' : 'Set up an analysis'}
            {!analysisId && <ArrowDown size={14} />}
          </a>
        </div>
      </header>
      {copyMessage && (
        <p className="fb-copy-message m-0 text-[13px] text-ok" role="status">
          {copyMessage}
        </p>
      )}
      {analysisId && analysis.isPending && !preparationStage && <Skeleton height={56} label="Loading the selected analysis…" />}
      {analysis.isError && analysis.data && <Banner tone="warning">Previously loaded analysis details are shown; the latest refresh failed. Result availability still follows the existing checks.</Banner>}
      <ApiError context="analysis" error={analysis.error} retry={() => { void analysis.refetch() }} />
      {preparationStage && (
        <AnalysisPreparation
          stage={preparationStage}
          areaName={area.data?.name}
          geometry={area.data?.geometry}
          interval={preparationInterval}
          startedAt={selectedAnalysis?.created_at}
        />
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="fbx-tabs-wrap">
        <div
          className="astra-analysis-tabs fbx-tabs"
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
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
          <TabIndicator />
        </div>
      </div>

      {/* ── Overview ───────────────────────────────────────────────────── */}
      <div id="panel-analysis-overview" role="tabpanel" aria-labelledby="tab-analysis-overview" hidden={activeSection !== 'analysis-overview'} className="fbx-panel">
        {mounted('analysis-overview') && (
          resultId ? (
            <div className="flex flex-col gap-8">
              <VerdictCard analysisId={resultId} onOpenCalendar={() => openSection('fire-calendar')} onOpenBridge={() => openSection('sensor-bridge')} />
              <AnalysisInsights analysisId={resultId} onSelectDay={showDayOnMap} />
              <EpisodesCard analysisId={resultId} onShowEpisode={showIntervalOnMap} onOpenBridge={() => openSection('sensor-bridge')} />
              <SourceComparison analysisId={resultId} />
            </div>
          ) : (
            <EmptyPanel
              title={analysis.data && ['queued', 'running'].includes(analysis.data.status) ? 'Preparing your analysis…' : 'No results yet'}
              text={analysis.data && ['queued', 'running'].includes(analysis.data.status) ? 'Satellite results will appear here as soon as processing completes.' : 'Save an area and request an analysis to see automated insights: seasonal profile, busiest days and per-satellite contributions.'}
              onSetup={setupAction}
            />
          )
        )}
      </div>

      {/* ── Fire calendar (unusual activity, satellite jury) ──────────────── */}
      <div id="panel-fire-calendar" role="tabpanel" aria-labelledby="tab-fire-calendar" hidden={activeSection !== 'fire-calendar'} className="fbx-panel">
        {mounted('fire-calendar') && (
          resultId ? (
            <CalendarPanel analysisId={resultId} onShowEpisode={showIntervalOnMap} />
          ) : (
            <EmptyPanel
              title="No calendar yet"
              text="Request an analysis to see when burning was unusual, judged by every satellite against its own past."
              onSetup={setupAction}
            />
          )
        )}
      </div>

      {/* ── Sensor bridge (harmonization lab) ───────────────────────────── */}
      <div id="panel-sensor-bridge" role="tabpanel" aria-labelledby="tab-sensor-bridge" hidden={activeSection !== 'sensor-bridge'} className="fbx-panel">
        {mounted('sensor-bridge') && (
          resultId ? (
            <BridgePanel analysisId={resultId} releaseId={analysis.data?.release_id} />
          ) : (
            <EmptyPanel
              title="No analysis to harmonize yet"
              text="Request an analysis to compare satellites on a common Aqua-equivalent scale, run the withheld-satellite experiment and see how much of a difference comes from the observing system."
              onSetup={setupAction}
            />
          )
        )}
      </div>

      {['observation-records', 'temporal-analysis'].includes(activeSection) &&
        <ObservationFilterBar analysisId={resultId} value={filters} onChange={changeFilters} />}

      {/* ── Map workspace ──────────────────────────────────────────────── */}
      <div id="panel-workspace-top" role="tabpanel" aria-labelledby="tab-workspace-top" hidden={activeSection !== 'workspace-top'} className="fbx-panel">
        <div className="fbx-map-grid">
          <div className="flex min-w-0 flex-col gap-5">
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
              onFiltersChange={changeFilters}
              onSetup={focusSetup}
            />
          </div>
          <aside className="flex min-w-0 flex-col gap-4" aria-label="Analysis setup and summary">
            <InsightsRail analysisId={resultId} onOpenOverview={() => selectSection('analysis-overview')} />
            <div className="fw-action-strip fbx-next-step" aria-label="Workflow actions">
              <div className="flex items-start gap-3">
                <span className={`mt-1 size-2 shrink-0 rounded-full ${disabledReason ? 'bg-warn' : 'bg-ok'}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">{analysisId ? 'Start another analysis' : 'Next step'}</p>
                  <p id="fw-request-reason" className="m-0 mt-1 text-[13.5px] text-fg">{disabledReason ?? 'Ready to request using the saved area and visible UTC interval.'}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" onClick={focusSetup}>Open workflow</Button>
                {!savedAreaAvailable && <Button size="small" type="submit" form="area-create-form" aria-label="Save area from workflow" loading={areaSaving} onClick={openAreaForm}>Save area</Button>}
                <Button size="small" type="submit" form="analysis-create-form" variant="primary" aria-label="Request analysis from workflow" disabled={!!disabledReason} aria-describedby="fw-request-reason" onClick={() => { if (setupPanel.current) setupPanel.current.open = true; const editor = document.getElementById('analysis-editor'); if (editor instanceof HTMLDetailsElement) editor.open = true }}>Request analysis</Button>
              </div>
            </div>
            <details ref={setupPanel} className="geo-setup fbx-setup" open={!analysisId}>
              <summary>
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <strong>Analysis configuration</strong>
                  <span>Area · UTC interval · processing</span>
                </span>
                <ChevronDown size={16} className="fbx-setup-chevron ml-auto shrink-0" aria-hidden="true" />
              </summary>
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
                    onAccepted={accept}
                  />
                </div>
              </div>
            </details>
            {activeSection === 'workspace-top' && <ObservationFilterBar analysisId={resultId} value={filters} onChange={changeFilters} />}
          </aside>
        </div>
      </div>

      <div id="panel-observation-records" role="tabpanel" aria-labelledby="tab-observation-records" hidden={activeSection !== 'observation-records'} className="fbx-panel">
        {mounted('observation-records') && (
          <ObservationsPanel key={`observations-${analysisId ?? 'empty'}`} analysisId={resultId} filters={filters} />
        )}
      </div>
      <div id="panel-temporal-analysis" role="tabpanel" aria-labelledby="tab-temporal-analysis" hidden={activeSection !== 'temporal-analysis'} className="fbx-panel">
        {mounted('temporal-analysis') && <TemporalPanel analysisId={resultId} filters={filters} onChange={changeFilters} />}
      </div>
      <div id="panel-source-comparison" role="tabpanel" aria-labelledby="tab-source-comparison" hidden={activeSection !== 'source-comparison'} className="fbx-panel">
        {mounted('source-comparison') && <SourceComparison analysisId={resultId} />}
      </div>
      <div id="panel-data-provenance" role="tabpanel" aria-labelledby="tab-data-provenance" hidden={activeSection !== 'data-provenance'} className="fbx-panel">
        {mounted('data-provenance') && <ProvenancePanel analysisId={resultId} initiallyExpanded />}
      </div>
      <div id="panel-analysis-context" role="tabpanel" aria-labelledby="tab-analysis-context" hidden={activeSection !== 'analysis-context'} className="fbx-panel">
        {mounted('analysis-context') && (
          <ContextPanel key={`context-${analysisId ?? 'empty'}`} analysisId={resultId} initiallyExpanded />
        )}
      </div>
      <div id="panel-export-results" role="tabpanel" aria-labelledby="tab-export-results" hidden={activeSection !== 'export-results'} className="fbx-panel">
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
              <p className="fb-empty">Save an area and request an analysis to prepare CSV, GeoJSON or Parquet files.</p>
            </section>
          ))}
      </div>
      <details className="geo-system-status fbx-system-status"><summary>Service health & data readiness</summary><HealthStatus /></details>
    </div>
    </CopilotProvider>
  )
}

function EmptyPanel({ title, text, onSetup }: { title: string; text: string; onSetup: (event: React.MouseEvent) => void }) {
  return (
    <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl border border-ember-400/20 bg-ember-500/10 text-ember-300">
        <Sparkles size={24} aria-hidden="true" />
      </span>
      <div className="max-w-md">
        <h2 className="m-0 text-[20px] font-semibold text-fg">{title}</h2>
        <p className="mb-0 mt-2 text-[14px] text-fg-2">{text}</p>
      </div>
      <a href="#request-analysis" onClick={onSetup} className="ui-button ui-button--primary">Open the workflow</a>
    </div>
  )
}
