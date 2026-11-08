import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AreaView, JobView } from '@firebridge/contracts'
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Database, FileDown, FlaskConical, Info, Layers2, MapPinned, Plus, RefreshCw, ScrollText } from 'lucide-react'
import { useWorkspaceAnalyses, useWorkspaceAreas, useWorkspaceJobs } from '../hooks/useWorkspace'
import { useCatalog } from '../hooks/useCatalog'
import type { AnalysisFilter } from '../services/workspace.service'
import type { ReleaseSummary } from '../services/data.types'
import { isRecord } from '../lib/api.validation'
import { ApiError } from '../features/analyses/Feedback'
import { HealthStatus } from '../features/analyses/HealthStatus'
import { JobPanel } from '../features/analyses/JobPanel'
import { PageHeader } from '../components/workspace/PageHeader'
import { Banner } from '../components/ui/Banner'
import { Button } from '../components/ui/Button'
import { BentoCard, Card } from '../components/ui/Card'
import { CopyableId } from '../components/ui/CopyableId'
import { EmptyState } from '../components/ui/EmptyState'
import { Select } from '../components/ui/Field'
import { Skeleton } from '../components/ui/Skeleton'
import { StatCard } from '../components/ui/StatCard'
import { StatusPill } from '../components/ui/StatusPill'
import { Tooltip } from '../components/ui/Tooltip'
import { formatAnalysisInterval, isExplicitSyntheticRelease, relativeJobTime, utcDate } from './dashboard.presentation'
import './dashboard.css'

const shortId = (id: string) => id.slice(0, 8)
const statuses = ['ready', 'partial', 'queued', 'running', 'failed', 'unsupported'] as const

function ReleaseTag({ release, releaseId, onInspect }: { release?: ReleaseSummary; releaseId: string; onInspect: () => void }) {
  const synthetic = !!release && isExplicitSyntheticRelease(release.name)
  const Icon = synthetic ? FlaskConical : Info
  return <Tooltip content={release?.name ?? `Release metadata unavailable · ${releaseId}`}><Button variant="ghost" size="small" className={`dash-release-tag ${synthetic ? 'dash-release-tag--synthetic' : ''}`} onClick={onInspect}><Icon size={14} aria-hidden="true" />{synthetic ? 'Synthetic' : release ? 'Published release' : 'Metadata unavailable'}</Button></Tooltip>
}
function AreaShape({ geometry }: { geometry?: AreaView['geometry'] }) {
  const rings = geometry?.type === 'Polygon' ? geometry.coordinates : []
  const points = rings.flat()
  if (!points.length || points.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return <MapPinned size={24} aria-hidden="true" />
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const minX = Math.min(...xs), maxY = Math.max(...ys)
  const width = Math.max(...xs) - minX, height = maxY - Math.min(...ys)
  const scale = 64 / Math.max(width, height || 1)
  const xOffset = 8 + (64 - width * scale) / 2, yOffset = 8 + (64 - height * scale) / 2
  const path = rings.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${xOffset + (point[0] - minX) * scale},${yOffset + (maxY - point[1]) * scale}`).join(' ') + 'Z').join(' ')
  return <svg viewBox="0 0 80 80" aria-label="Loaded area geometry preview, not a basemap" role="img"><path d={path} fillRule="evenodd" /></svg>
}
function JobCard({ job, inspected, onInspect }: { job: JobView; inspected: boolean; onInspect: () => void }) {
  const percent = isRecord(job.progress) && typeof job.progress.percent === 'number' && Number.isFinite(job.progress.percent) && job.progress.percent >= 0 && job.progress.percent <= 100 ? job.progress.percent : undefined
  const Icon = job.kind === 'export' ? FileDown : job.kind === 'explanation' ? ScrollText : Activity
  return <li className="dash-job-card">
    <div className="dash-job-title"><Icon size={18} aria-hidden="true" /><strong>{job.kind.replaceAll('_', ' ')}</strong><StatusPill value={job.status} /></div>
    <div className="dash-job-meta"><CopyableId value={job.id} label="job ID" /><Tooltip content={utcDate(job.created_at)}><time dateTime={job.created_at} tabIndex={0}>{relativeJobTime(job.created_at)}</time></Tooltip></div>
    <p className="dash-secondary">Stage: {job.current_stage || 'not supplied'} · Attempt {job.attempt} of {job.max_attempts}</p>
    <p className="dash-secondary">{percent === undefined ? 'Progress not supplied' : `Reported progress ${percent}%`}</p>
    {percent !== undefined && <progress aria-label={`Reported progress for job ${job.id}`} max={100} value={percent} />}
    <div className="dash-job-actions"><Button size="small" aria-expanded={inspected} onClick={onInspect}>{inspected ? 'Close details' : 'View job'}</Button>{job.analysis_id && <Link className="ui-button ui-button--ghost" to={`/analyses?analysis=${encodeURIComponent(job.analysis_id)}`} aria-label={`Open analysis for job ${job.id}`}><ArrowUpRight size={18} aria-hidden="true" /></Link>}</div>
    <details className="dash-detail"><summary>Recorded time</summary><p>{utcDate(job.created_at)}</p></details>
    {inspected && <div className="dash-job-detail"><JobPanel id={job.id} allowDownload={job.kind === 'export'} /></div>}
  </li>
}
function RegisterSkeleton() {
  return <div className="dash-register-skeleton" role="status"><span className="sr-only">Loading saved analyses…</span>{Array.from({ length: 8 }, (_, i) => <div className="dash-row-skeleton" key={i} aria-hidden="true"><Skeleton width="70%" height={24} /><Skeleton width="85%" height={20} /><Skeleton width="60%" height={40} /></div>)}</div>
}

export default function DashboardPage() {
  const [status, setStatus] = useState<AnalysisFilter>('')
  const [visibleAnalyses, setVisibleAnalyses] = useState(8)
  const analyses = useWorkspaceAnalyses(status)
  const areas = useWorkspaceAreas()
  const jobs = useWorkspaceJobs()
  const catalog = useCatalog()
  const rows = (analyses.data?.pages.flatMap((page) => page.items) ?? []).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )
  const areaRows = areas.data?.pages.flatMap((page) => page.items) ?? []
  const jobRows = jobs.data?.pages.flatMap((page) => page.items) ?? []
  const areaNames = new Map(areaRows.map((area) => [area.id, area.name]))
  const active = rows.filter((row) => ['queued', 'running'].includes(row.status)).length
  const available = rows.filter((row) => ['ready', 'partial'].includes(row.status)).length
  const failed = rows.filter((row) => ['failed', 'unsupported'].includes(row.status)).length
  const fetching = analyses.isFetching || jobs.isFetching || areas.isFetching || catalog.isFetching
  const [inspectedJob, setInspectedJob] = useState<string>()
  const releaseDetails = useRef<HTMLDetailsElement>(null)
  function inspectRelease() {
    if (!releaseDetails.current) return
    releaseDetails.current.open = true
    releaseDetails.current.scrollIntoView({ block: 'nearest' })
    releaseDetails.current.querySelector('summary')?.focus({ preventScroll: true })
  }
  const refresh = () => {
    void analyses.refetch()
    void areas.refetch()
    void jobs.refetch()
    void catalog.refetch()
  }
  const metrics = [
    { label: 'Analyses loaded', value: rows.length, note: analyses.hasNextPage ? 'More records available' : 'In the current selection' },
    { label: 'Ready or partial', value: available, note: 'Explore available components' },
    { label: 'Queued or running', value: active, note: 'Updates while processing' },
    { label: 'Needs attention', value: failed, note: 'Failed or unsupported analyses' },
  ]
  const releaseIds = rows.length ? [...new Set(rows.map(row => row.release_id))] : catalog.data?.releases.map(release => release.id) ?? []
  const selectedReleases = releaseIds.map(id => ({ id, release: catalog.data?.releases.find(release => release.id === id) }))
  const mixed = releaseIds.length > 1
  const synthetic = selectedReleases.some(({ release }) => release && isExplicitSyntheticRelease(release.name))
  const known = selectedReleases.length > 0 && selectedReleases.every(({ release }) => !!release)
  const bannerTitle = mixed ? 'Mixed releases in the loaded selection' : known && synthetic ? 'Test release: synthetic data, not NASA observations' : known ? 'Published release metadata' : 'Release metadata unavailable'

  return <div className="astra-page dash-dashboard">
    <BentoCard className="dash-hero"><PageHeader eyebrow="RESEARCH / OPERATIONS OVERVIEW" title="Wildfire intelligence" description="Review saved analyses, study areas and processing activity across the connected workspace." action={<><Link className="ui-button ui-button--primary" to="/analyses"><Plus size={16} aria-hidden="true" />New analysis</Link><Button disabled={fetching} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></>} /><p className="dash-scope"><Database size={14} aria-hidden="true" />Public server records · {analyses.dataUpdatedAt ? `checked ${new Date(analyses.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : 'Checking saved activity'}</p></BentoCard>
    <Banner tone={!mixed && known && synthetic ? 'synthetic' : 'info'} title={bannerTitle} className="dash-release-banner">
      <p>{mixed ? `${synthetic ? 'Includes synthetic test data, not NASA observations. ' : ''}Dataset identities differ; inspect the release metadata for each item.` : known && synthetic ? 'Server records describe a published test release. They are not NASA fire observations.' : known ? 'Server records retain their supplied release identity. Publication does not establish observation coverage or independent verification.' : 'Loaded catalogue metadata does not identify this release. Observation authenticity is unknown.'}</p>
      {mixed && !known && <p>Some release metadata is unavailable.</p>}{catalog.isError && catalog.data && <p>Previously loaded release metadata is shown; the latest catalogue refresh failed.</p>}
      <details ref={releaseDetails} id="dashboard-release-details" className="dash-detail"><summary>Release details</summary>{selectedReleases.length ? <ul>{selectedReleases.map(({ id, release }) => <li key={id}><strong>{release?.name ?? 'Release metadata unavailable'}</strong><code>{id}</code></li>)}</ul> : <p>Release metadata unavailable. Inspect the catalogue when it becomes available.</p>}<Link className="dash-inline-link" to="/catalog">Inspect catalogue <ArrowUpRight size={15} aria-hidden="true" /></Link></details>
    </Banner>
    <section className="dash-metrics" aria-label="Analysis statistics for loaded records">{metrics.map(metric => analyses.isPending && !analyses.data ? <Card key={metric.label} className="dash-stat-skeleton"><span>{metric.label}</span><Skeleton width={96} height={40} label={`Loading ${metric.label}`} /><Skeleton height={16} /></Card> : <StatCard key={metric.label} label={metric.label} value={analyses.data ? metric.value : '—'} context={analyses.isError && !analyses.data ? 'Currently unavailable' : metric.note} />)}</section>
    <p className="dash-scope-note">Counts describe loaded analyses{status ? ` with status “${status}”` : ''}, not server-wide totals.{analyses.isError && analyses.data && ' Previously loaded records are shown; the latest refresh failed.'}</p>
    <Card className="dash-status-summary" role="region" aria-label="Status of loaded analyses"><div className="dash-summary-heading"><h2>Loaded selection</h2><p>Partial analyses can contain missing components.</p></div><div className="dash-status-bar" aria-hidden="true">{analyses.isPending ? <Skeleton height={8} /> : statuses.map(value => { const count = rows.filter(row => row.status === value).length; return count ? <span key={value} data-status={value} style={{ flex: count }} /> : null })}</div><ul className="dash-status-legend">{statuses.map(value => { const count = rows.filter(row => row.status === value).length; return <li key={value}><StatusPill value={value} /><strong>{analyses.data ? count : '—'}</strong></li> })}</ul></Card>
    <div className="dash-grid">
      <BentoCard className="dash-register" role="region" aria-labelledby="recent-analyses-heading"><div className="dash-section-heading"><div><span className="dash-eyebrow">01 / ANALYSIS REGISTER</span><h2 id="recent-analyses-heading">Saved analyses</h2></div><Select label="Filter analyses by status" value={status} onChange={event => { setStatus(event.target.value as AnalysisFilter); setVisibleAnalyses(8) }}><option value="">All statuses</option>{['queued', 'running', 'ready', 'partial', 'failed', 'unsupported'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</Select></div>
        <ApiError context="analysis" error={analyses.error} retry={() => { void analyses.refetch() }} />{analyses.isPending && <RegisterSkeleton />}
        {rows.length > 0 ? <><ul className="dash-records" aria-label="Saved public analyses, current loaded selection">{rows.slice(0, visibleAnalyses).map((row, index) => {
          const interval = formatAnalysisInterval(row.start_date, row.end_date_exclusive), areaName = areaNames.get(row.area_id) ?? `Area ${shortId(row.area_id)}`
          const release = catalog.data?.releases.find(release => release.id === row.release_id)
          return <li key={row.id} className={`dash-record ${index < 6 ? 'dash-record-enter' : ''}`} style={index < 6 ? { animationDelay: `${index * 24}ms` } : undefined}>
            <Link className="dash-analysis-link" to={`/analyses?analysis=${encodeURIComponent(row.id)}`}><strong>{areaName}</strong><span className="dash-interval">{interval.label}</span><span className="dash-secondary">{interval.note}</span></Link>
            <div className="dash-record-tools"><CopyableId value={row.id} label="analysis ID" /><StatusPill value={row.status} /><ReleaseTag release={release} releaseId={row.release_id} onInspect={inspectRelease} /><Link className="ui-button ui-button--ghost dash-open-record" to={`/analyses?analysis=${encodeURIComponent(row.id)}`} aria-label={`Open analysis ${row.id}`}><ArrowUpRight size={18} aria-hidden="true" /></Link></div>
            <details className="dash-detail dash-record-detail"><summary>Record details</summary><dl><div><dt>Analysis ID</dt><dd><code>{row.id}</code></dd></div><div><dt>UTC interval</dt><dd>{interval.exact}</dd></div><div><dt>Created</dt><dd>{utcDate(row.created_at)}</dd></div><div><dt>Release ID</dt><dd><code>{row.release_id}</code><Button size="small" variant="ghost" onClick={inspectRelease}>Inspect release metadata</Button></dd></div></dl></details>
          </li>
        })}</ul><div className="dash-list-footer"><span>{Math.min(visibleAnalyses, rows.length)} shown / {rows.length} loaded{analyses.hasNextPage ? ' · More available' : ' · End of selection'}</span>{visibleAnalyses < rows.length ? <Button onClick={() => setVisibleAnalyses(count => count + 8)}>Show more loaded analyses <ArrowDown size={14} aria-hidden="true" /></Button> : analyses.hasNextPage && <Button disabled={analyses.isFetchingNextPage} onClick={() => { void analyses.fetchNextPage() }}>{analyses.isFetchingNextPage ? 'Loading…' : 'Load more analyses'}<ArrowDown size={14} aria-hidden="true" /></Button>}</div></> : !analyses.isPending && !analyses.isError ? <EmptyState icon={<Layers2 size={24} />} title={status ? 'No analyses with this status' : 'A clear starting point'} description={status ? 'Choose another status to explore the saved register.' : 'Define a study area, choose a UTC interval and run your first analysis. Saved server results will appear here.'} action={<Link to="/analyses" className="ui-button ui-button--primary"><Plus size={15} aria-hidden="true" />Set up an analysis</Link>} /> : null}
      </BentoCard>
      <aside className="dash-side" aria-label="Workspace activity and context">
        <BentoCard role="region" aria-labelledby="processing-heading"><div className="dash-section-heading"><div><span className="dash-eyebrow">02 / PROCESSING & EXPORTS</span><h2 id="processing-heading">Processing activity</h2></div></div><p className="dash-secondary">{jobs.data ? `${jobRows.length} loaded${jobs.hasNextPage ? ' · More available' : ''}` : 'Server activity'}</p><ApiError context="job" error={jobs.error} retry={() => { void jobs.refetch() }} />{jobs.isError && jobs.data && <p className="dash-secondary">Previously loaded processing activity is shown; the latest refresh failed.</p>}{jobs.isPending && <div className="dash-skeleton-stack"><Skeleton height={140} label="Loading processing activity…" /><Skeleton height={140} /></div>}{!jobRows.length && !jobs.isPending && !jobs.isError && <EmptyState icon={<FileDown size={24} />} title="No processing activity yet" description="Analysis, export and factual note jobs will appear here when the server records them." action={<Link className="dash-inline-link" to="/analyses">Open analysis workspace <ArrowRight size={15} aria-hidden="true" /></Link>} />}<ul className="dash-jobs">{jobRows.map(job => <JobCard key={job.id} job={job} inspected={inspectedJob === job.id} onInspect={() => setInspectedJob(id => id === job.id ? undefined : job.id)} />)}</ul>{jobs.hasNextPage && <div className="dash-list-footer"><Button disabled={jobs.isFetchingNextPage} onClick={() => { void jobs.fetchNextPage() }}>Load more jobs <ArrowDown size={14} aria-hidden="true" /></Button></div>}</BentoCard>
        <BentoCard role="region" aria-labelledby="areas-list-heading"><div className="dash-section-heading"><div><span className="dash-eyebrow">03 / STUDY GEOGRAPHY</span><h2 id="areas-list-heading">Saved areas</h2></div></div><ApiError context="area" error={areas.error} retry={() => { void areas.refetch() }} />{areas.isError && areas.data && <p className="dash-secondary">Previously loaded study areas are shown; the latest refresh failed.</p>}{areas.isPending && <Skeleton height={120} label="Loading study areas…" />}{!areaRows.length && !areas.isError && !areas.isPending && <EmptyState icon={<MapPinned size={24} />} title="No saved areas" description="Draw a boundary in the analysis workspace to begin." action={<Link className="dash-inline-link" to="/analyses">Define a study area <ArrowRight size={15} aria-hidden="true" /></Link>} />}<ul className="dash-areas">{areaRows.map(area => <li key={area.id}><Link to={`/analyses?area=${encodeURIComponent(area.id)}`} className="dash-area-card"><span className="dash-area-shape"><AreaShape geometry={area.geometry} /></span><span><strong>{area.name}</strong><span className="dash-secondary">{area.version} · {area.surface_km2 == null ? 'Surface not supplied' : `${area.surface_km2.toLocaleString()} km²`}</span><span className="dash-secondary">Shape preview · not a basemap</span></span><ArrowUpRight size={16} aria-hidden="true" /></Link></li>)}</ul>{areas.hasNextPage && <div className="dash-list-footer"><Button disabled={areas.isFetchingNextPage} onClick={() => { void areas.fetchNextPage() }}>Load more areas</Button></div>}</BentoCard>
        <BentoCard role="region" aria-labelledby="published-sources-heading"><div className="dash-section-heading"><h2 id="published-sources-heading">Published sources</h2><Database size={18} aria-hidden="true" /></div><ApiError context="catalogue" error={catalog.error} retry={() => { void catalog.refetch() }} />{catalog.isPending && <Skeleton height={80} label="Reading the catalogue…" />}{catalog.data && <><p className="dash-secondary">{catalog.data.sources.length} source streams in this scope</p><ul className="dash-source-chips">{catalog.data.sources.map(source => <li key={source.source_id}>{source.platform ?? source.product}</li>)}</ul><p className="dash-secondary">{catalog.data.releases.length} published releases. Source availability does not establish observation coverage.</p><Link to="/catalog" className="dash-inline-link">Inspect catalogue <ArrowUpRight size={15} aria-hidden="true" /></Link></>}</BentoCard>
        <BentoCard className="dash-next-step"><span className="dash-eyebrow">FROM AREA TO EVIDENCE</span><h2>Start with a place.</h2><p>Draw a boundary, choose your dates and explore the native satellite records.</p><ol><li>Define a study area</li><li>Run a native analysis</li><li>Review and export results</li></ol><Link className="dash-inline-link" to="/analyses">Open analysis workspace <ArrowRight size={16} aria-hidden="true" /></Link></BentoCard>
      </aside>
    </div>
    <HealthStatus /><footer className="dash-footer"><span>FIREBRIDGE / EARTH OBSERVATION</span><span>Native records. Traceable evidence. Clear limitations.</span></footer>
  </div>
}
