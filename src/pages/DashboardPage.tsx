import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  Clock3,
  Database,
  FileDown,
  Layers2,
  MapPinned,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useWorkspaceAnalyses, useWorkspaceAreas, useWorkspaceJobs } from '../hooks/useWorkspace'
import { useCatalog } from '../hooks/useCatalog'
import type { AnalysisFilter } from '../services/workspace.service'
import { ApiError, Status } from '../features/analyses/Feedback'
import { HealthStatus } from '../features/analyses/HealthStatus'
import { JobPanel } from '../features/analyses/JobPanel'

const shortId = (id: string) => id.slice(0, 8)
function utcDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? 'Date unavailable'
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
}
function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="astra-empty">
      <span className="astra-empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
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
  const refresh = () => {
    void analyses.refetch()
    void areas.refetch()
    void jobs.refetch()
    void catalog.refetch()
  }
  const metrics = [
    {
      label: 'Analyses loaded',
      value: rows.length,
      icon: Layers2,
      note: analyses.hasNextPage ? 'More records available' : 'In the current selection',
    },
    {
      label: 'Ready or partial',
      value: available,
      icon: CheckCheck,
      note: 'Explore available components',
    },
    { label: 'Queued or running', value: active, icon: Activity, note: 'Updates while processing' },
    {
      label: 'Needs attention',
      value: failed,
      icon: Clock3,
      note: 'Failed or unsupported analyses',
    },
  ]
  return (
    <div className="astra-page astra-dashboard">
      <header className="astra-page-heading">
        <div>
          <span className="astra-eyebrow">RESEARCH / OVERVIEW</span>
          <h1>
            Your research, in focus<span>.</span>
          </h1>
          <p>Saved analyses, processing activity and the evidence behind your work.</p>
        </div>
        <Link className="button button-primary" to="/analyses">
          <Plus size={16} />
          New analysis
        </Link>
      </header>
      <div className="astra-dashboard-tools">
        <p>
          <span className="astra-live-indicator" />
          Public server records <span>·</span>{' '}
          {analyses.dataUpdatedAt
            ? `Analyses checked ${new Date(analyses.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`
            : 'Checking saved activity'}
        </p>
        <button className="button button-secondary" disabled={fetching} onClick={refresh}>
          <RefreshCw size={14} className={fetching ? 'astra-spinning' : ''} />
          Refresh
        </button>
      </div>
      <section className="astra-metrics" aria-label="Analysis statistics for loaded records">
        {metrics.map(({ label, value, icon: Icon, note }) => (
          <div className="astra-metric" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{analyses.data ? value.toLocaleString() : '—'}</strong>
            <small>
              {analyses.isPending
                ? 'Loading analyses…'
                : analyses.isError && !analyses.data
                  ? 'Currently unavailable'
                  : note}
            </small>
          </div>
        ))}
      </section>
      <p className="astra-count-note">
        Counts describe loaded analyses{status ? ` with status “${status}”` : ''}, not server-wide
        totals.
        {analyses.isError &&
          analyses.data &&
          ' Previously loaded records are shown; the latest refresh failed.'}
      </p>
      <div className="astra-dashboard-grid">
        <section
          className="astra-surface astra-analysis-list"
          aria-labelledby="recent-analyses-heading"
        >
          <div className="astra-section-title">
            <div>
              <span className="astra-eyebrow">01 / ANALYSIS REGISTER</span>
              <h2 id="recent-analyses-heading">Saved analyses</h2>
            </div>
            <label className="astra-filter">
              <span className="sr-only">Filter analyses by status</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as AnalysisFilter)
                  setVisibleAnalyses(8)
                }}
              >
                <option value="">All statuses</option>
                {['queued', 'running', 'ready', 'partial', 'failed', 'unsupported'].map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ApiError
            context="analysis"
            error={analyses.error}
            retry={() => {
              void analyses.refetch()
            }}
          />
          {analyses.isPending && (
            <div className="astra-table-loading" role="status">
              <span className="astra-loading-dot" />
              Loading saved analyses…
            </div>
          )}
          {rows.length > 0 ? (
            <>
              <div className="astra-table-scroll">
                <table className="astra-table">
                  <caption className="sr-only">
                    Saved public analyses, current loaded selection
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Analysis / area</th>
                      <th scope="col">UTC interval</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, visibleAnalyses).map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link
                            className="astra-record-link"
                            to={`/analyses?analysis=${encodeURIComponent(row.id)}`}
                          >
                            Analysis {shortId(row.id)}
                          </Link>
                          <small title={row.area_id}>
                            {areaNames.get(row.area_id) ?? `Area ${shortId(row.area_id)}`}
                          </small>
                          <small>Created {utcDate(row.created_at)} UTC</small>
                          <small className="astra-dataset-label">
                            {catalog.data?.releases.find((release) => release.id === row.release_id)
                              ?.name ?? `Dataset ${shortId(row.release_id)}`}
                          </small>
                        </td>
                        <td>
                          <span className="astra-mono">{row.start_date.slice(0, 10)}</span>
                          <small>to {row.end_date_exclusive.slice(0, 10)} · exclusive</small>
                        </td>
                        <td>
                          <Status value={row.status} />
                        </td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={`Open analysis ${row.id}`}
                            to={`/analyses?analysis=${encodeURIComponent(row.id)}`}
                          >
                            <ArrowUpRight size={18} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="astra-table-footer">
                <span>
                  {Math.min(visibleAnalyses, rows.length)} shown / {rows.length} loaded
                  {analyses.hasNextPage ? ' · More available' : ' · End of selection'}
                </span>
                {visibleAnalyses < rows.length ? (
                  <button
                    className="button button-secondary"
                    onClick={() => setVisibleAnalyses((count) => count + 8)}
                  >
                    Show more loaded analyses <ArrowDown size={14} />
                  </button>
                ) : (
                  analyses.hasNextPage && (
                    <button
                      className="button button-secondary"
                      disabled={analyses.isFetchingNextPage}
                      onClick={() => {
                        void analyses.fetchNextPage()
                      }}
                    >
                      <ArrowDown size={14} />
                      {analyses.isFetchingNextPage ? 'Loading…' : 'Load more analyses'}
                    </button>
                  )
                )}
              </div>
            </>
          ) : !analyses.isPending && !analyses.isError ? (
            <EmptyState
              icon={<Layers2 size={28} />}
              title={status ? 'No analyses with this status' : 'A clear starting point'}
              action={
                <Link to="/analyses" className="button button-primary">
                  <Plus size={15} />
                  Set up an analysis
                </Link>
              }
            >
              {status
                ? 'Choose another status to explore the saved register.'
                : 'Define a study area, choose a UTC interval and run your first analysis. Saved server results will appear here.'}
            </EmptyState>
          ) : null}
        </section>
        <aside className="astra-dashboard-aside">
          <section className="astra-surface astra-next-step">
            <span className="astra-eyebrow">FROM AREA TO EVIDENCE</span>
            <h2>Start with a place.</h2>
            <p>Draw a boundary, choose your dates and explore the native satellite records.</p>
            <ol>
              <li>
                <span>01</span>Define a study area
              </li>
              <li>
                <span>02</span>Run a native analysis
              </li>
              <li>
                <span>03</span>Review and export results
              </li>
            </ol>
            <Link className="astra-text-link" to="/analyses">
              Open analysis workspace <ArrowRight size={16} />
            </Link>
          </section>
          <section className="astra-surface astra-catalog-preview">
            <div className="astra-section-title">
              <h2>Published sources</h2>
              <Database size={17} />
            </div>
            <ApiError
              context="catalogue"
              error={catalog.error}
              retry={() => {
                void catalog.refetch()
              }}
            />
            {catalog.isPending && <p role="status">Reading the catalogue…</p>}
            {catalog.data && (
              <>
                <p>
                  <strong className="astra-inline-number">{catalog.data.sources.length}</strong>{' '}
                  source streams in this scope
                </p>
                <div className="astra-source-tags">
                  {catalog.data.sources.map((source) => (
                    <span key={source.source_id}>{source.platform ?? source.product}</span>
                  ))}
                </div>
                <p className="astra-muted">
                  {catalog.data.releases.length} published releases. Source availability does not
                  establish observation coverage.
                </p>
                <ul className="astra-release-names" aria-label="Published dataset names">
                  {catalog.data.releases.map((release) => (
                    <li key={release.id}>{release.name}</li>
                  ))}
                </ul>
                <Link to="/catalog" className="astra-text-link">
                  Inspect catalogue <ArrowUpRight size={15} />
                </Link>
              </>
            )}
          </section>
        </aside>
        <section className="astra-surface astra-jobs" aria-labelledby="processing-heading">
          <div className="astra-section-title">
            <div>
              <span className="astra-eyebrow">02 / PROCESSING & EXPORTS</span>
              <h2 id="processing-heading">Processing activity</h2>
            </div>
            <span className="astra-muted">
              {jobs.data
                ? `${jobRows.length} loaded${jobs.hasNextPage ? ' · More available' : ''}`
                : 'Server activity'}
            </span>
          </div>
          <ApiError
            context="job"
            error={jobs.error}
            retry={() => {
              void jobs.refetch()
            }}
          />
          {jobs.isPending && (
            <p className="astra-table-loading" role="status">
              Loading processing activity…
            </p>
          )}
          {!jobRows.length && !jobs.isPending && !jobs.isError && (
            <EmptyState icon={<FileDown size={24} />} title="No processing activity yet">
              Analysis, export and factual note jobs will appear here when the server records them.
            </EmptyState>
          )}
          <div className="astra-job-list">
            {jobRows.map((job) => (
              <div key={job.id} className="astra-job-row">
                <span className="astra-job-icon">
                  {job.kind === 'export' ? <FileDown size={18} /> : <Activity size={18} />}
                </span>
                <div>
                  <strong>
                    {job.kind.replaceAll('_', ' ')}{' '}
                    <span className="astra-mono">{shortId(job.id)}</span>
                  </strong>
                  <small>{utcDate(job.created_at)} UTC</small>
                </div>
                <Status value={job.status} />
                <button
                  className="button button-secondary"
                  aria-expanded={inspectedJob === job.id}
                  onClick={() => setInspectedJob((id) => (id === job.id ? undefined : job.id))}
                >
                  {inspectedJob === job.id ? 'Close details' : 'View job'}
                </button>
                {job.analysis_id && (
                  <Link
                    className="icon-button"
                    to={`/analyses?analysis=${encodeURIComponent(job.analysis_id)}`}
                    aria-label={`Open analysis for job ${job.id}`}
                  >
                    <ArrowUpRight size={18} />
                  </Link>
                )}
                {inspectedJob === job.id && (
                  <div className="astra-job-detail">
                    <JobPanel id={job.id} allowDownload={job.kind === 'export'} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {jobs.hasNextPage && (
            <div className="astra-table-footer">
              <button
                className="button button-secondary"
                disabled={jobs.isFetchingNextPage}
                onClick={() => {
                  void jobs.fetchNextPage()
                }}
              >
                Load more jobs <ArrowDown size={14} />
              </button>
            </div>
          )}
        </section>
        <section className="astra-surface astra-areas" aria-labelledby="areas-list-heading">
          <div className="astra-section-title">
            <div>
              <span className="astra-eyebrow">03 / STUDY GEOGRAPHY</span>
              <h2 id="areas-list-heading">Saved areas</h2>
            </div>
            <MapPinned size={20} />
          </div>
          <ApiError
            context="area"
            error={areas.error}
            retry={() => {
              void areas.refetch()
            }}
          />
          {areas.isPending && (
            <p className="astra-table-loading" role="status">
              Loading study areas…
            </p>
          )}
          {!areaRows.length && !areas.isError && !areas.isPending && (
            <EmptyState icon={<MapPinned size={24} />} title="No saved areas">
              Draw a boundary in the analysis workspace to begin.
            </EmptyState>
          )}
          <div className="astra-area-list">
            {areaRows.map((area) => (
              <Link key={area.id} to={`/analyses?area=${encodeURIComponent(area.id)}`}>
                <span className="astra-area-icon">
                  <MapPinned size={18} />
                </span>
                <span>
                  <strong>{area.name}</strong>
                  <small>
                    {area.version} ·{' '}
                    {area.surface_km2 == null
                      ? 'Surface not supplied'
                      : `${area.surface_km2.toLocaleString()} km²`}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
          {areas.hasNextPage && (
            <div className="astra-table-footer">
              <button
                className="button button-secondary"
                disabled={areas.isFetchingNextPage}
                onClick={() => {
                  void areas.fetchNextPage()
                }}
              >
                Load more areas
              </button>
            </div>
          )}
        </section>
      </div>
      <HealthStatus />
      <footer className="astra-page-footer">
        <span>FIREBRIDGE / EARTH OBSERVATION</span>
        <span>Native records. Traceable evidence. Clear limitations.</span>
      </footer>
    </div>
  )
}
