import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import type { AreaView, JobView } from '@firebridge/contracts'
import { Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUpRight, CheckCircle2, Database, FileDown, FlaskConical, Info, Layers2, Loader2, MapPinned, Plus, RefreshCw, ScrollText } from 'lucide-react'
import { useWorkspaceAnalyses, useWorkspaceAreas, useWorkspaceJobs } from '../hooks/useWorkspace'
import { useCatalog } from '../hooks/useCatalog'
import type { AnalysisFilter } from '../services/workspace.service'
import type { ReleaseSummary } from '../services/data.types'
import { isRecord } from '../lib/api.validation'
import { sensorMeta } from '../lib/sensors'
import { ApiError } from '../features/analyses/Feedback'
import { HealthStatus } from '../features/analyses/HealthStatus'
import { JobPanel } from '../features/analyses/JobPanel'
import { AreaShape } from '../components/AreaShape'
import { Banner } from '../components/ui/Banner'
import { Button } from '../components/ui/Button'
import { CopyableId } from '../components/ui/CopyableId'
import { EmptyState } from '../components/ui/EmptyState'
import { Select } from '../components/ui/Field'
import { Skeleton } from '../components/ui/Skeleton'
import { StatusPill } from '../components/ui/StatusPill'
import { Tooltip } from '../components/ui/Tooltip'
import { formatAnalysisInterval, isExplicitSyntheticRelease, relativeJobTime, utcDate } from './dashboard.presentation'

const shortId = (id: string) => id.slice(0, 8)
const statuses = ['ready', 'partial', 'queued', 'running', 'failed', 'unsupported'] as const
const statusColor: Record<(typeof statuses)[number], string> = {
  ready: 'var(--color-ok)', partial: 'var(--color-info)', queued: 'var(--color-fg-3)', running: 'var(--color-ember-400)', failed: 'var(--color-bad)', unsupported: 'var(--color-ink-500)',
}
const ease = [0.16, 1, 0.3, 1] as const

function ReleaseTag({ release, releaseId, onInspect }: { release?: ReleaseSummary; releaseId: string; onInspect: () => void }) {
  const synthetic = !!release && isExplicitSyntheticRelease(release.name)
  const Icon = synthetic ? FlaskConical : Info
  return <Tooltip content={release?.name ?? `Release metadata unavailable · ${releaseId}`}><Button variant="ghost" size="small" className={`dash-release-tag ${synthetic ? 'dash-release-tag--synthetic' : ''}`} onClick={onInspect}><Icon size={14} aria-hidden="true" />{synthetic ? 'Synthetic' : release ? 'Published release' : 'Metadata unavailable'}</Button></Tooltip>
}

function JobCard({ job, inspected, onInspect }: { job: JobView; inspected: boolean; onInspect: () => void }) {
  const percent = isRecord(job.progress) && typeof job.progress.percent === 'number' && Number.isFinite(job.progress.percent) && job.progress.percent >= 0 && job.progress.percent <= 100 ? job.progress.percent : undefined
  const Icon = job.kind === 'export' ? FileDown : job.kind === 'explanation' ? ScrollText : Activity
  return <li className="dash-job-card rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-fg-2"><Icon size={15} aria-hidden="true" /></span>
      <strong className="min-w-0 flex-1 truncate text-[13.5px] font-medium capitalize text-fg">{job.kind.replaceAll('_', ' ')}</strong>
      <StatusPill value={job.status} />
    </div>
    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-3"><CopyableId value={job.id} label="job ID" /><Tooltip content={utcDate(job.created_at)}><time dateTime={job.created_at} tabIndex={0}>{relativeJobTime(job.created_at)}</time></Tooltip></div>
    <p className="mb-0 mt-1.5 text-[12px] text-fg-3">Stage: {job.current_stage || 'not supplied'} · Attempt {job.attempt} of {job.max_attempts}</p>
    <p className="mb-0 mt-0.5 text-[12px] text-fg-3">{percent === undefined ? 'Progress not supplied' : `Reported progress ${percent}%`}</p>
    {percent !== undefined && <progress className="mt-2 h-1.5 w-full accent-ember-400" aria-label={`Reported progress for job ${job.id}`} max={100} value={percent} />}
    <div className="mt-3 flex items-center gap-2"><Button size="small" aria-expanded={inspected} onClick={onInspect}>{inspected ? 'Close details' : 'View job'}</Button>{job.analysis_id && <Link className="ui-button ui-button--ghost ui-button--small" to={`/analyses?analysis=${encodeURIComponent(job.analysis_id)}`} aria-label={`Open analysis for job ${job.id}`}><ArrowUpRight size={16} aria-hidden="true" /></Link>}</div>
    <details className="dash-detail mt-2 text-[12px] text-fg-3"><summary className="cursor-pointer">Recorded time</summary><p className="mb-0 mt-1">{utcDate(job.created_at)}</p></details>
    {inspected && <div className="dash-job-detail mt-3"><JobPanel id={job.id} allowDownload={job.kind === 'export'} /></div>}
  </li>
}

function RegisterSkeleton() {
  return <div className="flex flex-col gap-3" role="status"><span className="sr-only">Loading saved analyses…</span>{Array.from({ length: 5 }, (_, i) => <div className="flex items-center gap-4 rounded-2xl border border-white/[0.05] p-4" key={i} aria-hidden="true"><Skeleton width={56} height={56} /><div className="flex flex-1 flex-col gap-2"><Skeleton width="55%" height={18} /><Skeleton width="35%" height={14} /></div></div>)}</div>
}

function Panel({ title, eyebrow, id, children, action, className = '' }: { title: string; eyebrow?: string; id: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`card min-w-0 p-5 sm:p-6 ${className}`} role="region" aria-labelledby={id}>
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>{eyebrow && <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">{eyebrow}</p>}<h2 id={id} className="m-0 text-[17px] font-semibold text-fg">{title}</h2></div>
      {action}
    </header>
    {children}
  </section>
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
  const areaById = new Map<string, AreaView>(areaRows.map((area) => [area.id, area]))
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
    { label: 'Analyses loaded', value: rows.length, note: analyses.hasNextPage ? 'More records available' : 'In the current selection', icon: Layers2, tone: 'text-ember-300 bg-ember-500/10' },
    { label: 'Ready or partial', value: available, note: 'Explore available components', icon: CheckCircle2, tone: 'text-ok bg-ok/10' },
    { label: 'Queued or running', value: active, note: 'Updates while processing', icon: Loader2, tone: 'text-info bg-info/10' },
    { label: 'Needs attention', value: failed, note: 'Failed or unsupported analyses', icon: AlertTriangle, tone: 'text-bad bg-bad/10' },
  ]
  const releaseIds = rows.length ? [...new Set(rows.map(row => row.release_id))] : catalog.data?.releases.map(release => release.id) ?? []
  const selectedReleases = releaseIds.map(id => ({ id, release: catalog.data?.releases.find(release => release.id === id) }))
  const mixed = releaseIds.length > 1
  const synthetic = selectedReleases.some(({ release }) => release && isExplicitSyntheticRelease(release.name))
  const known = selectedReleases.length > 0 && selectedReleases.every(({ release }) => !!release)
  const bannerTitle = mixed ? 'Mixed releases in the loaded selection' : known && synthetic ? 'Test release: synthetic data, not NASA observations' : known ? 'Published release metadata' : 'Release metadata unavailable'

  return <div className="astra-page dash-dashboard fbx-dashboard mx-auto flex max-w-[1600px] flex-col gap-6">
    {/* Header */}
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <p className="m-0 mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-300">Research / operations overview</p>
        <h1 className="m-0 text-[clamp(28px,3vw,38px)] font-semibold leading-tight tracking-[-0.03em] text-fg">Wildfire intelligence</h1>
        <p className="mb-0 mt-2 max-w-2xl text-[15px] text-fg-2">Review saved analyses, study areas and processing activity across the connected workspace.</p>
        <p className="dash-scope mb-0 mt-3 inline-flex items-center gap-2 text-[12.5px] text-fg-3"><Database size={13} aria-hidden="true" />Public server records · {analyses.dataUpdatedAt ? `checked ${new Date(analyses.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : 'Checking saved activity'}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={fetching} onClick={refresh}><RefreshCw size={15} className={fetching ? 'animate-spin' : undefined} aria-hidden="true" />Refresh</Button>
        <Link className="ui-button ui-button--primary" to="/analyses"><Plus size={16} aria-hidden="true" />New analysis</Link>
      </div>
    </header>

    {/* KPIs */}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Analysis statistics for loaded records">
      {metrics.map((metric, index) => analyses.isPending && !analyses.data
        ? <div key={metric.label} className="card flex flex-col gap-3 p-5"><span className="text-[13px] text-fg-3">{metric.label}</span><Skeleton width={72} height={34} label={`Loading ${metric.label}`} /><Skeleton height={14} /></div>
        : <div key={metric.label} className="card flex animate-fade-up items-start gap-4 p-5" style={{ animationDelay: `${index * 60}ms` }}>
          <dl className="m-0 min-w-0 flex-1">
            <dt className="text-[13px] text-fg-3">{metric.label}</dt>
            <dd className="m-0 mt-2 font-display text-[32px] font-semibold leading-none tracking-tight text-fg tabular-nums">{analyses.data ? <><span className="sr-only">{metric.value}</span><span aria-hidden="true">{metric.value}</span></> : '—'}</dd>
            <p className="mb-0 mt-2 text-[12.5px] text-fg-3">{analyses.isError && !analyses.data ? 'Currently unavailable' : metric.note}</p>
          </dl>
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${metric.tone}`}><metric.icon size={18} aria-hidden="true" /></span>
        </div>)}
    </section>
    <p className="dash-scope-note -mt-2 mb-0 text-[12px] text-fg-3">Counts describe loaded analyses{status ? ` with status “${status}”` : ''}, not server-wide totals.{analyses.isError && analyses.data && ' Previously loaded records are shown; the latest refresh failed.'}</p>

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        {/* Register */}
        <section className="card min-w-0 p-5 sm:p-6" role="region" aria-labelledby="recent-analyses-heading">
          <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div><p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">Analysis register</p><h2 id="recent-analyses-heading" className="m-0 text-[19px] font-semibold text-fg">Saved analyses</h2></div>
            <div className="w-full sm:w-56"><Select label="Filter analyses by status" value={status} onChange={event => { setStatus(event.target.value as AnalysisFilter); setVisibleAnalyses(8) }}><option value="">All statuses</option>{['queued', 'running', 'ready', 'partial', 'failed', 'unsupported'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</Select></div>
          </header>
          {/* Status distribution */}
          <div className="dash-status-summary mb-5 rounded-xl border border-white/[0.05] bg-white/[0.015] p-4" role="region" aria-label="Status of loaded analyses">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 className="m-0 text-[13.5px] font-medium text-fg">Loaded selection</h3><p className="m-0 text-[12px] text-fg-3">Partial analyses can contain missing components.</p></div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/[0.04]" aria-hidden="true">{analyses.isPending ? <Skeleton height={8} /> : statuses.map(value => { const count = rows.filter(row => row.status === value).length; return count ? <motion.span key={value} data-status={value} className="h-full origin-left rounded-full" style={{ flex: count, background: statusColor[value] }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease }} /> : null })}</div>
            <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">{statuses.map(value => { const count = rows.filter(row => row.status === value).length; return <li key={value} className="flex items-center gap-2 text-[12.5px]"><StatusPill value={value} /><strong className="font-semibold tabular-nums text-fg">{analyses.data ? count : '—'}</strong></li> })}</ul>
          </div>
          <ApiError context="analysis" error={analyses.error} retry={() => { void analyses.refetch() }} />{analyses.isPending && <RegisterSkeleton />}
          {rows.length > 0 ? <><ul className="dash-records m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Saved public analyses, current loaded selection">{rows.slice(0, visibleAnalyses).map((row, index) => {
            const interval = formatAnalysisInterval(row.start_date, row.end_date_exclusive)
            const area = areaById.get(row.area_id)
            const areaName = area?.name ?? `Area ${shortId(row.area_id)}`
            const release = catalog.data?.releases.find(release => release.id === row.release_id)
            return <li key={row.id} className="dash-record group animate-fade-up rounded-2xl border border-white/[0.06] bg-white/[0.015] p-3.5 transition-colors hover:border-ember-400/25 hover:bg-white/[0.03]" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              <div className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-4">
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900 text-fg-3"><AreaShape geometry={area?.geometry} size={56} decorative /></span>
                <div className="min-w-0">
                  <Link className="dash-analysis-link flex min-w-0 flex-col gap-0.5 no-underline" to={`/analyses?analysis=${encodeURIComponent(row.id)}`}>
                    <strong className="truncate text-[15px] font-semibold text-fg group-hover:text-ember-100">{areaName}</strong>
                    <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-2"><span className="dash-interval font-mono">{interval.label}</span><span className="dash-secondary text-fg-3">{interval.note}</span></span>
                  </Link>
                  <div className="dash-record-tools mt-2 flex flex-wrap items-center gap-2"><StatusPill value={row.status} /><ReleaseTag release={release} releaseId={row.release_id} onInspect={inspectRelease} /><CopyableId value={row.id} label="analysis ID" /></div>
                </div>
                <Link className="ui-button ui-button--ghost ui-button--small dash-open-record" to={`/analyses?analysis=${encodeURIComponent(row.id)}`} aria-label={`Open analysis ${row.id}`}><ArrowUpRight size={17} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></Link>
              </div>
              <details className="dash-detail dash-record-detail mt-2 text-[12.5px] text-fg-3"><summary className="cursor-pointer select-none hover:text-fg-2">Record details</summary><dl className="mt-2 grid gap-1.5 sm:grid-cols-2"><div><dt className="text-fg-3">Analysis ID</dt><dd className="m-0 text-fg-2"><code>{row.id}</code></dd></div><div><dt className="text-fg-3">UTC interval</dt><dd className="m-0 text-fg-2">{interval.exact}</dd></div><div><dt className="text-fg-3">Created</dt><dd className="m-0 text-fg-2">{utcDate(row.created_at)}</dd></div><div><dt className="text-fg-3">Release ID</dt><dd className="m-0 flex flex-wrap items-center gap-2 text-fg-2"><code>{row.release_id}</code><Button size="small" variant="ghost" onClick={inspectRelease}>Inspect release metadata</Button></dd></div></dl></details>
            </li>
          })}</ul><div className="dash-list-footer mt-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-fg-3"><span>{Math.min(visibleAnalyses, rows.length)} shown / {rows.length} loaded{analyses.hasNextPage ? ' · More available' : ' · End of selection'}</span>{visibleAnalyses < rows.length ? <Button onClick={() => setVisibleAnalyses(count => count + 8)}>Show more loaded analyses <ArrowDown size={14} aria-hidden="true" /></Button> : analyses.hasNextPage && <Button disabled={analyses.isFetchingNextPage} onClick={() => { void analyses.fetchNextPage() }}>{analyses.isFetchingNextPage ? 'Loading…' : 'Load more analyses'}<ArrowDown size={14} aria-hidden="true" /></Button>}</div></> : !analyses.isPending && !analyses.isError ? <EmptyState icon={<Layers2 size={24} />} title={status ? 'No analyses with this status' : 'A clear starting point'} description={status ? 'Choose another status to explore the saved register.' : 'Define a study area, choose a UTC interval and run your first analysis. Saved server results will appear here.'} action={<Link to="/analyses" className="ui-button ui-button--primary"><Plus size={15} aria-hidden="true" />Set up an analysis</Link>} /> : null}
        </section>

        <Banner tone={!mixed && known && synthetic ? 'synthetic' : 'info'} title={bannerTitle} className="dash-release-banner">
          <p>{mixed ? `${synthetic ? 'Includes synthetic test data, not NASA observations. ' : ''}Dataset identities differ; inspect the release metadata for each item.` : known && synthetic ? 'Server records describe a published test release. They are not NASA fire observations.' : known ? 'Server records retain their supplied release identity. Publication does not establish observation coverage or independent verification.' : 'Loaded catalogue metadata does not identify this release. Observation authenticity is unknown.'}</p>
          {mixed && !known && <p>Some release metadata is unavailable.</p>}{catalog.isError && catalog.data && <p>Previously loaded release metadata is shown; the latest catalogue refresh failed.</p>}
          <details ref={releaseDetails} id="dashboard-release-details" className="dash-detail mt-2 text-[12.5px]"><summary className="cursor-pointer text-fg-2">Release details</summary>{selectedReleases.length ? <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">{selectedReleases.map(({ id, release }) => <li key={id} className="flex flex-col"><strong className="font-medium text-fg">{release?.name ?? 'Release metadata unavailable'}</strong><code className="text-fg-3">{id}</code></li>)}</ul> : <p>Release metadata unavailable. Inspect the catalogue when it becomes available.</p>}<Link className="dash-inline-link mt-2 inline-flex items-center gap-1 text-ember-300" to="/catalog">Inspect catalogue <ArrowUpRight size={14} aria-hidden="true" /></Link></details>
        </Banner>
      </div>

      <aside className="flex min-w-0 flex-col gap-6" aria-label="Workspace activity and context">
        <Panel id="processing-heading" eyebrow="Processing & exports" title="Processing activity">
          <p className="dash-secondary -mt-2 mb-3 text-[12.5px] text-fg-3">{jobs.data ? `${jobRows.length} loaded${jobs.hasNextPage ? ' · More available' : ''}` : 'Server activity'}</p>
          <ApiError context="job" error={jobs.error} retry={() => { void jobs.refetch() }} />{jobs.isError && jobs.data && <p className="dash-secondary text-[12.5px] text-fg-3">Previously loaded processing activity is shown; the latest refresh failed.</p>}
          {jobs.isPending && <div className="flex flex-col gap-3"><Skeleton height={110} label="Loading processing activity…" /><Skeleton height={110} /></div>}
          {!jobRows.length && !jobs.isPending && !jobs.isError && <EmptyState icon={<FileDown size={22} />} title="No processing activity yet" description="Analysis, export and factual note jobs will appear here when the server records them." action={<Link className="dash-inline-link inline-flex items-center gap-1 text-ember-300" to="/analyses">Open analysis workspace <ArrowRight size={14} aria-hidden="true" /></Link>} />}
          <ul className="dash-jobs m-0 flex max-h-[520px] list-none flex-col gap-2.5 overflow-y-auto p-0">{jobRows.map(job => <JobCard key={job.id} job={job} inspected={inspectedJob === job.id} onInspect={() => setInspectedJob(id => id === job.id ? undefined : job.id)} />)}</ul>
          {jobs.hasNextPage && <div className="dash-list-footer mt-3"><Button disabled={jobs.isFetchingNextPage} onClick={() => { void jobs.fetchNextPage() }}>Load more jobs <ArrowDown size={14} aria-hidden="true" /></Button></div>}
        </Panel>
        <Panel id="areas-list-heading" eyebrow="Study geography" title="Saved areas">
          <ApiError context="area" error={areas.error} retry={() => { void areas.refetch() }} />{areas.isError && areas.data && <p className="dash-secondary text-[12.5px] text-fg-3">Previously loaded study areas are shown; the latest refresh failed.</p>}
          {areas.isPending && <Skeleton height={120} label="Loading study areas…" />}
          {!areaRows.length && !areas.isError && !areas.isPending && <EmptyState icon={<MapPinned size={22} />} title="No saved areas" description="Draw a boundary in the analysis workspace to begin." action={<Link className="dash-inline-link inline-flex items-center gap-1 text-ember-300" to="/analyses">Define a study area <ArrowRight size={14} aria-hidden="true" /></Link>} />}
          <ul className="dash-areas m-0 flex list-none flex-col gap-2 p-0">{areaRows.map(area => <li key={area.id}><Link to={`/analyses?area=${encodeURIComponent(area.id)}`} className="dash-area-card group flex items-center gap-3 rounded-xl border border-white/[0.06] p-2.5 no-underline transition-colors hover:border-ember-400/25 hover:bg-white/[0.02]"><span className="dash-area-shape grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-900 text-fg-3"><AreaShape geometry={area.geometry} size={56} /></span><span className="flex min-w-0 flex-1 flex-col gap-0.5"><strong className="truncate text-[13.5px] font-medium text-fg">{area.name}</strong><span className="dash-secondary text-[12px] text-fg-3">{area.version} · {area.surface_km2 == null ? 'Surface not supplied' : `${area.surface_km2.toLocaleString()} km²`}</span><span className="dash-secondary text-[11px] text-fg-3/80">Shape preview · not a basemap</span></span><ArrowUpRight size={16} className="shrink-0 text-fg-3 transition-colors group-hover:text-ember-300" aria-hidden="true" /></Link></li>)}</ul>
          {areas.hasNextPage && <div className="dash-list-footer mt-3"><Button disabled={areas.isFetchingNextPage} onClick={() => { void areas.fetchNextPage() }}>Load more areas</Button></div>}
        </Panel>
        <Panel id="published-sources-heading" title="Published sources" action={<Database size={17} className="text-fg-3" aria-hidden="true" />}>
          <ApiError context="catalogue" error={catalog.error} retry={() => { void catalog.refetch() }} />{catalog.isPending && <Skeleton height={80} label="Reading the catalogue…" />}
          {catalog.data && <><p className="dash-secondary -mt-2 mb-3 text-[12.5px] text-fg-3">{catalog.data.sources.length} source streams in this scope</p><ul className="dash-source-chips m-0 flex list-none flex-wrap gap-1.5 p-0">{catalog.data.sources.map(source => { const sensor = sensorMeta(source.platform, source.product, source.source_id); return <li key={source.source_id} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-[12px] text-fg-2"><span className="size-1.5 rounded-full" style={{ background: sensor.color }} aria-hidden="true" />{source.platform ?? source.product}</li> })}</ul><p className="dash-secondary mb-3 mt-3 text-[12.5px] text-fg-3">{catalog.data.releases.length} published releases. Source availability does not establish observation coverage.</p><Link to="/catalog" className="dash-inline-link inline-flex items-center gap-1 text-[13px] font-medium text-ember-300">Inspect catalogue <ArrowUpRight size={14} aria-hidden="true" /></Link></>}
        </Panel>
        <section className="dash-next-step relative overflow-hidden rounded-2xl border border-ember-400/20 p-6">
          <div className="absolute inset-0 -z-0 bg-[radial-gradient(90%_90%_at_100%_0%,rgba(255,95,31,0.18),transparent_65%)]" aria-hidden="true" />
          <div className="relative">
            <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ember-300">From area to evidence</p>
            <h2 className="m-0 text-[19px] font-semibold text-fg">Start with a place.</h2>
            <p className="mb-0 mt-2 text-[13.5px] text-fg-2">Draw a boundary, choose your dates and explore the native satellite records.</p>
            <ol className="m-0 mt-4 flex list-none flex-col gap-2 p-0 text-[13px] text-fg-2">{['Define a study area', 'Run a native analysis', 'Review and export results'].map((step, index) => <li key={step} className="flex items-center gap-2.5"><span className="grid size-6 place-items-center rounded-md bg-white/[0.06] font-mono text-[11px] text-fg">{index + 1}</span>{step}</li>)}</ol>
            <Link className="ui-button ui-button--primary mt-5" to="/analyses">Open analysis workspace <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        </section>
      </aside>
    </div>
    <HealthStatus />
    <footer className="dash-footer flex flex-wrap justify-between gap-2 border-t border-white/[0.06] pt-5 text-[12px] text-fg-3"><span>FIREBRIDGE / EARTH OBSERVATION</span><span>Native records. Traceable evidence. Clear limitations.</span></footer>
  </div>
}
