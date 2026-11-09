import { useCatalog } from '../hooks/useCatalog'
import { CatalogTools } from './api/CatalogTools'
import { SourceAvailabilityPanel } from './api/SourceAvailabilityPanel'
import { FeedbackMessage } from './FeedbackMessage'
import { useId, useState } from 'react'
import { Database, Search, X } from 'lucide-react'

export function CatalogPanel() {
  const sourceDetailsId = useId()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const { data, isPending, isError, error, refetch } = useCatalog()

  if (isPending) {
    return (
      <p className="astra-table-loading geo-skeleton" role="status">
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

  const sources = data.sources.filter((source) => [source.platform, source.instrument, source.product, source.source_id].some((value) => value?.toLowerCase().includes(search.toLowerCase())))
  const active = data.sources.find((source) => source.source_id === selected)

  return (
    <div className="api-stack">
      <div className="platform-catalogue-summary"><span><Database size={18} /><strong>{data.sources.length}</strong>source streams</span><span><strong>{data.releases.length}</strong>published releases</span><span>Catalogue scope<strong>{data.scope_key}</strong></span></div>
      <section className="panel api-section" id="catalogue-sources">
        <div className="astra-section-title">
          <div>
            <span className="astra-eyebrow">PUBLISHED INVENTORY</span>
            <h2>Source streams</h2>
          </div>
          <label className="platform-search"><Search size={14} /><input type="search" aria-label="Search catalogue sources" placeholder="Platform, product or source…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
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
                {sources.map((source) => (
                  <tr key={source.source_id}>
                    <td>
                      <button type="button" className="geo-record-link" onClick={() => setSelected(source.source_id)} aria-label={`Inspect source ${source.source_id}`} aria-expanded={selected === source.source_id} aria-controls={selected === source.source_id ? sourceDetailsId : undefined}><strong>{source.platform ?? source.source_id}</strong></button>
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
      {data.sources.length > 0 && sources.length === 0 && <p className="platform-empty-message">No published sources match this search. Clear the search to see the catalogue.</p>}
      {active && <aside id={sourceDetailsId} className="platform-source-detail" aria-label="Selected catalogue source"><header><div><span className="platform-eyebrow">SOURCE / PUBLISHED METADATA</span><h3>{active.platform ?? active.product}</h3></div><button className="icon-button" type="button" aria-label="Close source details" onClick={() => setSelected('')}><X size={17} /></button></header><dl className="api-facts"><div><dt>Source identifier</dt><dd><code>{active.source_id}</code></dd></div><div><dt>Product / collection</dt><dd>{active.product} / {active.collection}</dd></div><div><dt>Instrument</dt><dd>{active.instrument ?? 'Not supplied'}</dd></div><div><dt>Processing stream</dt><dd>{active.processing_stream}</dd></div><div><dt>Availability</dt><dd>{active.availability_status ?? 'Not supplied'}</dd></div></dl><p>Source availability and observation coverage are different. Inspect release membership and provenance before interpreting the records.</p><SourceAvailabilityPanel key={active.source_id} sourceId={active.source_id} scopeKey={data.scope_key} /></aside>}
      <CatalogTools
        key={data.scope_key}
        scopeKey={data.scope_key}
        releases={data.releases}
        sources={data.sources}
      />
    </div>
  )
}
