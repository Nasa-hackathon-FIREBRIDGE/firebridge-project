import { useId, useMemo, useState } from 'react'
import { area, line } from 'd3-shape'
import { scaleBand, scaleLinear } from 'd3-scale'
import { concentration, yearSimilarities } from './lab-model'
import { monthLabel } from './analytics'
import { LabChart, LabEmpty } from './LabChart'
import type { ChartSource } from './model'
import { usePlotWidth } from './usePlotWidth'

export function ConcentrationCurve({ source }: { source?: ChartSource }) {
  const id = useId()
  const data = useMemo(() => concentration(source), [source])
  const [focus, setFocus] = useState<number | null>(null)
  const selected = focus === null ? undefined : data.points[Math.min(focus, data.points.length - 1)]
  const { ref, width } = usePlotWidth(650)
  const height = 320
  const x = scaleLinear().domain([0, 100]).range([60, width - 28]), y = scaleLinear().domain([0, 100]).range([height - 50, 20])
  const shape = line<typeof data.points[number]>().x((p) => x(p.x)).y((p) => y(p.y))
  const fill = area<typeof data.points[number]>().x((p) => x(p.x)).y0(y(0)).y1((p) => y(p.y))
  return <LabChart title="Concentration of activity" kind="RANKED CUMULATIVE CURVE" exportable={data.total > 0n} description="Rank full months from most to least active. Read how much of the eligible record is concentrated in a small fraction of months. The diagonal represents equal counts every month." note={`${source?.label ?? 'No focus source'} · ${data.months.length} eligible months. This is a ranked inventory distribution, not a forecast or chronological curve.`}>
    {data.total > 0n ? <>
      <div className="lab-scroll" ref={ref}><svg viewBox={`0 0 ${width} ${height}`} role="img" tabIndex={0} aria-label="Ranked monthly concentration curve" onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
        e.preventDefault(); setFocus((old) => Math.max(0, Math.min(data.points.length - 1, (old ?? 0) + (e.key === 'ArrowRight' ? 1 : -1))))
      }} onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        if (rect.width) setFocus(Math.round(Math.max(0, Math.min(100, x.invert((e.clientX - rect.left) * width / rect.width))) * data.months.length / 100))
      }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ff9f68" stopOpacity=".24" /><stop offset="100%" stopColor="#ff9f68" stopOpacity=".02" /></linearGradient></defs>
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1="60" x2={width - 28} y1={y(v)} y2={y(v)} className="viz-grid" /><text x="48" y={y(v) + 4} textAnchor="end">{v}%</text><text x={x(v)} y={height - 29} textAnchor="middle">{v}%</text></g>)}
        <path d={fill(data.points) ?? undefined} fill={`url(#${id})`} /><line x1={x(0)} x2={x(100)} y1={y(0)} y2={y(100)} stroke="#7c899c" strokeDasharray="4 5" opacity=".5" />
        <path d={shape(data.points) ?? undefined} fill="none" stroke="#ffab76" strokeWidth="2.5" />
        <circle cx={x(data.points[data.top].x)} cy={y(data.topShare)} r="5" fill="#ffab76" stroke="#10141b" strokeWidth="2" />
        {selected && <g><line x1={x(selected.x)} x2={x(selected.x)} y1={20} y2={height - 50} className="viz-cursor" /><circle cx={x(selected.x)} cy={y(selected.y)} r="5" fill="#fff" /></g>}
        <text x={(60 + width - 28) / 2} y={height - 3} textAnchor="middle">{width < 500 ? 'Busiest months first (%)' : 'Share of eligible months · ranked busiest first'}</text>
      </svg></div>
      <div className="lab-stat-callout"><strong>{data.topShare.toFixed(1)}%</strong><span>of eligible records lie in the busiest <b>{data.top} of {data.months.length}</b> months</span></div>
      <output className="viz-inspection" aria-live="polite">{selected?.key ? `Through ${monthLabel(selected.key)} in rank order: ${selected.x.toFixed(1)}% of months contain ${selected.y.toFixed(1)}% of eligible records.` : 'Move over the curve or use ← → to inspect the concentration.'}</output>
    </> : <LabEmpty>{data.months.length ? 'Eligible months have zero records. A cumulative share is undefined, so no curve is invented.' : 'No exact full months in this selection. Widen the date window to analyse concentration.'}</LabEmpty>}
  </LabChart>
}

export function YearSimilarity({ source }: { source?: ChartSource }) {
  const data = useMemo(() => yearSimilarities(source), [source])
  const [focus, setFocus] = useState<{ a: string; b: string } | null>(null)
  const selected = data.cells.find((c) => c.a === focus?.a && c.b === focus?.b)
  const { ref, width } = usePlotWidth(350)
  const size = Math.min(360, width), left = size < 300 ? 48 : 70, bottom = 40
  const band = scaleBand().domain(data.years).range([left, size - bottom]).padding(.07)
  const color = scaleLinear<string>().domain([-1, 0, 1]).range(['#75c8db', '#273542', '#f9a472'])
  const hasData = data.cells.some((c) => c.a !== c.b && c.r !== null)
  return <LabChart title="Similarity between years" kind="PAIRED-MONTH CORRELATION MATRIX" exportable={hasData} description="Do the seasonal shapes resemble each other within this source? Each cell compares the same calendar months in two years using descriptive Pearson correlation." note={`${source?.label ?? 'No focus source'} · At least 4 paired exact full months and non-constant values are required. Correlation does not establish causes or equivalent fire activity.`}>
    {hasData ? <>
      <div className="lab-matrix" ref={ref}><svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Seasonal similarity between years">
        {data.years.map((year) => <g key={year}><text x={(band(year) ?? 0) + band.bandwidth() / 2} y={size - 17} textAnchor="middle">{year}</text><text x={left - 12} y={(band(year) ?? 0) + band.bandwidth() / 2 + 4} textAnchor="end">{year}</text></g>)}
        {data.cells.map((c) => {
          const label = `${c.a} vs ${c.b}: ${c.r === null ? 'unavailable' : `r ${c.r.toFixed(2)}`} · ${c.n} paired months`
          return <g key={`${c.a}:${c.b}`} role="img" tabIndex={0} aria-label={label} onFocus={() => setFocus({ a: c.a, b: c.b })} onPointerEnter={() => setFocus({ a: c.a, b: c.b })}>
            <title>{label}</title><rect x={band(c.a)} y={band(c.b)} width={band.bandwidth()} height={band.bandwidth()} rx="4" fill={c.r === null ? '#ffffff06' : color(c.r)} stroke={selected?.a === c.a && selected.b === c.b ? '#fff' : '#ffffff10'} />
            {band.bandwidth() > 33 && <text x={(band(c.a) ?? 0) + band.bandwidth() / 2} y={(band(c.b) ?? 0) + band.bandwidth() / 2 + 5} textAnchor="middle" className={c.r !== null && Math.abs(c.r) > .65 ? 'lab-matrix-value' : undefined}>{c.r === null ? '—' : c.r.toFixed(2)}</text>}
          </g>
        })}
      </svg></div>
      <div className="lab-similarity-key"><span>−1 · opposite</span><i /><span>+1 · similar shape</span></div>
      <output className="viz-inspection" aria-live="polite">{selected ? `${selected.a} vs ${selected.b} · ${selected.n} paired months · ${selected.r === null ? 'insufficient or constant sample' : `Pearson r = ${selected.r.toFixed(3)}`}` : 'Select a cell for sample size and the correlation coefficient.'}</output>
    </> : <LabEmpty>No similarity score can be established: fewer than 4 paired full months, or a constant series. Unavailable scores remain unavailable.</LabEmpty>}
  </LabChart>
}
