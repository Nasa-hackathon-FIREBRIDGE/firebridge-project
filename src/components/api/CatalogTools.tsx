import { useState } from 'react'
import { useRelease, useUpdates } from '../../hooks/useDataApi'
import type { CatalogSource } from '../../services/catalog.service'
import type { ReleaseSummary, UpdatesQuery } from '../../services/data.types'
import type { ReleaseQuery } from '../../services/releases.service'
import { Facts, Filters, Pager, Records, ResourcePanel } from './ApiPrimitives'
import { SourceAvailabilityPanel } from './SourceAvailabilityPanel'
import { useCursorPage } from '../../hooks/useCursorPage'
import { uuidPattern } from './format'

export function CatalogTools({ scopeKey, releases, sources }: { scopeKey: string; releases: ReleaseSummary[]; sources: CatalogSource[] }) {
  const [releaseId, setReleaseId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [baseline, setBaseline] = useState('')
  const [updates, setUpdates] = useState<UpdatesQuery>({ scope_key: scopeKey })
  const updatesQuery = useUpdates(updates)
  const selectedRelease = releaseId || releases[0]?.id || ''
  return <div className="api-stack">
    <nav className="platform-section-nav" aria-label="Catalogue tools"><a href="#catalogue-releases">01 · Published releases</a><a href="#catalogue-updates">02 · Release changes</a><a href="#catalogue-availability">03 · Source availability</a></nav>
    <section className="panel api-section" id="catalogue-releases"><span className="platform-eyebrow">01 / RELEASE MEMBERSHIP</span><h2>Versions publiées</h2><p>Une version identifie les entrées figées d’une analyse. Sa composition est consultable par pages.</p>
      <label className="api-field">Version du catalogue<select value={selectedRelease} onChange={(e) => setReleaseId(e.target.value)}>{releases.map((release) => <option key={release.id} value={release.id}>{release.name} — {release.id}</option>)}</select></label>
      <p>Cette version fige les données d’une analyse. La prendre comme référence permet de détecter les publications suivantes sans modifier une analyse enregistrée.</p>
      <button type="button" className="button button-secondary" disabled={!selectedRelease}
        onClick={() => {
          setBaseline(selectedRelease)
          setUpdates((current) => ({ ...current, after_release_id: selectedRelease }))
          document.getElementById('catalogue-updates')?.scrollIntoView?.({ block: 'start' })
        }}>Utiliser cette version comme référence</button>
      {selectedRelease ? <ReleaseDetails key={selectedRelease} id={selectedRelease} /> : <p>Aucune version publiée.</p>}
    </section>
    <div id="catalogue-updates"><ResourcePanel title="Mises à jour disponibles" query={updatesQuery}>
      {(data) => <>
        <p role="status">{data.comparison === 'baseline_not_provided'
          ? 'Choisir une version de référence pour vérifier les mises à jour.'
          : data.has_updates ? 'Une nouvelle version est disponible par rapport à cette référence.'
            : 'Aucune nouvelle version signalée par rapport à cette référence.'}</p>
        <Facts values={{ 'Comparaison': data.comparison, 'Nouvelles versions': data.comparison === 'baseline_not_provided' ? 'Comparaison non effectuée' : data.has_updates, 'Historique complet': data.history_complete, 'Vérifié à': data.checked_at }} />
        {!data.history_complete && <p role="note">L’historique est incomplet : cette comparaison peut ne pas décrire tous les changements.</p>}
        <Records rows={data.current} /><Records rows={data.changes} empty={data.comparison === 'baseline_not_provided' ? 'Aucune comparaison effectuée.' : 'Aucun changement détaillé renvoyé pour cette comparaison.'} />
      </>}
    </ResourcePanel>
    <form className="api-form" onSubmit={(e) => {
      e.preventDefault(); const values = new FormData(e.currentTarget)
      setUpdates({ scope_key: scopeKey, ...(values.get('baseline') ? { after_release_id: String(values.get('baseline')) } : {}),
        ...(values.get('component') ? { component: String(values.get('component')) as UpdatesQuery['component'] } : {}) })
    }}>
      <label>Version de référence (facultative)<input name="baseline" pattern={uuidPattern} placeholder="UUID d’une ancienne version" value={baseline} onChange={(event) => setBaseline(event.target.value)} /></label>
      <label>Composant<select name="component"><option value="">Tous</option><option>satellite</option><option>weather</option><option>reports</option></select></label>
      <button className="button button-primary">Comparer les versions</button>
    </form></div>
    <section className="panel api-section" id="catalogue-availability"><span className="platform-eyebrow">03 / SOURCE READINESS</span><h2>Disponibilité d’une source</h2><p>La complétude d’import et la couverture d’observation sont deux informations différentes.</p>
      <label className="api-field">Source<select value={sourceId} onChange={(e) => setSourceId(e.target.value)}><option value="">Choisir une source</option>{sources.map((source) => <option key={source.source_id} value={source.source_id}>{source.platform ?? source.source_id}</option>)}</select></label>
      {sourceId && <SourceAvailabilityPanel key={sourceId} sourceId={sourceId} scopeKey={scopeKey} />}
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

