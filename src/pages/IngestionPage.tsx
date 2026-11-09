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
import { validateIngestionPlan } from '../features/ingestion/validation'
import { IngestionJobStatus } from '../features/ingestion/IngestionJobStatus'
import type { UserInputError } from '../lib/userFeedback'

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
  return <div className="page-content api-workspace platform-ingestion"><PageHeader eyebrow="OPERATIONS / INGESTION ADMINISTRATION" title="Ingestion des données" description="Accès réservé aux opérateurs. Les actions planifient l’import ; elles ne téléchargent pas de données NASA et ne publient pas de version." />
    {!session ? <section className="panel api-section platform-admin-access"><span className="platform-access-icon"><ShieldCheck size={25} /></span><span className="platform-eyebrow">TECHNICAL ACCESS / MEMORY ONLY</span><h2>Ouvrir une session d’administration temporaire</h2>
      <p>Saisir le jeton d’ingestion fourni par l’administrateur. Il reste uniquement en mémoire pendant cette session ; aucun compte utilisateur n’est créé.</p>
      <form className="api-form" onSubmit={(e) => {
        e.preventDefault()
        const token = String(new FormData(e.currentTarget).get('token') ?? '').trim()
        if (token) { e.currentTarget.reset(); setSession({ id: crypto.randomUUID(), token, controller: new AbortController() }) }
      }}>
        <label>Jeton d’administration<input name="token" type="password" required autoComplete="off" /></label>
        <button className="button button-primary">Accéder à l’administration</button>
      </form>
      <p className="platform-access-footnote">Planning only · No automatic publication · No token stored in the browser</p>
    </section> : <><div className="platform-session-bar"><span><ShieldCheck size={15} />Temporary operator session</span><button type="button" className="button button-secondary" onClick={disconnect}>Fermer la session et effacer les résultats d’administration</button></div><AdminWorkspace key={session.id} session={session} /></>}
  </div>
}
function AdminWorkspace({ session }: { session: AdminSession }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionsQuery>({ limit: 20 })
  const [gaps, setGaps] = useState<GapsQuery>({ limit: 20 })
  const [runId, setRunId] = useState('')
  const [refreshId, setRefreshId] = useState('')
  const [backfillError, setBackfillError] = useState<UserInputError | null>(null)
  const [refreshError, setRefreshError] = useState<UserInputError | null>(null)
  const run = useFetchRun(session, runId)
  const actions = useIngestionActions(session)
  const keyForBackfill = useIntentKey()
  const keyForRefresh = useIntentKey()
  return <div className="platform-admin-workspace"><nav className="platform-admin-nav" aria-label="Ingestion sections"><span className="platform-eyebrow">OPERATIONS</span><a href="#ingestion-subscriptions">Subscriptions</a><a href="#ingestion-gaps">Import gaps</a><a href="#ingestion-run">Collection attempt</a><a href="#ingestion-backfill">Historical import</a><a href="#ingestion-refresh">Refresh subscription</a></nav><div className="api-stack">
    <section className="panel api-section" id="ingestion-subscriptions"><span className="platform-eyebrow">01 / REGISTERED FEEDS</span><h2>Souscriptions</h2>
      <Filters<SubscriptionsQuery> fields={[{ name: 'scope_key', label: 'Périmètre' }, { name: 'feed_id', label: 'Flux' }, { name: 'mode', label: 'Mode', options: ['backfill', 'incremental', 'reconciliation'] }, { name: 'state', label: 'État du flux', options: ['active', 'paused', 'retired', 'unverified'] }, { name: 'enabled', label: 'Activée', options: ['true', 'false'] }, { name: 'limit', label: 'Par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setSubscriptions} />
      <SubscriptionsPage key={JSON.stringify(subscriptions)} session={session} params={subscriptions} onSelect={(id) => {
        setRefreshId(id); setRefreshError(null); actions.refresh.reset()
        document.getElementById('ingestion-refresh')?.scrollIntoView?.({ block: 'start' })
      }} />
    </section>
    <section className="panel api-section" id="ingestion-gaps"><span className="platform-eyebrow">02 / IMPORT COMPLETENESS</span><h2>Lacunes d’import</h2>
      <p>Un nuage est une condition d’observation, pas une lacune de téléchargement.</p>
      <Filters<GapsQuery> fields={[{ name: 'scope_key', label: 'Périmètre' }, { name: 'feed_id', label: 'Flux' }, { name: 'status', label: 'État', options: ['open', 'retrying', 'resolved', 'accepted_unavailable'] }, { name: 'start', label: 'Début UTC (ISO 8601)' }, { name: 'end_exclusive', label: 'Fin exclusive UTC (ISO 8601)' }, { name: 'limit', label: 'Par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setGaps} />
      <GapsPage key={JSON.stringify(gaps)} session={session} params={gaps} />
    </section>
    <section className="panel api-section" id="ingestion-run"><span className="platform-eyebrow">03 / FETCH RUN INSPECTION</span><h2>Inspecter une tentative de collecte</h2>
      <form className="api-form" onSubmit={(e) => { e.preventDefault(); setRunId(String(new FormData(e.currentTarget).get('run')).trim()) }}>
        <label>Identifiant de tentative (fetch run)<input name="run" required pattern={uuidPattern} /></label><button className="button button-primary">Inspecter</button>
      </form><p>Cet identifiant désigne une tentative de collecte, pas une tâche de planification.</p>
      {runId && <ResourcePanel title="Tentative de collecte" query={run}>{(data) => <><Facts values={{ Identifiant: data.id, État: data.status, Enregistrements: data.record_count, 'Vide confirmé': data.successful_empty }} /><StructuredValue value={data.sanitized_request} /><h3>Fichiers</h3><Records rows={data.assets} /><h3>Problèmes de qualité</h3><Records rows={data.quality_issues} /></>}</ResourcePanel>}
    </section>
    <section className="panel api-section" id="ingestion-backfill"><span className="platform-eyebrow">04 / HISTORICAL PLAN</span><h2>Planifier un import historique</h2>
      <form className="api-form" onSubmit={(e) => {
        e.preventDefault()
        const values = new FormData(e.currentTarget)
        const input: BackfillInput = {
          feed_id: text(values, 'feed'), area_id: text(values, 'area'), scope_key: text(values, 'scope'),
          start: text(values, 'start'), end_exclusive: text(values, 'end'),
          source_ids: csv(text(values, 'sources')), products: csv(text(values, 'products')),
          collection: text(values, 'collection'), resource_budget: budget(values),
        }
        const error = validateIngestionPlan(input.start, input.end_exclusive, input.resource_budget)
        setBackfillError(error)
        if (!error) actions.backfill.mutate({ input, key: keyForBackfill(input) })
      }}>
        <label>Flux<input name="feed" required /></label><label>Zone (UUID)<input name="area" pattern={uuidPattern} required /></label>
        <label>Périmètre<input name="scope" required /></label><TimeFields required />
        <label>Sources (séparées par des virgules)<input name="sources" required /></label>
        <label>Produits (séparés par des virgules)<input name="products" required /></label>
        <label>Collection<input name="collection" required /></label><BudgetFields />
        <button className="button button-primary" disabled={actions.backfill.isPending}>Planifier l’import</button>
      </form><ApiErrorMessage operation="write" error={backfillError} /><ApiErrorMessage operation="write" error={actions.backfill.error} /><PlanResult result={actions.backfill.data} session={session} />
    </section>
    <section className="panel api-section" id="ingestion-refresh"><span className="platform-eyebrow">05 / REFRESH PLAN</span><h2>Actualiser une souscription</h2>
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
        const error = validateIngestionPlan(input.start ?? '', input.end_exclusive ?? '', input.resource_budget, true)
        setRefreshError(error)
        if (!error) actions.refresh.mutate({ id, input, key: keyForRefresh({ id, input }) })
      }}>
        <label>Souscription (UUID)<input name="subscription" pattern={uuidPattern} required value={refreshId} onChange={(event) => setRefreshId(event.target.value)} /></label>
        <label>Mode<select name="mode"><option value="poll">poll — vérifier les arrivées</option><option value="repair">repair — réparer une lacune</option><option value="reconcile">reconcile — rechercher des révisions</option></select></label>
        <label>Motif<select name="reason"><option value="manual">manual</option><option value="gap_repair">gap_repair</option><option value="provider_revision">provider_revision</option></select></label>
        <TimeFields /><BudgetFields /><button className="button button-primary" disabled={actions.refresh.isPending}>Planifier l’actualisation</button>
      </form><ApiErrorMessage operation="write" error={refreshError} /><ApiErrorMessage operation="write" error={actions.refresh.error} /><PlanResult result={actions.refresh.data} session={session} />
    </section>
  </div></div>
}
const text = (values: FormData, name: string) => String(values.get(name) ?? '').trim()
const csv = (value: string) => [...new Set(value.split(',').map((v) => v.trim()).filter(Boolean))]
const budget = (values: FormData) => ({ max_chunks: Number(values.get('chunks')), max_bytes: Number(values.get('bytes')) })
function BudgetFields() {
  return <><label>Nombre maximal de blocs<input name="chunks" type="number" min={1} max={366} defaultValue={3} required /></label>
    <label>Budget maximal en octets<input name="bytes" type="number" min={1} max={1_000_000_000_000} defaultValue={1000000} required /></label></>
}
function TimeFields({ required = false }: { required?: boolean }) {
  return <><label>Début UTC (ISO 8601)<input name="start" placeholder="2024-01-17T00:00:00Z" required={required} /></label>
    <label>Fin exclusive UTC (ISO 8601)<input name="end" placeholder="2024-01-20T00:00:00Z" required={required} /></label></>
}
function PlanResult({ result, session }: { result?: Resource<IngestionPlan>; session: AdminSession }) {
  if (!result) return null
  const data = result.data
  return <div><h3>Résultat de la dernière demande</h3><Facts values={{ Tâche: data.job_id, État: data.status, 'Blocs planifiés': data.planned_chunks, 'Estimation en octets': data.estimated_bytes, 'Demande réutilisée': data.reused }} />
    <p>Planification uniquement. L’exécution du téléchargement nécessite un adaptateur d’ingestion. Le budget est enregistré ; la consommation réelle n’est pas encore mesurée.</p>
    {data.missing_access_requirements.length > 0 && <p>Accès à configurer : {data.missing_access_requirements.join(', ')}</p>}
    {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}<Limitations data={data} />
    <IngestionJobStatus key={data.job_id} id={data.job_id} session={session} />
  </div>
}
function SubscriptionsPage({ session, params, onSelect }: { session: AdminSession; params: SubscriptionsQuery; onSelect: (id: string) => void }) {
  const page = useCursorPage()
  const query = useSubscriptions(session, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Souscriptions enregistrées" query={query}>{(data) => <><p>Choisir une souscription prépare le formulaire d’actualisation. Aucune demande n’est envoyée avant sa validation.</p><Records rows={data.subscriptions} rowActions={(row) => <button type="button" className="button button-secondary" onClick={() => onSelect(row.id)}>Préparer l’actualisation</button>} /><Pager page={page} next={data.next_cursor} /></>}</ResourcePanel>
}
function GapsPage({ session, params }: { session: AdminSession; params: GapsQuery }) {
  const page = useCursorPage()
  const query = useIngestionGaps(session, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Lacunes enregistrées" query={query}>{(data) => <><Records rows={data.gaps} /><Pager page={page} next={data.next_cursor} /></>}</ResourcePanel>
}

