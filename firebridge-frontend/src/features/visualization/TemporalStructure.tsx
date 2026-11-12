import { useId, useMemo, useState } from 'react'
import { hierarchy, treemap } from 'd3-hierarchy'
import { scaleBand, scaleLinear } from 'd3-scale'
import { eligibleMonths, percent, yearDifferences, type ExactMonth } from './lab-model'
import { MONTHS, monthlyCells, monthLabel } from './analytics'
import { LabChart, LabEmpty } from './LabChart'
import { countLabel, type ChartSource } from './model'
import { usePlotWidth } from './usePlotWidth'

const quarterColors = ['#5994af', '#b488d8', '#e2a95e', '#d57859']
const short = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })
interface Tile { name: string; month?: ExactMonth; children?: Tile[] }

function layoutMonths(months: ExactMonth[], width: number, height: number) {
  const root: Tile = { name: 'year', children: Array.from({ length: 4 }, (_, q) => ({ name: `Q${q + 1}`, children: months.filter((m) => Math.floor(m.month / 3) === q && m.plot > 0).map((m) => ({ name: MONTHS[m.month], month: m })) })).filter((q) => q.children.length) }
  return treemap<Tile>().size([width, height]).paddingOuter(0).paddingInner(5).paddingTop((node) => node.depth === 1 ? 22 : 0).round(true)(hierarchy(root).sum((node) => node.month?.plot ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)))
}

export function TemporalTreemap({ source }: { source?: ChartSource }) {
  const id = useId()
  const all = useMemo(() => source ? monthlyCells([source]) : [], [source])
  const eligible = useMemo(() => eligibleMonths(source), [source])
  const years = [...new Set(all.map((m) => m.year))]
  const preferred = years.filter((y) => eligible.filter((m) => m.year === y).length === 12).at(-1) ?? years.at(-1) ?? ''
  const [chosen, setChosen] = useState('')
  const year = years.includes(chosen) ? chosen : preferred
  const months = eligible.filter((m) => m.year === year)
  const total = months.reduce((n, m) => n + BigInt(m.exact), 0n)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const focused = months.find((m) => m.key === focusKey)
  const { ref, width } = usePlotWidth(700)
  const plotHeight = width < 450 ? 280 : 335
  const columns = Math.max(1, Math.min(4, Math.floor(width / 135)))
  const tiles = layoutMonths(months, width, plotHeight)
  const smallTiles = tiles.leaves().filter((leaf) => leaf.data.month && (leaf.x1 - leaf.x0 < 80 || leaf.y1 - leaf.y0 < 48))
    .sort((a, b) => (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2)
  const chartHeight = plotHeight + (smallTiles.length ? 28 + Math.ceil(smallTiles.length / columns) * 54 : 0)
  return <LabChart title="Anatomy of a year" kind="HIERARCHICAL TREEMAP" exportable={total > 0n} description="Rectangle area encodes the share of records held by each month, grouped into quarters. Explore the structure within one source and one year." controls={<label>Calendar year<select aria-label="Treemap year" disabled={!years.length} value={year} onChange={(e) => setChosen(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>} note={`${source?.label ?? 'No focus source'} · ${months.length}/12 exact full months included. Missing, lower-bound and clipped months are excluded. Shares describe this eligible subset, not an estimated annual total.`}>
    {total > 0n ? <>
      <div className="lab-scroll" ref={ref}><svg viewBox={`0 0 ${width} ${chartHeight}`} role="img" aria-label="Monthly composition treemap">
        <defs>{tiles.leaves().map((leaf, i) => <clipPath key={i} id={`${id}-${i}`}><rect x={leaf.x0} y={leaf.y0} width={Math.max(0, leaf.x1 - leaf.x0)} height={Math.max(0, leaf.y1 - leaf.y0)} /></clipPath>)}</defs>
        {tiles.children?.map((q) => <g key={q.data.name}><rect x={q.x0} y={q.y0} width={Math.max(0, q.x1 - q.x0)} height={Math.max(0, q.y1 - q.y0)} fill="#ffffff03" rx="4" /><text x={q.x0 + 7} y={q.y0 + 14} className="lab-svg-muted">{q.data.name}</text></g>)}
        {tiles.leaves().filter((leaf) => leaf.data.month).map((leaf, i) => {
          const month = leaf.data.month!, share = percent(BigInt(month.exact), total)
          const label = `${monthLabel(month.key)}: ${BigInt(month.exact).toLocaleString('en-GB')} records · ${share.toFixed(1)}% of eligible total`
          return <g key={month.key} tabIndex={0} role="img" aria-label={label} onFocus={() => setFocusKey(month.key)} onPointerEnter={() => setFocusKey(month.key)}>
            <title>{label}</title><rect x={leaf.x0} y={leaf.y0} width={Math.max(0, leaf.x1 - leaf.x0)} height={Math.max(0, leaf.y1 - leaf.y0)} fill={quarterColors[Math.floor(month.month / 3)]} rx="3" opacity={focused && focused.key !== month.key ? .65 : .95} stroke={focused?.key === month.key ? '#fff' : 'none'} strokeWidth="1.5" />
            {leaf.x1 - leaf.x0 >= 80 && leaf.y1 - leaf.y0 >= 48 && <g clipPath={`url(#${id}-${i})`} className="lab-tile-label"><text x={leaf.x0 + 10} y={leaf.y0 + 21}>{MONTHS[month.month]}</text><text x={leaf.x0 + 10} y={leaf.y0 + 40}>{share.toFixed(1)}%</text></g>}
          </g>
        })}
        {smallTiles.map((leaf, i) => {
          const month = leaf.data.month!, share = percent(BigInt(month.exact), total).toFixed(1)
          const cx = (leaf.x0 + leaf.x1) / 2, cy = (leaf.y0 + leaf.y1) / 2
          const count = Math.min(columns, smallTiles.length - Math.floor(i / columns) * columns)
          const slot = width / count, x = (i % columns) * slot + 8, y = plotHeight + 23 + Math.floor(i / columns) * 54
          const anchor = x + Math.min(slot - 24, 150) / 2
          const label = `Inspect ${MONTHS[month.month]} ${year}: ${share}%`
          return <g key={month.key} className="lab-tile-callout" data-treemap-callout={month.key} role="button" tabIndex={0} aria-label={label}
            onClick={() => setFocusKey(month.key)} onFocus={() => setFocusKey(month.key)} onPointerEnter={() => setFocusKey(month.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusKey(month.key) } }}>
            <path d={`M${cx},${cy} V${y - 8} H${anchor} V${y}`} fill="none" stroke="#131820" strokeWidth="3" opacity=".75" />
            <path d={`M${cx},${cy} V${y - 8} H${anchor} V${y}`} fill="none" stroke="#e4d4c5" strokeWidth="1" strokeDasharray="3 3" opacity={focused?.key === month.key ? 1 : .6} />
            <circle cx={cx} cy={cy} r="2.8" fill="#fff4e5" stroke="#141a23" strokeWidth="1" />
            <rect x={x} y={y} width={Math.min(slot - 24, 150)} height="42" rx="4" fill="#17212b" stroke={focused?.key === month.key ? '#ffb07e' : '#52606e'} strokeWidth="1" />
            <text x={x + 10} y={y + 17}>{MONTHS[month.month]}</text><text x={x + 10} y={y + 33}>{share}%</text>
          </g>
        })}
      </svg></div>
      <output className="viz-inspection" aria-live="polite">{focused ? `${monthLabel(focused.key)} · ${BigInt(focused.exact).toLocaleString('en-GB')} records · ${percent(BigInt(focused.exact), total).toFixed(1)}% of the eligible total` : `${BigInt(total).toLocaleString('en-GB')} records in ${months.length} exact full months; ${months.filter((m) => m.plot === 0).length} zero-count months have no rectangle area.`}</output>
    </> : <LabEmpty>{months.length ? 'The eligible months all have verified zero counts. No non-zero area can be drawn.' : 'No exact full month for this source and year. Select another year or widen the date window.'}</LabEmpty>}
    {year && <div className="lab-treemap-legend">
      <p>All 12 months · small rectangles remain readable here.</p>
      <ul aria-label={`All months in the ${year} treemap`}>{MONTHS.map((name, month) => {
        const input = all.find((m) => m.year === year && m.month === month)
        const included = months.find((m) => m.month === month)
        const share = included && total > 0n ? `${percent(BigInt(included.exact), total).toFixed(1)}%` : '—'
        const state = !input ? 'Outside selection' : included ? `${countLabel(included)} records` : !input.fullMonth ? 'Partial date window' : input.state === 'unknown' ? 'Unknown inventory' : input.state === 'lower_bound' ? `${countLabel(input)} records · excluded` : 'Beyond chart precision'
        const label = `${name} ${year}: ${share} · ${state}`
        return <li key={name}><button type="button" aria-label={label} title={label} disabled={!included || total === 0n} data-export-label={label} aria-pressed={!!included && focused?.key === included.key}
          onClick={() => { if (included) setFocusKey(included.key) }} onFocus={() => { if (included) setFocusKey(included.key) }}>
          <i style={{ background: input ? quarterColors[Math.floor(month / 3)] : '#455267' }} aria-hidden="true" /><span><strong>{name}</strong><small>{state}</small></span><b>{share}</b>
        </button></li>
      })}</ul>
    </div>}
  </LabChart>
}

export function YearDifference({ source }: { source?: ChartSource }) {
  const all = useMemo(() => source ? monthlyCells([source]) : [], [source])
  const years = [...new Set(all.map((m) => m.year))]
  const complete = years.filter((year) => eligibleMonths(source).filter((m) => m.year === year).length === 12)
  const preferred = complete.length > 1 ? complete : years
  const [refId, setRefId] = useState(''), [targetId, setTargetId] = useState('')
  const reference = years.includes(refId) ? refId : preferred.at(-2) ?? years[0] ?? ''
  const target = years.includes(targetId) && targetId !== reference ? targetId : [...preferred].reverse().find((y) => y !== reference) ?? years.find((y) => y !== reference) ?? ''
  const rows = useMemo(() => yearDifferences(source, reference, target), [source, reference, target])
  const [focus, setFocus] = useState<number | null>(null)
  const inspected = rows.find((r) => r.month === focus && r.delta !== null)
  const { ref, width } = usePlotWidth(700)
  const height = 350
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.plot ?? 0)))
  const x = scaleLinear().domain([-max, max]).nice().range([65, width - 65])
  const y = scaleBand().domain(MONTHS).range([15, height - 42]).padding(.35)
  const count = rows.filter((r) => r.delta !== null).length
  return <LabChart title="Year-over-year differences" kind="DIVERGING CHANGE PLOT" exportable={count > 0} description="How did the same calendar month change within one source? Orange means more native records in the comparison year; blue means fewer." controls={<><label>Reference year<select aria-label="Difference reference year" disabled={!years.length} value={reference} onChange={(e) => setRefId(e.target.value)}>{years.map((year) => <option key={year}>{year}</option>)}</select></label><label>Comparison year<select aria-label="Difference comparison year" disabled={years.length < 2} value={target} onChange={(e) => setTargetId(e.target.value)}>{years.filter((year) => year !== reference).map((year) => <option key={year}>{year}</option>)}</select></label></>} note={`${source?.label ?? 'No focus source'} · ${count}/12 paired exact, full months. × means no valid pair. Differences are native record changes, not an estimate of extra fires or a historical anomaly score.`}>
    {count ? <>
      <div className="lab-scroll" ref={ref}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Paired monthly year-over-year differences">
        {x.ticks(width < 450 ? 3 : 5).filter(Number.isInteger).map((v) => <g key={v}><line x1={x(v)} x2={x(v)} y1="12" y2={height - 42} className="viz-grid" /><text x={x(v)} y={height - 15} textAnchor="middle">{v > 0 ? '+' : ''}{short.format(v)}</text></g>)}
        <line x1={x(0)} x2={x(0)} y1="12" y2={height - 42} stroke="#8894a8" strokeWidth="1" />
        {rows.map((r) => {
          const cy = (y(MONTHS[r.month]) ?? 0) + y.bandwidth() / 2
          const label = r.delta === null ? `${MONTHS[r.month]}: no exact full-month pair` : `${MONTHS[r.month]}: ${r.delta > 0n ? '+' : ''}${r.delta.toLocaleString('en-GB')} records (${r.before!.exact} → ${r.after!.exact})`
          return <g key={r.month}><text x="46" y={cy + 4} textAnchor="end">{MONTHS[r.month]}</text>{r.plot === null ? <text x={x(0)} y={cy + 4} textAnchor="middle" className="lab-svg-muted"><title>{label}</title>×</text> : <g role="img" tabIndex={0} aria-label={label} onFocus={() => setFocus(r.month)} onPointerEnter={() => setFocus(r.month)}><title>{label}</title><rect x={Math.min(x(0), x(r.plot))} y={y(MONTHS[r.month])} width={Math.max(1, Math.abs(x(r.plot) - x(0)))} height={y.bandwidth()} rx="2" fill={r.plot < 0 ? '#64cde2' : '#f6a16b'} opacity=".85" /></g>}</g>
        })}
      </svg></div>
      <output className="viz-inspection" aria-live="polite">{inspected ? `${MONTHS[inspected.month]} · ${reference}: ${inspected.before!.exact} → ${target}: ${inspected.after!.exact} · change ${inspected.delta! > 0n ? '+' : ''}${inspected.delta!.toLocaleString('en-GB')}` : `${target} minus ${reference} · same source, same calendar month, exact inventories only.`}</output>
    </> : <LabEmpty>{years.length < 2 ? 'Choose a date window covering at least two years for this comparison.' : 'No paired exact full months for these years. Missing records are not treated as zero.'}</LabEmpty>}
  </LabChart>
}
