import { CatalogPanel } from '../components/CatalogPanel'
import { PageHeader } from '../components/workspace/PageHeader'
export default function CatalogPage() {
  return (
    <div className="astra-page api-workspace platform-catalogue">
      <PageHeader eyebrow="RESEARCH / DATA LIBRARY" title="Data catalogue" description="Discover source streams, trace published releases and check availability before starting an analysis." />
      <CatalogPanel />
    </div>
  )
}
