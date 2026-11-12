import { useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { calendarCsv, countLabel, type ChartSource } from './model'

export function CountEvidence({ sources, resolution, analysisId, start }: { sources: ChartSource[]; resolution: string; analysisId: string; start: string }) {
  const [page, setPage] = useState(0)
  const rows = sources.flatMap((s) => s.points.map((p) => ({ ...p, source: s.label, id: s.id })))
  function download() {
    const url = URL.createObjectURL(new Blob([calendarCsv(sources)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `firebridge-calendar-${analysisId}-${start}.csv`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="card viz-card">
    <header className="viz-table-heading"><div><span className="viz-overline">REPRODUCIBLE EVIDENCE</span><h2>Inspect & export</h2></div><button type="button" className="button button-secondary" disabled={!rows.length} onClick={download}><ArrowDownToLine size={15} aria-hidden="true" /> Download calendar CSV</button></header>
    <p className="viz-help">All {rows.length} selected source-period rows, including unknown states. Table and CSV use your chosen {resolution} detail. Statistical views above use only exact, full months.</p>
    <details className="viz-records"><summary>View exact counts ({rows.length} rows)</summary><div className="viz-table-wrap"><table><caption>Selected source-period counts · {resolution} · UTC · {rows.length} rows</caption><thead><tr><th scope="col">Source</th><th scope="col">Start</th><th scope="col">End, excluded</th><th scope="col">Detections</th><th scope="col">Inventory count state</th></tr></thead><tbody>{rows.slice(page * 20, page * 20 + 20).map((row) => <tr key={`${row.id}:${row.start}`}><th scope="row">{row.source}</th><td>{row.start.slice(0, 10)}</td><td>{row.endExclusive.slice(0, 10)}</td><td>{countLabel(row)}</td><td>{row.state}</td></tr>)}</tbody></table></div>
      {!rows.length && <p>No source-period records in this selection.</p>}
      <div className="viz-pagination"><button type="button" className="button button-secondary" disabled={!page} onClick={() => setPage((p) => p - 1)}>Previous rows</button><span>Page {page + 1} of {Math.max(1, Math.ceil(rows.length / 20))}</span><button type="button" className="button button-secondary" disabled={(page + 1) * 20 >= rows.length} onClick={() => setPage((p) => p + 1)}>Next rows</button></div>
    </details>
  </section>
}
