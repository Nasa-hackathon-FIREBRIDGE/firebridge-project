import { ArrowUpRight, FileCheck2, Fingerprint, ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CatalogPanel } from '../components/CatalogPanel'
import { PageHeader } from '../components/workspace/PageHeader'

export default function EvidencePage() {
  return <div className="astra-page api-workspace geo-evidence-page">
    <PageHeader eyebrow="EVIDENCE / PROVENANCE & METHODS" title="Data & methods" description="Trace published inputs and understand what the available observations can establish." action={<Link className="button button-secondary" to="/analyses#data-provenance">Analysis provenance<ArrowUpRight size={14} /></Link>} />
    <div className="geo-evidence-principles">
      <article><Fingerprint size={20} /><div><h2>Pinned and traceable</h2><p>Each saved analysis retains release identifiers. Inspect its input assets, validation status and SHA-256 fingerprints in the analysis workspace.</p></div></article>
      <article><FileCheck2 size={20} /><div><h2>Source status stays visible</h2><p>The catalogue reflects the connected server. Release names and source identifiers distinguish published test fixtures when the server labels them synthetic.</p></div></article>
      <article><ScanLine size={20} /><div><h2>Missing remains unknown</h2><p>Detection points are positive records. Their absence alone cannot establish valid non-fire observations, complete coverage or a unique incident count.</p></div></article>
    </div>
    <CatalogPanel />
    <section className="geo-methods" aria-labelledby="interpretation-heading"><span className="astra-eyebrow">INTERPRETATION GUIDE</span><h2 id="interpretation-heading">Read records in their scientific context</h2>
      <details open><summary>Native counts and source comparison</summary><p>Counts describe source inventories within the saved area and UTC interval. Incomplete inventories may provide a lower bound. Different products have different spatial resolution, sampling and detection methods; equal counts do not establish equal fire activity. A harmonized response requires prepared scientific inputs and validation.</p></details>
      <details><summary>Confidence, radiative power and acquisition time</summary><p>Confidence is a raw source value with its own scheme. FRP is shown in MW when supplied; null remains “Not measured.” Acquisition timestamps retain the precision returned by the source. These fields do not independently establish fire severity, burned area or incident identity.</p></details>
      <details><summary>Basemap context and observation support</summary><p>Configured background imagery provides geographic context and can have an unknown acquisition date. The labelled schematic is a coordinate grid, not satellite imagery. Coverage requires validated observation support; an empty map tile is not evidence of a fire-free period.</p></details>
      <details><summary>Demonstrations and external context</summary><p>Demonstration routes use deterministic local synthetic fixtures and remain separate from saved API results. Weather and reports are shown only when supplied by the server. Candidate or unreviewed reports are contextual claims rather than independent confirmation.</p></details>
    </section>
  </div>
}
