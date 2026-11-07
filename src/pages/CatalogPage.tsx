import { CatalogPanel } from '../components/CatalogPanel'
export default function CatalogPage() {
  return (
    <div className="astra-page api-workspace">
      <header className="astra-page-heading">
        <div>
          <span className="astra-eyebrow">RESEARCH / DATA LIBRARY</span>
          <h1>
            Data catalogue<span>.</span>
          </h1>
          <p>
            Inspect published releases, source streams and their availability before starting an
            analysis.
          </p>
        </div>
      </header>
      <CatalogPanel />
    </div>
  )
}
