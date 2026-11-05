import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useQuery, QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, CalendarDays,   Check,  CircleHelp, CloudSun, Compass, Database, Download, Flame, Gauge, Info, Layers2,
  Map, Menu, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, X,
} from 'lucide-react'
import { demoRepository, downloadCsv } from './data'
import { AppStateProvider } from './state'
import { useAppState } from './useAppState'
import type { ActivitySummary, AnalysisSelection, Detection, ReportEvidence, SensorComparison, TemporalSummary } from './types'
import './App.css'

const ActivityChart = lazy(() => import('./components/Charts').then((module) => ({ default: module.ActivityChart })))
const CalendarChart = lazy(() => import('./components/Charts').then((module) => ({ default: module.CalendarChart })))
const SensorBars = lazy(() => import('./components/Charts').then((module) => ({ default: module.SensorBars })))
import type { BasemapMode } from './components/MapView'
import { ChatWidget } from './components/ChatWidget'
import { SensorSelector } from './components/SensorSelector'
import { SidebarMenu } from './components/SidebarMenu'
import { WorkspaceSidebar } from './components/workspace/WorkspaceSidebar'
import { NO_RECORDS_LABEL, selectedWithoutRecords } from './platforms'
const MapView = lazy(() => import('./components/MapView').then((module) => ({ default: module.MapView })))
const AnalysisWorkspace = lazy(() => import('./features/analyses/AnalysisWorkspace'))

const navGroups = [
  { title: 'FIREBRIDGE API', items: [{ to: '/analyses', label: 'Analysis workspace', icon: Activity }] },
  { title: 'Workspace', items: [{ to: '/', label: 'Overview', icon: Compass }, { to: '/explore', label: 'Explore map', icon: Map }, { to: '/compare', label: 'Compare sensors', icon: Layers2 }, { to: '/calendar', label: 'Activity calendar', icon: CalendarDays }] },
  { title: 'Insights', items: [{ to: '/weather', label: 'Weather context', icon: CloudSun }, { to: '/reports', label: 'Reports & events', icon: BookOpen }, { to: '/explain', label: 'Analysis notes', icon: Sparkles }, { to: '/alerts', label: 'Watchlist', icon: AlertTriangle }] },
  { title: 'Project', items: [{ to: '/evidence', label: 'Data & methods', icon: Database }, { to: '/settings', label: 'Preferences', icon: Settings2 }] },
]

const pageTitles: Record<string, string> = {
  '/analyses': 'Analysis workspace',
  '/': 'Overview', '/explore': 'Explore map', '/compare': 'Compare sensors', '/calendar': 'Activity calendar',
  '/weather': 'Weather context', '/reports': 'Reports & events', '/explain': 'Analysis notes', '/alerts': 'Watchlist',
  '/evidence': 'Data & methods', '/settings': 'Preferences',
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <BrowserRouter>
          <AppLayout />
        </BrowserRouter>
      </AppStateProvider>
    </QueryClientProvider>
  )
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<'workspace' | 'session' | null>(null)
  const location = useLocation()
  const pageTitle = pageTitles[location.pathname] ?? 'Overview'
  const apiWorkspace = location.pathname === '/analyses'
  const closeSidebar = () => {
    setSidebarOpen(false)
    if (apiWorkspace && window.matchMedia('(max-width: 760px)').matches)
      document.querySelector<HTMLButtonElement>('.mobile-menu')?.focus()
  }
  return (
    <div className={`app-shell ${apiWorkspace ? 'fb-shell' : ''}`}>
      {sidebarOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={closeSidebar} />}
      <aside id={apiWorkspace ? 'workspace-navigation' : undefined} className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        {apiWorkspace ? <WorkspaceSidebar close={closeSidebar} /> : <>
        <Link to="/" className="brand" onClick={() => setSidebarOpen(false)} aria-label="Astra Mind home">
          <span className="brand-mark"><Flame size={19} fill="currentColor" /></span>
          <span className="brand-text">ASTRA<span>MIND</span></span>
          <span className="brand-beta">{apiWorkspace ? 'API' : 'DEMO'}</span>
        </Link>
        <SidebarMenu
          id="workspace-menu" className="workspace-switcher" placement="below" label="Workspace menu"
          open={openMenu === 'workspace'} onOpenChange={(open) => setOpenMenu(open ? 'workspace' : null)}
          trigger={<><span className="workspace-symbol">F</span><span className="workspace-copy"><strong>FIREBRIDGE</strong><small>Research workspace</small></span></>}
        >
          <p className="sidebar-menu-heading">Current workspace</p>
          <div className="sidebar-menu-summary"><strong>FIREBRIDGE</strong><small>Research workspace for the synthetic Northern Morocco wildfire-monitoring demo.</small></div>
          <p className="sidebar-menu-heading">Workspaces</p>
          <button type="button" role="menuitemradio" aria-checked="true" className="sidebar-menu-item sidebar-menu-item-active"><span className="workspace-symbol">F</span><span>FIREBRIDGE</span><Check size={14} aria-hidden="true" /></button>
          <p className="sidebar-menu-note">This is the only workspace in this demo. Workspace switching is not connected to a backend.</p>
        </SidebarMenu>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <section className="nav-group" key={group.title}>
              <p className="nav-heading">{group.title}</p>
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
                  {to === '/alerts' && <span className="nav-count">0</span>}
                </NavLink>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card"><div><strong>{apiWorkspace ? 'Public analysis workspace' : 'Illustrative mode'}</strong><small>{apiWorkspace ? 'Status shown from API probes' : 'Local synthetic records only'}</small></div></div>
          <SidebarMenu
            id="session-menu" className="sidebar-user" placement="above" label="Session menu"
            open={openMenu === 'session'} onOpenChange={(open) => setOpenMenu(open ? 'session' : null)}
            trigger={<><span className="avatar">FR</span><span className="sidebar-user-copy"><strong>Field researcher</strong><small>Local session</small></span></>}
          >
            <p className="sidebar-menu-heading">Current session</p>
            <div className="sidebar-menu-summary"><strong>Field researcher</strong><small>Local demo session</small></div>
            <p className="sidebar-menu-note">No sign-in is configured. This label is a local placeholder; there is no account, login or logout.</p>
            <Link to="/settings" role="menuitem" className="sidebar-menu-item" onClick={() => setSidebarOpen(false)}><Settings2 size={14} aria-hidden="true" /><span>Preferences</span></Link>
                        <Link to="/evidence" role="menuitem" className="sidebar-menu-item" onClick={() => setSidebarOpen(false)}><Database size={14} aria-hidden="true" /><span>Data & methods</span></Link>
          </SidebarMenu>
        </div>
        </>}
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu" aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls={apiWorkspace ? 'workspace-navigation' : undefined} onClick={() => { setSidebarOpen(true); if (apiWorkspace) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.fb-sidebar-close')?.focus()) }}><Menu size={19} /></button><div className="breadcrumbs"><span>FIREBRIDGE</span><span className="breadcrumb-slash">/</span><strong>{pageTitle}</strong></div></div>
          {apiWorkspace ? <span className="fb-topbar-note">Public research workspace <span>WGS 84 / UTC</span></span> : <GlobalControls />}
        </header>
        {apiWorkspace ? <div className="global-demo-banner fb-api-banner"><Info size={14} /><span><strong>API workspace.</strong> Results come from the backend’s published releases. Data provenance depends on that release; test catalogues may contain synthetic fixtures.</span><Link to="/">Demo views <ArrowRight size={13} /></Link></div> : <div className="global-demo-banner"><Info size={14} /><span><strong>Demo workspace.</strong> All mapped detections and figures are synthetic; no live NASA data, observation coverage, or validated harmonization is connected.</span><Link to="/analyses">Open API workspace <ArrowRight size={13} /></Link></div>}
        <Suspense fallback={<div className="loading-view">Loading workspace…</div>}><AppPages /></Suspense>
      </main>
              {!apiWorkspace && <ChatWidget />}
    </div>
  )
}

function GlobalControls() {
  const { startDate, endDate, setStartDate, setEndDate, searchText, setSearchText, platforms, setPlatforms } = useAppState()
  const [searchOpen, setSearchOpen] = useState(false)
  const [satellitesOpen, setSatellitesOpen] = useState(false)
  return (
    <div className="topbar-controls">
      <div className="satellite-filter-wrap" onKeyDown={(event) => { if (event.key === 'Escape') setSatellitesOpen(false) }}>
        <button type="button" className={`button button-secondary satellite-filter-button ${satellitesOpen ? 'active' : ''}`} aria-expanded={satellitesOpen} aria-haspopup="true" onClick={() => setSatellitesOpen((value) => !value)}><Layers2 size={14} /><span className="satellite-label">Satellites</span> <span className="satellite-count">{platforms.length}/5</span></button>
        {satellitesOpen && <div className="satellite-popover" role="region" aria-label="Satellite filter"><SensorSelector platforms={platforms} setPlatforms={setPlatforms} /></div>}
      </div>
      <label className="date-filter"><CalendarDays size={14} /><span className="sr-only">Start date</span><input aria-label="Start date" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /><span className="date-separator">—</span><span className="sr-only">End date</span><input aria-label="End date" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <div className="global-search-wrap">
        <button className={`icon-button top-search-toggle ${searchOpen ? 'active' : ''}`} aria-label={searchOpen ? 'Close search' : 'Search detections'} onClick={() => setSearchOpen((value) => !value)}>{searchOpen ? <X size={17} /> : <Search size={17} />}</button>
        {searchOpen && <label className="global-search"><Search size={15} /><input autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search demo records…" aria-label="Search synthetic detections" /><button className="icon-button" aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button></label>}
      </div>
      <span className="topbar-status"><span className="status-dot" /> Local demo</span>
    </div>
  )
}

function AppPages() {
  return (
    <Routes>
      <Route path="/analyses" element={<AnalysisWorkspace />} />
      <Route path="/" element={<WorkspacePage page="overview" />} />
      <Route path="/explore" element={<WorkspacePage page="explore" />} />
      <Route path="/compare" element={<WorkspacePage page="compare" />} />
      <Route path="/calendar" element={<WorkspacePage page="calendar" />} />
      <Route path="/weather" element={<WorkspacePage page="weather" />} />
      <Route path="/reports" element={<WorkspacePage page="reports" />} />
      <Route path="/explain" element={<WorkspacePage page="explain" />} />
      <Route path="/alerts" element={<WorkspacePage page="alerts" />} />
      <Route path="/evidence" element={<WorkspacePage page="evidence" />} />
      <Route path="/settings" element={<WorkspacePage page="settings" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

type PageKey = 'overview' | 'explore' | 'compare' | 'calendar' | 'weather' | 'reports' | 'explain' | 'alerts' | 'evidence' | 'settings'

function WorkspacePage({ page }: { page: PageKey }) {
  const state = useAppState()
  const { area, startDate, endDate, platforms, searchText, frpThresholdMw, selectedDetectionId, setArea, resetArea, setPlatforms, setFrpThreshold, setSelectedDetectionId, showArea, showDetections, setShowArea, setShowDetections } = state
  const selection = useMemo<AnalysisSelection>(() => ({ area, startDate, endDate, platforms, searchText, frpThresholdMw }), [area, startDate, endDate, platforms, searchText, frpThresholdMw])
  const recordsQuery = useQuery({ queryKey: ['detections', selection], queryFn: () => demoRepository.loadDetections(selection) })
  const summaryQuery = useQuery({ queryKey: ['summary', selection], queryFn: () => demoRepository.loadDashboardSummary(selection) })
  const comparisonQuery = useQuery({ queryKey: ['comparison', selection], queryFn: () => demoRepository.loadSensorComparison(selection) })
  const temporalQuery = useQuery({ queryKey: ['temporal', selection], queryFn: () => demoRepository.loadTemporalSummary(selection) })
  const evidenceQuery = useQuery({ queryKey: ['evidence'], queryFn: () => demoRepository.loadEvidence(selection) })
  const records = recordsQuery.data ?? []
  const summary = summaryQuery.data
  const comparison = comparisonQuery.data
  const temporal = temporalQuery.data ?? []
  const evidence = evidenceQuery.data ?? []
  const selectedRecord = records.find((record) => record.id === selectedDetectionId) ?? null
  const [clearDrawingToken, setClearDrawingToken] = useState(0)
  const [notice, setNotice] = useState('')

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 5000)
  }
  const handleAreaDrawn = (geometry: GeoJSON.Polygon, basemap: BasemapMode) => {
    const schematic = basemap === 'schematic'
    setArea({ id: `drawn-${Date.now()}`, name: schematic ? 'Custom demo area (schematic, unverified)' : 'Custom demo area', geometry, provenance: 'user-drawn' })
    showNotice(schematic ? 'Area applied. The schematic view is not a real basemap, so these coordinates are not verified against real-world geography.' : 'Custom area applied to the synthetic demo records.')
  }
  const handleAreaRejected = (reason: string) => showNotice(`Area rejected: ${reason}`)
  const clearArea = () => { resetArea(); setClearDrawingToken((token) => token + 1) }
  const handleDownload = () => downloadCsv(records)
  const setDay = (period: string) => {
    state.setStartDate(period)
    state.setEndDate(period)
  }

  if (page === 'explore') return <ExplorePage {...{ records, selectedRecord, selection, clearDrawingToken, handleAreaDrawn, handleAreaRejected, showArea, showDetections, setShowArea, setShowDetections, setSelectedDetectionId, handleDownload, clearArea, notice }} />

  return (
    <div className="page-content">
      {notice && <div className="toast-message" role="status"><Check size={15} />{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
      {page === 'overview' && <OverviewPage {...{ summary, comparison, temporal, records, evidence, selection, selectedRecord, clearDrawingToken, handleAreaDrawn, handleAreaRejected, showArea, showDetections, setShowArea, setShowDetections, setSelectedDetectionId, handleDownload, clearArea }} />}
      {page === 'compare' && <ComparePage {...{ comparison, summary, temporal, records }} />}
      {page === 'calendar' && <CalendarPage temporal={temporal} setDay={setDay} />}
      {page === 'weather' && <WeatherPage />}
      {page === 'reports' && <ReportsPage evidence={evidence} />}
      {page === 'explain' && <ExplainPage summary={summary} />}
      {page === 'alerts' && <AlertsPage />}
      {page === 'evidence' && <EvidencePage />}
      {page === 'settings' && <SettingsPage {...{ platforms, setPlatforms, frpThresholdMw, setFrpThreshold, showArea, showDetections, setShowArea, setShowDetections, areaName: area.name }} />}
    </div>
  )
}

interface MapProps {
  records: Detection[]
  selectedRecord: Detection | null
  clearDrawingToken: number
  handleAreaDrawn: (geometry: GeoJSON.Polygon, basemap: BasemapMode) => void
  handleAreaRejected: (reason: string) => void
  showArea: boolean
  showDetections: boolean
  setShowArea: (value: boolean) => void
  setShowDetections: (value: boolean) => void
  setSelectedDetectionId: (id: string | null) => void
  handleDownload: () => void
  clearArea: () => void
}

function OverviewPage(props: MapProps & { summary?: ActivitySummary; comparison?: SensorComparison; temporal: TemporalSummary[]; evidence: ReportEvidence[]; selection: AnalysisSelection }) {
  const { summary, comparison, temporal, records, evidence, selection, selectedRecord, clearDrawingToken, handleAreaDrawn, handleAreaRejected, showArea, showDetections, setShowArea, setShowDetections, setSelectedDetectionId, handleDownload, clearArea } = props
  return (
    <>
      <PageHeading eyebrow="MONITORING OVERVIEW" title="Fire activity, at a glance" description={`A synthetic demonstration for ${selection.area.name} · ${formatDate(selection.startDate)} — ${formatDate(selection.endDate)}`} action={<button className="button button-secondary" onClick={handleDownload}><Download size={15} />Export CSV</button>} />
      <KpiGrid summary={summary} comparison={comparison} />
      <div className="dashboard-grid">
        <section className="panel map-panel">
          <div className="panel-heading"><div><h2>Detection footprint</h2><p>{records.length} synthetic records in current selection</p></div><Link className="text-link" to="/explore">Explore map <ArrowRight size={13} /></Link></div>
          <MapView records={records} selectedId={selectedRecord?.id ?? null} onSelect={setSelectedDetectionId} area={selection.area} showDetections={showDetections} showArea={showArea} clearDrawingToken={clearDrawingToken} onAreaDrawn={handleAreaDrawn} onAreaRejected={handleAreaRejected} onClearArea={clearArea} />
          <MapToggles {...{ showDetections, showArea, setShowDetections, setShowArea, clearArea }} />
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>Daily activity</h2><p>Raw detection counts · synthetic</p></div><span className="chart-period">JUL 2024</span></div>
          {temporal.length ? <ActivityChart data={temporal} /> : <EmptyState title="No synthetic records in range" text="Adjust the date or area filters to explore the demo fixture." />}
          <div className="chart-footnote"><span><i className="legend-dot legend-viirs" />Selected demo records</span><span>Observation coverage: unknown</span></div>
        </section>
        <section className="panel sensor-panel">
          <div className="panel-heading"><div><h2>Sensor summary</h2><p>Native source counts · not harmonized</p></div><Link className="text-link" to="/compare">Compare <ArrowRight size={13} /></Link></div>
          <div className="sensor-cards">
            {comparison?.sourceCounts.length ? comparison.sourceCounts.map((source) => {
              const frp = records.filter((record) => record.sensor === source.sensor && record.platform === source.platform && record.frpMw !== null).map((record) => record.frpMw as number)
              return <article className={`sensor-card sensor-card-${source.sensor.toLowerCase()}`} key={`${source.sensor}-${source.platform}`}><h3>{source.sensor} <small>{source.platform}</small></h3><dl><div><dt>Detections (synthetic)</dt><dd>{source.detections}</dd></div><div><dt>Mean FRP (demo)</dt><dd>{frp.length ? `${(frp.reduce((a, b) => a + b, 0) / frp.length).toFixed(1)} MW` : 'Unavailable'}</dd></div></dl></article>
            }) : <EmptyState title="No source records" text="No synthetic records match the current filters." />}
          </div>
          <div className="chart-footnote sensor-footnote"><span>Counts are not comparable across sensors.</span>{selectedWithoutRecords(selection.platforms).length > 0 && <span>{selectedWithoutRecords(selection.platforms).join(', ')}: {NO_RECORDS_LABEL.toLowerCase()}</span>}</div>
        </section>
      </div>
      <div className="bottom-grid">
        <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent detections</h2><p>Illustrative records · not official observations</p></div><Link className="text-link" to="/explore">View all <ArrowRight size={13} /></Link></div><DetectionTable records={records.slice(0, 5)} onSelect={setSelectedDetectionId} selectedId={selectedRecord?.id ?? null} /></section>
        <section className="panel evidence-preview"><div className="panel-heading"><div><h2>Analysis notes <span className="status-pill status-muted">DEMO</span></h2><p>Static fixture notes · no live AI service</p></div><Link className="text-link" to="/reports">All notes <ArrowRight size={13} /></Link></div>{evidence.slice(0, 3).map((item) => <EvidenceRow key={item.id} evidence={item} />)}<div className="evidence-disclaimer"><Info size={13} />No independent verification is represented in these synthetic fixtures.</div></section>
      </div>
    </>
  )
}

function ExplorePage(props: MapProps & { selection: AnalysisSelection; notice: string }) {
  const { records, selectedRecord, selection, clearDrawingToken, handleAreaDrawn, handleAreaRejected, showArea, showDetections, setShowArea, setShowDetections, setSelectedDetectionId, handleDownload, clearArea, notice } = props
  return (
    <div className="explore-page">
      <PageHeading eyebrow="SPATIAL EXPLORATION" title="Explore the fire footprint" description={`${selection.area.name} · Draw a local demo polygon to filter synthetic detections.`} action={<button className="button button-secondary" onClick={handleDownload}><Download size={15} />Export visible</button>} />
      {notice && <div className="toast-message inline-toast" role="status"><Check size={15} />{notice}</div>}
      <div className="explore-layout">
        <section className="panel explore-map-panel"><MapView records={records} selectedId={selectedRecord?.id ?? null} onSelect={setSelectedDetectionId} area={selection.area} showDetections={showDetections} showArea={showArea} clearDrawingToken={clearDrawingToken} onAreaDrawn={handleAreaDrawn} onAreaRejected={handleAreaRejected} onClearArea={clearArea} fullHeight /><MapToggles {...{ showDetections, showArea, setShowDetections, setShowArea, clearArea }} /></section>
        <aside className="panel explore-side"><div className="panel-heading"><div><h2>Selection</h2><p>{records.length} records · synthetic</p></div><SlidersHorizontal size={17} /></div>
          <div className="selected-area"><span className="area-icon"><Map size={16} /></span><span><strong>{selection.area.name}</strong><small>{selection.area.provenance === 'user-drawn' ? 'Custom polygon · local only' : 'Default demonstration extent'}</small></span></div>
          <div className="selection-summary"><span>Date range</span><strong>{formatDate(selection.startDate)} — {formatDate(selection.endDate)}</strong><span>Platforms</span><strong>{selection.platforms.length ? selection.platforms.join(' · ') : 'None selected'}</strong></div>
          {selectedRecord && <div className="selected-record"><div className="selected-record-head"><span className="overline">SELECTED RECORD</span><button className="icon-button" aria-label="Clear selected record" onClick={() => setSelectedDetectionId(null)}><X size={14} /></button></div><strong>{selectedRecord.id}</strong><span>{selectedRecord.sensor} · {selectedRecord.platform}</span><span>{new Date(selectedRecord.observedAtUtc).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC</span><span>{selectedRecord.frpMw === null ? 'FRP unavailable' : `${selectedRecord.frpMw.toFixed(1)} MW FRP`}</span><span>Location {selectedRecord.latitude.toFixed(4)}°, {selectedRecord.longitude.toFixed(4)}° (WGS 84)</span><small>{selectedRecord.provenance}</small></div>}
          <div className="subsection-title">Visible records</div><DetectionTable records={records.slice(0, 12)} selectedId={selectedRecord?.id ?? null} onSelect={setSelectedDetectionId} compact />
          <div className="panel-note"><Info size={13} />Coordinates and fire detections are synthetic; valid-negative and observation-support layers are not available.</div>
        </aside>
      </div>
    </div>
  )
}

function ComparePage({ comparison, summary, temporal, records }: { comparison?: SensorComparison; summary?: ActivitySummary; temporal: TemporalSummary[]; records: Detection[] }) {
  return (
    <>
      <PageHeading eyebrow="SENSOR COMPARISON" title="Compare source records" description="Inspect raw demo detections without implying equivalence or harmonized rates." />
      <div className="metric-banner"><div className="metric-banner-icon"><ShieldCheck size={19} /></div><div><strong>Comparable response is unavailable</strong><p>{comparison?.comparableResponse.reason ?? 'No validated harmonization product or common observation support is connected.'}</p></div><span className="status-pill status-muted">NOT HARMONIZED</span></div>
      <KpiGrid summary={summary} comparison={comparison} />
      <div className="dashboard-grid compare-grid">
        <section className="panel"><div className="panel-heading"><div><h2>Source record counts</h2><p>Filtered fixture records, not standardized rates</p></div></div>{comparison && <SensorBars data={comparison.sourceCounts} />}</section>
        <section className="panel"><div className="panel-heading"><div><h2>Daily records</h2><p>Counted detections · observation support unknown</p></div></div>{temporal.length ? <ActivityChart data={temporal} /> : <EmptyState title="No records" text="Change the selection to see synthetic fixture counts." />}</section>
      </div>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>Source dataset inventory</h2><p>Illustrative labels; no product-level compatibility is asserted</p></div></div><DetectionTable records={records} onSelect={() => undefined} selectedId={null} /></section>
      <Callout title="Why these counts are not directly comparable" text="The fixtures contain point detections only. Full fire masks, observation opportunity, cloud and quality support, scan timing, and a validated common-grid method are not available. Absence of a point is not a valid negative observation." />
    </>
  )
}

function CalendarPage({ temporal, setDay }: { temporal: TemporalSummary[]; setDay: (period: string) => void }) {
  return (
    <>
      <PageHeading eyebrow="TEMPORAL EXPLORATION" title="Activity calendar" description="Select a day to narrow the workspace date range. Counts are synthetic and observation support is unknown." />
      <div className="calendar-summary"><div className="calendar-summary-icon"><CalendarDays size={20} /></div><div><strong>{temporal.length} days with demo records</strong><span>July 2024 fixture slice · not a real fire calendar</span></div><span className="status-pill status-muted">COVERAGE UNKNOWN</span></div>
      <section className="panel calendar-panel"><div className="panel-heading"><div><h2>Daily detection counts</h2><p>Click a cell to filter the selected day</p></div><span className="chart-period">JUL 2024</span></div><CalendarChart data={temporal} onSelect={setDay} /><div className="calendar-legend"><span>Fewer synthetic records</span><i /><i /><i /><i /><span>More synthetic records</span></div></section>
      <section className="panel"><div className="panel-heading"><div><h2>Records by day</h2><p>Days without detections are not classified as valid negatives</p></div></div>{temporal.length ? <div className="day-list">{temporal.map((row) => <button key={row.period} className="day-row" onClick={() => setDay(row.period)}><span>{formatDate(row.period)}</span><strong>{row.detections}</strong><span>demo detections</span><span className="coverage-unknown">Support unknown</span><ArrowRight size={14} /></button>)}</div> : <EmptyState title="No daily records" text="Choose a wider date range or a different platform." />}</section>
    </>
  )
}

function WeatherPage() {
  return <><PageHeading eyebrow="ENVIRONMENTAL CONTEXT" title="Weather context" description="Meteorological context is designed for later integration; no provider is connected." /><div className="weather-hero"><div className="weather-icon"><CloudSun size={28} /></div><div><span className="overline">DATA SOURCE STATUS</span><h2>Weather data unavailable</h2><p>ASTRA MIND is operating with local synthetic fixtures. No live or archived meteorological data has been requested.</p></div><span className="status-pill status-muted">NOT CONNECTED</span></div><div className="three-column-grid"><InfoCard icon={<Gauge />} title="Fire weather index" value="—" detail="No meteorological input" /><InfoCard icon={<Activity />} title="Wind conditions" value="—" detail="No wind field available" /><InfoCard icon={<CloudSun />} title="Humidity / temperature" value="—" detail="No reanalysis series loaded" /></div><Callout title="No causal interpretation" text="Weather variables are not available, so this demo cannot attribute detection patterns to weather conditions or forecast fire behavior." /></>
}

function ReportsPage({ evidence }: { evidence: ReportEvidence[] }) {
  return <><PageHeading eyebrow="CONTEXTUAL EVIDENCE" title="Reports & event notes" description="Illustrative interface fixtures only. No external reports are live, authenticated, or independently verified." action={<span className="status-pill status-muted">SYNTHETIC ONLY</span>} /><div className="evidence-toolbar"><div><strong>{evidence.length} illustrative notes</strong><span>These records do not corroborate a real event.</span></div><button className="button button-secondary" disabled title="External evidence sources are not connected"><BookOpen size={15} />Connect sources</button></div><div className="report-list">{evidence.map((item) => <article className="panel report-card" key={item.id}><div className={`evidence-symbol evidence-${item.status}`}><BookOpen size={16} /></div><div className="report-body"><div className="report-title-line"><h2>{item.title}</h2><span className={`status-pill status-${item.status}`}>{labelForStatus(item.status)}</span></div><p>{item.publisher} · {item.publishedAt ? formatDate(item.publishedAt) : 'Date not specified'} · Reported event: {item.reportedEventDate ? formatDate(item.reportedEventDate) : 'unknown'}</p><div className="report-tags"><span>{item.locationPrecision} location precision</span><span>Evidence link unavailable</span><span>Illustrative fixture</span></div><div className="report-caveat"><Info size={13} />Synthetic item for UI demonstration. Not a real-world source.</div></div></article>)}</div><Callout title="Evidence is not validation" text="A public report may support contextual interpretation only after source, timing, location, and independent verification are assessed. No such assessment is represented here." /></>
}

function ExplainPage({ summary }: { summary?: ActivitySummary }) {
  return <><PageHeading eyebrow="INTERPRETATION" title="Analysis notes" description="Understand what this demonstration can—and cannot—say." action={<span className="status-pill status-muted">NOT SCIENTIFICALLY VALIDATED</span>} /><div className="analysis-summary"><div className="analysis-summary-icon"><Sparkles size={20} /></div><div><span className="overline">CURRENT SELECTION</span><h2>{summary?.rawDetections ?? 0} synthetic point records</h2><p>These are illustrative fixture records and do not represent NASA observations or a validated model output.</p></div></div><div className="explanation-grid"><section className="panel"><div className="panel-heading"><div><h2>What is measured here?</h2><p>Only properties stored in local demo fixtures</p></div></div><ul className="explanation-list"><li><Check size={15} /><span>Fixture coordinates and timestamps for synthetic point records.</span></li><li><Check size={15} /><span>Illustrative FRP values and native-style confidence labels where supplied.</span></li><li><X size={15} /><span>No observation denominator, valid negative, or fire-mask coverage.</span></li><li><X size={15} /><span>No common-grid sensor harmonization or predictive inference.</span></li></ul></section><section className="panel"><div className="panel-heading"><div><h2>Scientific limitations</h2><p>Required evidence not included in this demo</p></div></div><div className="limitation-list"><span><Info size={14} />Full-resolution mask arrays and quality flags</span><span><Info size={14} />Per-pixel geolocation and observation time</span><span><Info size={14} />Cloud, invalid, unprocessed and unknown states</span><span><Info size={14} />Land support and common-grid matching</span><span><Info size={14} />Versioned cross-sensor validation</span></div></section></div><Callout title="No model has been trained" text="The current interface presents synthetic point records only. It does not claim that cross-sensor harmonization, model fitting, or scientific validation has been completed." /></>
}

function AlertsPage() {
  return <><PageHeading eyebrow="MONITORING RULES" title="Watchlist" description="Manage future notification ideas. No alert rules or notification integrations are active." /><div className="empty-feature panel"><div className="empty-feature-icon"><AlertTriangle size={22} /></div><h2>No active watch rules</h2><p>Detection notifications are unavailable because this demo has no live data source and no observation-support model.</p><button className="button button-secondary" disabled><Sparkles size={15} />Create a rule <span className="coming-soon">Unavailable</span></button></div><div className="three-column-grid"><InfoCard icon={<ShieldCheck />} title="Data trigger" value="Unavailable" detail="Live source is not connected" /><InfoCard icon={<Activity />} title="Coverage gate" value="Not defined" detail="Valid observation support required" /><InfoCard icon={<AlertTriangle />} title="Delivery" value="Disabled" detail="No notification provider" /></div></>
}

function EvidencePage() {
  return <><PageHeading eyebrow="PROVENANCE & SCIENCE" title="Data & methods" description="A transparent inventory of the local demonstration and the evidence it does not contain." /><div className="provenance-grid"><section className="panel"><div className="panel-heading"><div><h2>Current data mode</h2><p>Explicitly local and synthetic</p></div><span className="status-pill status-muted">DEMO FIXTURE</span></div><dl className="provenance-list"><div><dt>Data adapter</dt><dd>In-memory local repository</dd></div><div><dt>Detection records</dt><dd>24 deterministic synthetic points</dd></div><div><dt>Satellite files</dt><dd>None loaded by this frontend</dd></div><div><dt>External APIs</dt><dd>None queried</dd></div><div><dt>Observation coverage</dt><dd>Unknown — no full-mask inputs</dd></div><div><dt>Harmonization status</dt><dd>Not implemented or validated</dd></div><div><dt>Export</dt><dd>Filtered fixture records as CSV</dd></div></dl></section><section className="panel"><div className="panel-heading"><div><h2>Scientific interpretation</h2><p>Supported claims versus open requirements</p></div></div><div className="method-status"><span className="method-mark method-ok"><Check size={13} /></span><div><strong>Raw point counts</strong><small>Derived only from synthetic fixture rows.</small></div></div><div className="method-status"><span className="method-mark method-warn"><Info size={13} /></span><div><strong>Positive / negative classification</strong><small>Full masks and quality state needed; not available.</small></div></div><div className="method-status"><span className="method-mark method-warn"><Info size={13} /></span><div><strong>Spatial / temporal matching</strong><small>Pixel-level acquisition metadata not decoded.</small></div></div><div className="method-status"><span className="method-mark method-warn"><Info size={13} /></span><div><strong>Cross-sensor response</strong><small>Common support and validation not established.</small></div></div></section></div><Callout title="Acquisition and geolocation remain a separate scientific task" text="The VNP14IMG Collection 2 full-mask geolocation companion is still unresolved in the project investigation. This frontend neither resolves that question nor changes the existing acquisition manifest or configuration." /><section className="panel next-steps"><div className="panel-heading"><div><h2>Requirements before a decoding pilot</h2><p>Evidence needed before classifying observation support</p></div></div><ol><li>Resolve the authoritative full-mask geolocation companion for VNP14IMG Collection 2 using product-specific guidance.</li><li>Obtain a compatible fire-mask granule and its full-swath geolocation and required QA metadata.</li><li>Document mask classes, fill values, scan/sample indexing, pixel times, and observation support rules.</li><li>Decode land, cloud, invalid, unprocessed, unknown, and valid non-fire states without treating absent detections as negatives.</li><li>Evaluate common valid land support and pixel-level temporal matching before any harmonization.</li></ol></section></>
}

function SettingsPage(props: { platforms: AnalysisSelection['platforms']; setPlatforms: (platforms: AnalysisSelection['platforms']) => void; frpThresholdMw: number | null; setFrpThreshold: (value: number | null) => void; showArea: boolean; showDetections: boolean; setShowArea: (value: boolean) => void; setShowDetections: (value: boolean) => void; areaName: string }) {
  const { platforms, setPlatforms, frpThresholdMw, setFrpThreshold, showArea, showDetections, setShowArea, setShowDetections, areaName } = props
  return <><PageHeading eyebrow="WORKSPACE CONTROLS" title="Preferences" description="These controls affect the local synthetic demonstration only." /><div className="settings-layout"><section className="panel settings-section"><div className="panel-heading"><div><h2>Analysis selection</h2><p>Filters are shared across workspace pages</p></div></div><span className="settings-label">SATELLITE PLATFORMS</span><SensorSelector platforms={platforms} setPlatforms={setPlatforms} /><label className="range-label"><span><strong>Minimum fire radiative power</strong><span>{frpThresholdMw === null ? 'No minimum' : `${frpThresholdMw} MW`}</span></span><input type="range" min="0" max="200" step="10" value={frpThresholdMw ?? 0} onChange={(event) => setFrpThreshold(event.target.value === '0' ? null : Number(event.target.value))} /><small>Illustrative filter only; no scientific threshold is implied.</small></label><div className="settings-row"><div><strong>Current area</strong><small>{areaName}</small></div><span className="status-pill status-muted">LOCAL ONLY</span></div></section><section className="panel settings-section"><div className="panel-heading"><div><h2>Map display</h2><p>Local visibility settings</p></div></div><ToggleRow label="Show synthetic detections" description="Render fixture point markers on the map." checked={showDetections} onChange={setShowDetections} /><ToggleRow label="Show study-area boundary" description="Render the selected demonstration polygon." checked={showArea} onChange={setShowArea} /><div className="settings-divider" /><div className="settings-row"><div><strong>Map style</strong><small>{import.meta.env.VITE_MAP_STYLE_URL ? 'Configured via VITE_MAP_STYLE_URL; falls back to a labelled schematic if it fails' : 'No VITE_MAP_STYLE_URL set: labelled schematic view, no real basemap'}</small></div><span className="status-pill status-muted">{import.meta.env.VITE_MAP_STYLE_URL ? 'CONFIGURED' : 'SCHEMATIC'}</span></div><div className="settings-row"><div><strong>Data handling</strong><small>Fixture data stays in the browser; CSV is downloaded on request.</small></div><ShieldCheck size={16} className="text-teal" /></div></section></div><Callout title="No data-source credentials are configured" text="This frontend does not connect to NASA, Earthdata, weather or report services. The only optional network request is the basemap style you configure via VITE_MAP_STYLE_URL. It does not access credentials or protected data URLs." /></>
}

function KpiGrid({ summary, comparison }: { summary?: ActivitySummary; comparison?: SensorComparison }) {
  const metrics = [
    { label: 'Synthetic detections', value: summary?.rawDetections ?? 0, unit: 'fixture points', icon: <Flame size={16} />, tone: 'orange', note: 'Not official observations' },
    { label: 'Exploratory groups', value: summary?.exploratoryClusterCount ?? 0, unit: 'demo labels', icon: <Layers2 size={16} />, tone: 'blue', note: 'Not validated events' },
    { label: 'Mean FRP', value: summary?.meanFrpMw == null ? '—' : summary.meanFrpMw.toFixed(1), unit: summary?.meanFrpMw == null ? 'unavailable' : 'MW · illustrative', icon: <Gauge size={16} />, tone: 'gold', note: 'Fixture values only' },
    { label: 'Observation coverage', value: 'Unknown', unit: 'no full masks', icon: <ShieldCheck size={16} />, tone: 'muted', note: comparison?.comparableResponse.status === 'available' ? 'Validated coverage' : 'Valid support unavailable' },
  ]
  return <div className="kpi-grid">{metrics.map((metric) => <article className="kpi-card" key={metric.label}><span className={`kpi-icon kpi-${metric.tone}`}>{metric.icon}</span><div className="kpi-label">{metric.label}</div><div className={`kpi-value ${metric.value === 'Unknown' ? 'kpi-value-text' : ''}`}>{metric.value}<small>{metric.unit}</small></div><div className="kpi-note"><span className="status-dot status-dot-muted" />{metric.note}</div></article>)}</div>
}

function MapToggles(props: { showDetections: boolean; showArea: boolean; setShowDetections: (value: boolean) => void; setShowArea: (value: boolean) => void; clearArea: () => void }) {
  const { showDetections, showArea, setShowDetections, setShowArea, clearArea } = props
  return <div className="map-footer-controls"><label><input type="checkbox" checked={showDetections} onChange={(event) => setShowDetections(event.target.checked)} /><span className="legend-dot legend-viirs" />Synthetic points</label><label><input type="checkbox" checked={showArea} onChange={(event) => setShowArea(event.target.checked)} /><span className="legend-line" />Study area</label><button className="subtle-button" onClick={clearArea}>Reset area</button></div>
}

function DetectionTable({ records, selectedId, onSelect, compact = false }: { records: Detection[]; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean }) {
  if (!records.length) return <EmptyState title="No matching demo records" text="Adjust the selection to explore available synthetic fixtures." />
  return <div className={`table-scroll ${compact ? 'table-compact' : ''}`}><table className="detection-table"><thead><tr><th>TIME (UTC)</th><th>SENSOR / PLATFORM</th><th>LOCATION</th><th>FRP</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className={record.id === selectedId ? 'row-selected' : ''} onClick={() => onSelect(record.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(record.id) }}><td><strong>{new Date(record.observedAtUtc).toISOString().slice(11, 16)}</strong><small>{record.observedAtUtc.slice(0, 10)}</small></td><td><span className={`sensor-badge sensor-${record.sensor.toLowerCase()}`}>{record.sensor}</span><small>{record.platform}</small></td><td className="loc-cell"><span>{record.latitude.toFixed(3)}°,</span> <span>{record.longitude.toFixed(3)}°</span></td><td>{record.frpMw === null ? '—' : `${record.frpMw.toFixed(1)} MW`}</td></tr>)}</tbody></table></div>
}

function EvidenceRow({ evidence }: { evidence: ReportEvidence }) {
  return <div className="evidence-row"><span className={`evidence-dot evidence-${evidence.status}`} /><div><strong>{evidence.title}</strong><span>{evidence.publisher} · {evidence.synthetic ? 'illustrative' : 'source unverified'}</span></div><span className="status-pill status-muted">{labelForStatus(evidence.status)}</span></div>
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="overline">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-heading-action">{action}</div>}</div>
}

function InfoCard({ icon, title, value, detail }: { icon: ReactNode; title: string; value: string; detail: string }) {
  return <div className="panel info-card"><span className="info-card-icon">{icon}</span><span className="info-card-title">{title}</span><strong>{value}</strong><small>{detail}</small></div>
}

function Callout({ title, text }: { title: string; text: string }) {
  return <div className="callout"><span className="callout-icon"><CircleHelp size={16} /></span><div><strong>{title}</strong><p>{text}</p></div></div>
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span><Database size={16} /></span><strong>{title}</strong><p>{text}</p></div>
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

function formatDate(value: string): string {
  if (!value) return '—'
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function labelForStatus(status: ReportEvidence['status']): string {
  return ({ candidate: 'Candidate', consistent: 'Consistent', conflicting: 'Conflict', unresolved: 'Unresolved', rejected: 'Rejected' })[status]
}

export default App
