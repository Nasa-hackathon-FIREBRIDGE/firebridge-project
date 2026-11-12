import { useMemo, useState } from 'react'
import { scaleBand, scaleSymlog } from 'd3-scale'
import { distribution } from './lab-model'
import { monthLabel } from './analytics'
import type { ChartSource } from './model'
import { LabChart, LabEmpty } from './LabChart'
import { usePlotWidth } from './usePlotWidth'

const fmt = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })

export function DistributionPlot({ sources }: { sources: ChartSource[] }) {
  const data = useMemo(() => sources.map((s) => ({ source: s, ...distribution(s) })), [sources])
  const [focus, setFocus] = useState<{ sourceId: string; month: string } | null>(null)
  const selected = data.find((d) => d.source.id === focus?.sourceId)
  const point = selected?.months.find((m) => m.key === focus?.month)
  const { ref, width } = usePlotWidth(760)
  const left = width < 450 ? 92 : 145, right = 24
  const height = Math.max(280, sources.length * 64 + 65)
  const x = scaleSymlog().domain([0, Math.max(1, ...data.flatMap((d) => d.months.map((m) => m.plot)))]).range([left, width - right])
  const y = scaleBand().domain(sources.map((s) => s.id)).range([18, height - 48]).padding(.5)
  const hasData = data.some((d) => d.months.length)
  return <LabChart title="Monthly variability" kind="BOX & STRIP PLOT" exportable={hasData} description="One dot per exact, full month. The box contains the middle 50%; its centre marks the median. Symmetric-log spacing keeps both quiet and busy months readable." note="Whiskers use 1.5× the interquartile range; a box requires at least 4 months. Each source can have a different eligible sample, so these are native inventories, not comparable fire rates.">
    {hasData ? <>
      <div className="lab-scroll" ref={ref}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Distribution of monthly detections by source">
        {x.ticks(width < 450 ? 3 : 5).filter(Number.isInteger).map((v) => <g key={v}><line x1={x(v)} x2={x(v)} y1="12" y2={height - 48} className="viz-grid" /><text x={x(v)} y={height - 25} textAnchor="middle">{fmt.format(v)}</text></g>)}
        {data.map((d) => {
          const cy = (y(d.source.id) ?? 0) + y.bandwidth() / 2
          const name = d.source.label.split(' · ')[0]
          const limit = width < 450 ? 11 : 18
          return <g key={d.source.id} data-box-source={d.source.id}><text x={left - 12} y={cy - 1} textAnchor="end"><title>{d.source.label}</title>{name.length > limit ? name.slice(0, limit - 1) + '…' : name}</text><text className="lab-svg-muted" x={left - 12} y={cy + 15} textAnchor="end">{d.months.length} full months</text>
            {d.box && <g stroke={d.source.color} fill={d.source.color}>
              <line x1={x(d.box.low)} x2={x(d.box.high)} y1={cy} y2={cy} />
              {[d.box.low, d.box.high].map((v, i) => <line key={i} x1={x(v)} x2={x(v)} y1={cy - 10} y2={cy + 10} />)}
              <rect x={x(d.box.q1)} y={cy - 13} width={Math.max(1, x(d.box.q3) - x(d.box.q1))} height="26" opacity=".2" rx="3" />
              <line x1={x(d.box.median)} x2={x(d.box.median)} y1={cy - 15} y2={cy + 15} strokeWidth="2" />
            </g>}
            {d.months.map((m) => <circle key={m.key} cx={x(m.plot)} cy={cy + ((Number(m.year) * 13 + m.month * 7) % 9 - 4) * 2.1} r="3.5" fill={d.source.color} fillOpacity=".75" stroke="#10141b" strokeWidth=".6" tabIndex={0} role="img" aria-label={`${d.source.label} · ${monthLabel(m.key)}: ${m.exact} records`}
              onFocus={() => setFocus({ sourceId: d.source.id, month: m.key })} onPointerEnter={() => setFocus({ sourceId: d.source.id, month: m.key })}><title>{monthLabel(m.key)} · {BigInt(m.exact).toLocaleString('en-GB')} records</title></circle>)}
          </g>
        })}
        <text x={(left + width - right) / 2} y={height - 3} textAnchor="middle">{width < 500 ? 'Records / month · symlog' : 'Native detections / full month · symlog scale'}</text>
      </svg></div>
      <output className="viz-inspection" aria-live="polite">{selected && point ? `${selected.source.label} · ${monthLabel(point.key)}: ${BigInt(point.exact).toLocaleString('en-GB')} records` : 'Focus a dot to inspect its month and exact count.'}</output>
    </> : <LabEmpty>No exact full-month counts in this interval. Widen the dates or choose another source; partial values are not substituted.</LabEmpty>}
    <span className="lab-sample-note">{data.reduce((n, d) => n + d.months.length, 0)} eligible source-months</span>
  </LabChart>
}
