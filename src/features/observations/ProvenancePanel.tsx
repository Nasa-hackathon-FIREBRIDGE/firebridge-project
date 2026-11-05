import { useState } from 'react'
import { ArrowDown, Database, Fingerprint } from 'lucide-react'
import { SectionHeading } from '../../components/workspace/SectionHeading'
import { ApiClientError } from '../../lib/axios'
import { ApiError, Empty, Status } from '../analyses/Feedback'
import { useCatalogue, useProvenance, useSourceAvailability } from './useResults'

export function ProvenancePanel({ analysisId }: { analysisId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [sourceId, setSourceId] = useState<string>()
  const provenance = useProvenance(expanded ? analysisId : undefined)
  const catalogue = useCatalogue(expanded)
  const availability = useSourceAvailability(sourceId, catalogue.data?.scope_key)
  const assets = provenance.data?.pages.flatMap((page) => page.assets) ?? []
  const outsideScope =
    availability.error instanceof ApiClientError &&
    availability.error.code === 'SOURCE_OUTSIDE_SCOPE'
  return (
    <section className="fb-section" id="data-provenance" aria-labelledby="provenance-heading">
      <SectionHeading
        id="provenance-heading"
        eyebrow="03 / TRACEABLE INPUTS"
        title="Data & provenance"
        description="Inspect published sources, pinned inputs and their verification fingerprints."
        action={
          <button
            type="button"
            className="button button-secondary"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <Fingerprint size={15} />
            {expanded ? 'Close provenance' : 'Inspect provenance'}
          </button>
        }
      />
      {!expanded ? (
        <div className="fb-provenance-preview">
          <Database size={22} />
          <p>
            Every analysis retains its published release and source inputs.
            <br />
            <strong>Open the evidence before drawing scientific conclusions.</strong>
          </p>
        </div>
      ) : (
        <>
          <ApiError
            error={catalogue.error}
            retry={() => {
              void catalogue.refetch()
            }}
          />
          {catalogue.isPending && <p role="status">Loading published catalogue…</p>}
          {catalogue.data && (
            <div className="fb-catalogue">
              <div className="fb-catalogue-heading">
                <h3>Published catalogue</h3>
                <span className="fb-mono">Scope / {catalogue.data.scope_key}</span>
              </div>
              <div className="fb-source-grid">
                {catalogue.data.sources.map((source) => (
                  <article key={source.source_id}>
                    <span className="fb-source-instrument">
                      {source.instrument ?? source.product}
                    </span>
                    <h4>{source.platform}</h4>
                    <p>
                      {source.product} · Collection {source.collection}
                    </p>
                    <button
                      type="button"
                      className="fb-text-button"
                      onClick={() => setSourceId(source.source_id)}
                    >
                      Check ingestion availability
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}
          {availability.isFetching && <p role="status">Checking source availability…</p>}
          {outsideScope ? (
            <p className="fb-feedback" role="status">
              No ingestion feed is registered for this source and scope. Published detection records
              can still be explored.
            </p>
          ) : (
            <ApiError error={availability.error} />
          )}
          {availability.data && (
            <div className="fb-feedback" role="status">
              Source availability response received.{' '}
              {typeof availability.data.status === 'string'
                ? availability.data.status
                : 'Review the registered source feed before scheduling ingestion.'}
            </div>
          )}
          {!analysisId ? (
            <Empty>Select an analysis to inspect its pinned asset records.</Empty>
          ) : (
            <>
              <ApiError
                error={provenance.error}
                retry={() => {
                  void provenance.refetch()
                }}
              />
              {provenance.isPending && <p role="status">Loading pinned asset records…</p>}
              {assets.length > 0 && (
                <div className="fb-table-scroll">
                  <table className="fb-provenance-table">
                    <caption>Pinned input assets</caption>
                    <thead>
                      <tr>
                        <th scope="col">Product / role</th>
                        <th scope="col">Verification</th>
                        <th scope="col">SHA-256 fingerprint</th>
                        <th scope="col">Provenance / licence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((asset) => (
                        <tr key={`${asset.asset_id}-${asset.role}`}>
                          <th scope="row">
                            {asset.product}
                            <small>{asset.role.replaceAll('_', ' ')}</small>
                          </th>
                          <td>
                            <Status value={asset.validation_status} />
                          </td>
                          <td>
                            <code className="fb-hash">{asset.sha256}</code>
                          </td>
                          <td>
                            {asset.citation}
                            <small>{asset.license_info}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!provenance.isPending && !provenance.error && assets.length === 0 && (
                <Empty>No pinned asset records were returned for this analysis.</Empty>
              )}
              {provenance.hasNextPage && (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={provenance.isFetchingNextPage}
                  onClick={() => {
                    void provenance.fetchNextPage()
                  }}
                >
                  <ArrowDown size={14} />
                  Load more input assets
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
