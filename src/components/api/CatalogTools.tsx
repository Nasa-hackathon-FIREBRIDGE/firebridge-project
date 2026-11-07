import { useState } from 'react'
import { useAvailability, useRelease, useUpdates } from '../../hooks/useDataApi'
import type { CatalogSource } from '../../services/catalog.service'
import type { ReleaseSummary, UpdatesQuery } from '../../services/data.types'
import type { ReleaseQuery } from '../../services/releases.service'
import { Facts, Filters, Limitations, Pager, Records, ResourcePanel } from './ApiPrimitives'
import { useCursorPage } from '../../hooks/useCursorPage'
import { uuidPattern } from './format'

export function CatalogTools({ scopeKey, releases, sources }: { scopeKey: string; releases: ReleaseSummary[]; sources: CatalogSource[] }) {
  const [releaseId, setReleaseId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [updates, setUpdates] = useState<UpdatesQuery>({ scope_key: scopeKey })
  const updatesQuery = useUpdates(updates)
  const selectedRelease = releaseId || releases[0]?.id || ''
  return <div className="api-stack">
    <section className="panel api-section"><h2>Versions publiées</h2><p>Une version identifie les entrées figées d’une analyse. Sa composition est consultable par pages.</p>
      <label className="api-field">Version du catalogue<select value={selectedRelease} onChange={(e) => setReleaseId(e.target.value)}>{releases.map((release) => <option key={release.id} value={release.id}>{release.name} — {release.id}</option>)}</select></label>
      {selectedRelease ? <ReleaseDetails key={selectedRelease} id={selectedRelease} /> : <p>Aucune version publiée.</p>}
    </section>
    <ResourcePanel title="Mises à jour disponibles" query={updatesQuery}>
      {(data) => <><Facts values={{ 'Comparaison': data.comparison, 'Nouvelles versions': data.comparison === 'baseline_not_provided' ? 'Choisir une version de référence pour comparer' : data.has_updates, 'Historique complet': data.history_complete, 'Vérifié à': data.checked_at }} /><Records rows={data.current} /><Records rows={data.changes} empty="Aucun changement signalé pour cette comparaison." /></>}
    </ResourcePanel>
    <form className="api-form" onSubmit={(e) => {
      e.preventDefault(); const values = new FormData(e.currentTarget)
      setUpdates({ scope_key: scopeKey, ...(values.get('baseline') ? { after_release_id: String(values.get('baseline')) } : {}),
        ...(values.get('component') ? { component: String(values.get('component')) as UpdatesQuery['component'] } : {}) })
    }}>
      <label>Version de référence (facultative)<input name="baseline" pattern={uuidPattern} placeholder="UUID d’une ancienne version" /></label>
      <label>Composant<select name="component"><option value="">Tous</option><option>satellite</option><option>weather</option><option>reports</option></select></label>
      <button className="button button-primary">Comparer les versions</button>
    </form>
    <section className="panel api-section"><h2>Disponibilité d’une source</h2><p>La complétude d’import et la couverture d’observation sont deux informations différentes.</p>
      <label className="api-field">Source<select value={sourceId} onChange={(e) => setSourceId(e.target.value)}><option value="">Choisir une source</option>{sources.map((source) => <option key={source.source_id} value={source.source_id}>{source.platform ?? source.source_id}</option>)}</select></label>
      {sourceId && <SourceAvailability key={sourceId} sourceId={sourceId} scopeKey={scopeKey} />}
    </section>
  </div>
}
function ReleaseDetails({ id }: { id: string }) {
  const [params, setParams] = useState<ReleaseQuery>({ membership: 'partitions', limit: 20 })
  return <><Filters<ReleaseQuery> fields={[{ name: 'membership', label: 'Composition', options: ['partitions', 'assets'], value: 'partitions' }, { name: 'limit', label: 'Éléments par page', type: 'number', min: 1, max: 100, value: 20 }]} onApply={setParams} />
    <ReleasePage key={JSON.stringify(params)} id={id} params={params} /></>
}
function ReleasePage({ id, params }: { id: string; params: ReleaseQuery }) {
  const page = useCursorPage()
  const query = useRelease(id, { ...params, cursor: page.cursor })
  return <ResourcePanel title="Détail de la version" query={query}>{(data) => <>
    <Facts values={{ Nom: data.name, Identifiant: data.id, Périmètre: data.scope_key, Publication: data.published_at, Validation: data.validation_status }} />
    <Records rows={data.source_composition} /><Records rows={data.membership.items} />
    <Pager page={page} next={data.membership.next_cursor} />
  </>}</ResourcePanel>
}
function SourceAvailability({ sourceId, scopeKey }: { sourceId: string; scopeKey: string }) {
  const query = useAvailability(sourceId, { scope_key: scopeKey })
  return <ResourcePanel title="État de la source" query={query}>{(data) => <>
    <Facts values={{ Source: data.source_id, Fournisseur: data.provider_status, 'Complétude d’import': data.ingestion_completeness, 'Couverture d’observation': data.observation_coverage, Périmé: data.stale, Motif: data.stale_reason }} />
    <Records rows={data.gaps} empty="Aucune lacune d’import signalée." />
    {data.gaps_truncated && <p>Liste des lacunes tronquée par l’API.</p>}<Limitations data={data} />
  </>}</ResourcePanel>
}

