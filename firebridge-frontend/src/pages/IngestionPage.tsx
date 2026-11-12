import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiKeys } from '../services/api.keys'
import { type AdminSession, useFetchRun, useIngestionActions, useIngestionGaps, useSubscriptions } from '../hooks/useIngestion'
import { useIntentKey } from '../hooks/useIntentKey'
import type { BackfillInput, GapsQuery, IngestionPlan, RefreshInput, SubscriptionsQuery } from '../services/data.types'
import type { Resource } from '../services/resource'
import { ApiErrorMessage, Facts, Filters, Limitations, Pager, Records, ResourcePanel, StructuredValue } from '../components/api/ApiPrimitives'
import { uuidPattern } from '../components/api/format'
import { useCursorPage } from '../hooks/useCursorPage'
import { PageHeader } from '../components/workspace/PageHeader'
import { ShieldCheck } from 'lucide-react'

export default function IngestionPage() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const client = useQueryClient()
  // Lifecycle cleanup only: all HTTP reads remain in React Query hooks.
  useEffect(() => () => {
    if (!session) return
    session.controller.abort()
    void client.cancelQueries({ queryKey: apiKeys.adminSession(session.id) })
    client.removeQueries({ queryKey: apiKeys.adminSession(session.id) })
  }, [session, client])
  const disconnect = () => {
    if (!session) return
    session.controller.abort()
    void client.cancelQueries({ queryKey: apiKeys.adminSession(session.id) })
    client.removeQueries({ queryKey: apiKeys.adminSession(session.id) })
    setSession(null)
  }
  return <div className="page-content api-workspace platform-ingestion"><PageHeader eyebrow="OPERATIONS / INGESTION ADMINISTRATION" title="Data ingestion" description="Operators only. Actions schedule imports; they do not download NASA data and do not publish a release." />
    {!session ? <section className="panel api-section platform-admin-access"><span className="platform-access-icon"><ShieldCheck size={25} /></span><span className="platform-eyebrow">TECHNICAL ACCESS / MEMORY ONLY</span><h2>Open a temporary administration session</h2>
      <p>Enter the ingestion token provided by the administrator. It stays in memory for this session only; no user account is created.</p>
      <form className="api-form" onSubmit={(e) => {
        e.preventDefault()
        const token = String(new FormData(e.currentTarget).get('token') ?? '').trim()
        if (token) { e.currentTarget.reset(); setSession({ id: crypto.randomUUID(), token, controller: new AbortController() }) }
      }}>
        <label>Administration token<input name="token" type="password" required autoComplete="off" /></label>
        <button className="button button-primary">Open administration</button>
      </form>
      <p className="platform-access-footnote">Planning only · No automatic publication · No token stored in the browser</p>
    </section> : <><div className="platform-session-bar"><span><ShieldCheck size={15} />Temporary operator session</span><button type="button" className="button button-secondary" onClick={disconnect}>Close the session and clear administration results</button></div><AdminWorkspace key={session.id} session={session} /></>}
  </div>
}
function AdminWorkspace({ session }: { session: AdminSession }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionsQuery>({ limit: 20 })
  const [gaps, setGaps] = useState<GapsQuery>({ limit: 20 })
  const [runId, setRunId] = useState('')
  const run = useFetchRun(session, runId)
  const actions = useIngestionActions(session)
  const keyForBackfill = useIntentKey()
  const keyForRefresh = useIntentKey()
  return <div className="platform-admin-workspace"><nav className="platform-admin-nav" aria-label="Ingestion sections"><span className="platform-eyebrow">OPERATIONS</span><a href="#ingestion-subscriptions">Subscriptions</a><a href="#ingestion-gaps">Import gaps</a><a href="#ingestion-run">Collection attempt</a><a href="#ingestion-backfill">Historical import</a><a href="#ingestion-refresh">Refresh subscription</a></nav><div className="api-stack">
    <section className="panel api-section" id="ingestion-subscriptions"><span className="platform-eyebrow">01 / REGISTERED FEEDS</span><h2>Subscriptions</h2>
      <Filters<SubscriptionsQuery> fields={[{ name: 'scope_key', label: 'Scope' }, { name: 'feed_id', label: 'Feed' }, { name: 'mode', label: 'Mode', options: ['backfill', 'incremental', 'reconciliation'] }, { name: 'state', label: 'Feed state', options: ['active', 'paused', 'retired', 'unverified'] }, { name: 'enabled', label: 'Enabled', options: ['true', 'false'] }, { name: 'limit', label: 'Per page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setSubscriptions} />
      <SubscriptionsPage key={JSON.stringify(subscriptions)} session={session} params={subscriptions} />
    </section>
    <section className="panel api-section" id="ingestion-gaps"><span className="platform-eyebrow">02 / IMPORT COMPLETENESS</span><h2>Import gaps</h2>
      <p>A cloud is an observation condition, not a download gap.</p>
      <Filters<GapsQuery> fields={[{ name: 'scope_key', label: 'Scope' }, { name: 'feed_id', label: 'Feed' }, { name: 'status', label: 'Status', options: ['open', 'retrying', 'resolved', 'accepted_unavailable'] }, { name: 'start', label: 'UTC start (ISO 8601)' }, { name: 'end_exclusive', label: 'Exclusive UTC end (ISO 8601)' }, { name: 'limit', label: 'Per page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setGaps} />
      <GapsPage key={JSON.stringify(gaps)} session={session} params={gaps} />
    </section>
    <section className="panel api-section" id="ingestion-run"><span className="platform-eyebrow">03 / FETCH RUN INSPECTION</span><h2>Inspect a collection attempt</h2>
      <form className="api-form" onSubmit={(e) => { e.preventDefault(); setRunId(String(new FormData(e.currentTarget).get('run')).trim()) }}>
        <label>Attempt ID (fetch run)<input name="run" required pattern={uuidPattern} /></label><button className="button button-primary">Inspect</button>
      </form><p>This ID identifies a collection attempt, not a scheduling job.</p>
      {runId && <ResourcePanel title="Collection attempt" query={run}>{(data) => <><Facts values={{ ID: data.id, Status: data.status, Records: data.record_count, 'Confirmed empty': data.successful_empty }} /><StructuredValue value={data.sanitized_request} /><h3>Files</h3><Records rows={data.assets} /><h3>Quality issues</h3><Records rows={data.quality_issues} /></>}</ResourcePanel>}
    </section>
    <section className="panel api-section" id="ingestion-backfill"><span className="platform-eyebrow">04 / HISTORICAL PLAN</span><h2>Schedule a historical import</h2>
      <form className="api-form" onSubmit={(e) => {
        e.preventDefault()
        const values = new FormData(e.currentTarget)
        const input: BackfillInput = {
          feed_id: text(values, 'feed'), area_id: text(values, 'area'), scope_key: text(values, 'scope'),
          start: text(values, 'start'), end_exclusive: text(values, 'end'),
          source_ids: csv(text(values, 'sources')), products: csv(text(values, 'products')),
          collection: text(values, 'collection'), resource_budget: budget(values),
        }
        actions.backfill.mutate({ input, key: keyForBackfill(input) })
      }}>
        <label>Flux<input name="feed" required /></label><label>Area (UUID)<input name="area" pattern={uuidPattern} required /></label>
        <label>Scope<input name="scope" required /></label><TimeFields required />
        <label>Sources (comma-separated)<input name="sources" required /></label>
        <label>Products (comma-separated)<input name="products" required /></label>
        <label>Collection<input name="collection" required /></label><BudgetFields />
        <button className="button button-primary" disabled={actions.backfill.isPending}>Schedule import</button>
      </form><ApiErrorMessage operation="write" error={actions.backfill.error} /><PlanResult result={actions.backfill.data} />
    </section>
    <section className="panel api-section" id="ingestion-refresh"><span className="platform-eyebrow">05 / REFRESH PLAN</span><h2>Refresh a subscription</h2>
      <form className="api-form" onSubmit={(e) => {
        e.preventDefault()
        const values = new FormData(e.currentTarget)
        const input: RefreshInput = {
          mode: text(values, 'mode') as RefreshInput['mode'],
          reason: text(values, 'reason') as RefreshInput['reason'],
          ...(text(values, 'start') ? { start: text(values, 'start') } : {}),
          ...(text(values, 'end') ? { end_exclusive: text(values, 'end') } : {}),
          resource_budget: budget(values),
        }
        const id = text(values, 'subscription')
        actions.refresh.mutate({ id, input, key: keyForRefresh({ id, input }) })
      }}>
        <label>Subscription (UUID)<input name="subscription" pattern={uuidPattern} required /></label>
        <label>Mode<select name="mode"><option value="poll">poll — check for new arrivals</option><option value="repair">repair — fill a gap</option><option value="reconcile">reconcile — look for revisions</option></select></label>
        <label>Reason<select name="reason"><option value="manual">manual</option><option value="gap_repair">gap_repair</option><option value="provider_revision">provider_revision</option></select></label>
        <TimeFields /><BudgetFields /><button className="button button-primary" disabled={actions.refresh.isPending}>Schedule refresh</button>
      </form><ApiErrorMessage operation="write" error={actions.refresh.error} /><PlanResult result={actions.refresh.data} />
    </section>
  </div></div>
}
const text = (values: FormData, name: string) => String(values.get(name) ?? '').trim()
const csv = (value: string) => [...new Set(value.split(',').map((v) => v.trim()).filter(Boolean))]
const budget = (values: FormData) => ({ max_chunks: Number(values.get('chunks')), max_bytes: Number(values.get('bytes')) })
function BudgetFields() {
  return <><label>Maximum number of chunks<input name="chunks" type="number" min={1} max={366} defaultValue={3} required /></label>
    <label>Maximum budget in bytes<input name="bytes" type="number" min={1} max={1_000_000_000_000} defaultValue={1000000} required /></label></>
}
function TimeFields({ required = false }: { required?: boolean }) {
  return <><label>UTC start (ISO 8601)<input name="start" placeholder="2024-01-17T00:00:00Z" required={required} /></label>
    <label>Exclusive UTC end (ISO 8601)<input name="end" placeholder="2024-01-20T00:00:00Z" required={required} /></label></>
}
function PlanResult({ result }: { result?: Resource<IngestionPlan> }) {
  if (!result) return null
  const data = result.data
  return <div role="status"><Facts values={{ Job: data.job_id, Status: data.status, 'Planned chunks': data.planned_chunks, 'Estimated bytes': data.estimated_bytes, 'Request reused': data.reused }} />
    <p>Scheduling only. Running the download needs an ingestion adapter. The budget is recorded; actual consumption is not measured yet.</p>
    {data.missing_access_requirements.length > 0 && <p>Access to configure: {data.missing_access_requirements.join(', ')}</p>}
    {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}<Limitations data={data} />
  </div>
}
function SubscriptionsPage({ session, params }: { session: AdminSession; params: SubscriptionsQuery }) {
  const page = useCursorPage()
  const query = useSubscriptions(session, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Registered subscriptions" query={query}>{(data) => <><Records rows={data.subscriptions} /><Pager page={page} next={data.next_cursor} /></>}</ResourcePanel>
}
function GapsPage({ session, params }: { session: AdminSession; params: GapsQuery }) {
  const page = useCursorPage()
  const query = useIngestionGaps(session, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Recorded gaps" query={query}>{(data) => <><Records rows={data.gaps} /><Pager page={page} next={data.next_cursor} /></>}</ResourcePanel>
}

