import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarRange, GitCompareArrows } from 'lucide-react'

export function ChallengePath({ analysisId, start, endExclusive }: { analysisId: string; start: string; endExclusive: string }) {
  const study = `/analyses?analysis=${encodeURIComponent(analysisId)}`
  const firstYear = start.slice(0, 4)
  const lastYear = new Date(Date.parse(endExclusive) - 86_400_000).getUTCFullYear()
  return <section className="lab-challenge-path" aria-labelledby="lab-challenge-heading">
    <header><span className="viz-overline">THE CHALLENGE / A CONSISTENT FIRE HISTORY</span><h2 id="lab-challenge-heading">Connect the patterns to the burning calendar.</h2><p>Open the full saved study for harmonized history. This lab explores the native records within your selected dates.</p></header>
    <div className="lab-challenge-links">
      <Link to={`${study}#fire-calendar`}><CalendarRange size={21} aria-hidden="true" /><span><strong>Harmonized fire calendar</strong><small>Explore monthly activity and historical comparisons where the record supports them.</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
      <Link to={`${study}#sensor-bridge`}><GitCompareArrows size={21} aria-hidden="true" /><span><strong>MODIS–VIIRS sensor bridge</strong><small>Inspect the common reference, replay errors, estimates and their limitations.</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
    <dl className="lab-challenge-context"><div><dt>Harmonized unit</dt><dd>Aqua-equivalent active cell-days</dd></div><div><dt>Native unit in this lab</dt><dd>Hot-pixel detection records</dd></div><div><dt>Selected interval</dt><dd>{firstYear}–{lastYear} · availability varies by source</dd></div></dl>
    <p className="lab-challenge-foot">The units answer different questions. Historical comparisons use only the years available in the saved study; native record totals alone do not establish a change in burning.</p>
  </section>
}
