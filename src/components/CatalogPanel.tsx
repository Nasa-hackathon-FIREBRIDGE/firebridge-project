import { useCatalog } from '../hooks/useCatalog'
import { CatalogTools } from './api/CatalogTools'
import { FeedbackMessage } from './FeedbackMessage'

export function CatalogPanel() {
  const { data, isPending, isError, error, refetch } = useCatalog()

  if (isPending) {
    return (
      <p className="astra-table-loading" role="status">
        Loading the published catalogue…
      </p>
    )
  }

  if (isError) {
    return (
      <FeedbackMessage
        context="catalogue"
        error={error}
        retry={() => {
          void refetch()
        }}
      />
    )
  }

  return (
    <div className="api-stack">
      <section className="panel api-section">
        <div className="astra-section-title">
          <div>
            <span className="astra-eyebrow">PUBLISHED INVENTORY</span>
            <h2>Source streams</h2>
          </div>
          <span className="astra-muted">Scope / {data.scope_key}</span>
        </div>

        {data.sources.length === 0 ? (
          <p>No sources are published in this catalogue yet.</p>
        ) : (
          <div className="astra-table-scroll">
            <table className="astra-table">
              <caption className="sr-only">Published catalogue source streams</caption>
              <thead>
                <tr>
                  <th scope="col">Platform</th>
                  <th scope="col">Instrument</th>
                  <th scope="col">Product / collection</th>
                  <th scope="col">Processing stream</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.source_id}>
                    <td>
                      <strong>{source.platform ?? source.source_id}</strong>
                    </td>
                    <td>{source.instrument ?? 'Not supplied'}</td>
                    <td>
                      {source.product}
                      <small>Collection {source.collection}</small>
                    </td>
                    <td>{source.processing_stream}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CatalogTools
        key={data.scope_key}
        scopeKey={data.scope_key}
        releases={data.releases}
        sources={data.sources}
      />
    </div>
  )
}
