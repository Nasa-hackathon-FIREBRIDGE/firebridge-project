import { FileJson, FileSpreadsheet } from 'lucide-react'
import type { BridgeReport } from '../engine/index.ts'
import { REFERENCE_DRIFT_MINUTES } from '../engine/index.ts'
import { fmtInt, sensorLabel } from '../format'
import { bridgeCsv } from '../selectors'

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function MethodAct({ report, analysisId, releaseId }: { report: BridgeReport; analysisId: string; releaseId?: string }) {
  const excluded = Object.entries(report.meta.excludedNonVegetation).reduce((sum, [, v]) => sum + (v ?? 0), 0)
  const stem = `firebridge-bridge-${analysisId.slice(0, 8)}`
  const params: [string, string][] = [
    ['Engine', `${report.meta.engine} · ran in ${fmtInt(report.meta.elapsedMs)} ms in this browser`],
    ['Inputs', `${fmtInt(report.meta.detections)} native detections of the pinned release${releaseId ? ` ${releaseId.slice(0, 8)}…` : ''}, ${report.meta.start} to ${report.meta.endExclusive} (end excluded)`],
    ['Exclusions', `${fmtInt(excluded)} detections flagged by FIRMS as static land, volcanic or offshore sources${report.meta.invalid ? `; ${report.meta.invalid} invalid records` : ''}`],
    ['Grid', `${report.meta.cellSizeMetres / 1000} km equal-area cells, ${report.meta.grid} (EASE-Grid 2.0)`],
    ['Regime', 'Daytime (afternoon) passes, local solar day'],
    ['Pairing', 'Same local solar day, same cell or one of its 8 neighbours'],
    ['Inventory', report.meta.availabilitySource === 'calendar' ? 'Native calendar per source; months with partial or unknown inventory are excluded, never zero-filled' : 'Inferred from detections (calendar unavailable); weaker'],
    ['Replay', 'Leave-one-block-out: calendar years when ≥ 3 are paired, else months with a ±1-month buffer'],
    ['Decision', 'Lowest replay error among B0/B1; B2 adopted only when its 90% paired block-bootstrap interval of the error difference lies below zero'],
    ['Error range', 'Estimate ± k·√(estimate+1), k the 90th percentile of standardised replay errors'],
    ['Reference drift', `Aqua years more than ${REFERENCE_DRIFT_MINUTES} min from its early-record pass time are flagged`],
    ['Clusters', `Detections ≤ ${report.episodes.linkMetres / 1000} km and ≤ ${report.episodes.linkHours} h apart, chained`],
  ]
  return (
    <section className="card min-w-0 p-5 sm:p-7" aria-labelledby="bridge-method-heading">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">Method & reproducibility</p>
          <h3 id="bridge-method-heading" className="m-0 text-[17px] font-semibold text-fg">Every number above is recomputable</h3>
          <dl className="mb-0 mt-4 grid gap-x-5 gap-y-2 text-[12.5px] sm:grid-cols-[max-content_minmax(0,1fr)]">
            {params.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-medium text-fg-2">{k}</dt>
                <dd className="m-0 text-fg-3">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="ui-button" onClick={() => download(`${stem}.json`, 'application/json', JSON.stringify({ analysis_id: analysisId, release_id: releaseId ?? null, report }, null, 2))}>
              <FileJson size={14} aria-hidden="true" />
              Full report (JSON)
            </button>
            <button type="button" className="ui-button" onClick={() => download(`${stem}-monthly.csv`, 'text/csv', bridgeCsv(report))}>
              <FileSpreadsheet size={14} aria-hidden="true" />
              Monthly bridge (CSV)
            </button>
          </div>
        </div>
        <div className="min-w-0">
          <p className="m-0 mb-3 text-[13px] font-medium text-fg">What this does not establish</p>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[12.5px] leading-relaxed text-fg-3">
            <li>No cloud or fire-mask data are used yet, so the calibration is conditional on detections. Cells that neither satellite could see are not distinguished from cells without fire.</li>
            <li>Aqua is a reference convention with its own limits and orbital drift, not ground truth.</li>
            <li>Detections and clusters are not fire incidents; FRP is not burned area or fire energy.</li>
            <li>Models are fitted to this selection only. Transfer to another region or period needs its own replay{report.platforms.length ? ` (platforms tested here: ${report.platforms.map(sensorLabel).join(', ')})` : ''}.</li>
            <li>Error ranges are empirical, from this replay; they are not guaranteed 90% intervals and do not cover every source of bias.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
