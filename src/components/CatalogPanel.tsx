import { useCatalog } from '../hooks/useCatalog'
import { CatalogTools } from './api/CatalogTools'

export function CatalogPanel() {
  const { data, isPending, isError, error } = useCatalog()

  if (isPending) {
    return <p role="status">Chargement du catalogue…</p>
  }

  if (isError) {
    return (
      <p role="alert">
        Impossible de charger le catalogue : {error.message}
      </p>
    )
  }

  return (
    <div className="api-stack"><section className="panel">
      <h2>Sources du catalogue</h2>
      <p>Périmètre : {data.scope_key}</p>

      {data.sources.length === 0 ? (
        <p>Aucune source dans ce catalogue.</p>
      ) : (
        <ul>
          {data.sources.map((source) => (
            <li key={source.source_id}>
              <strong>{source.platform ?? source.source_id}</strong>
              {' — '}
              {source.instrument ?? 'Capteur non renseigné'}
              {' — '}
              {source.product}, collection {source.collection}
            </li>
          ))}
        </ul>
      )}
    </section><CatalogTools key={data.scope_key} scopeKey={data.scope_key} releases={data.releases} sources={data.sources} /></div>
  )
}
