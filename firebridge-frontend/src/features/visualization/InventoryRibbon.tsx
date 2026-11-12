import { useId, useState } from 'react'
import { scaleBand, scaleUtc } from 'd3-scale'
import { countLabel, type ChartSource } from './model'
import { LabChart, LabEmpty } from './LabChart'
import { usePlotWidth } from './usePlotWidth'

const colors = { complete: '#48c7a3', lower_bound: '#f4ab64', unknown: '#455267' }

export function InventoryRibbon({ sources, start, endExclusive }: { sources: ChartSource[]; start: string; endExclusive: string }) {
  const id = useId()
  const [focus, setFocus] = useState({ source: 0, period: 0 })
  const { ref, width } = usePlotWidth(1080)
  const left = width < 500 ? 110 : 170
  const height = Math.max(160, sources.length * 43 + 60)
  const x = scaleUtc().domain([new Date(start), new Date(endExclusive)]).range([left, width - 36])
  const y = scaleBand().domain(sources.map((s) => s.id)).range([12, height - 40]).padding(.35)
  const selectedSource = sources[Math.min(focus.source, sources.length - 1)]
  const selected = selectedSource?.points[Math.min(focus.period, selectedSource.points.length - 1)]
  return <LabChart title="Inventory continuity" kind="TEMPORAL RIBBONS" exportable={sources.length > 0} description="Find where the monthly inventory is exact, incomplete or unknown, source by source. This is an inventory audit, not a map of satellite observation coverage." note="Keyboard: ← → move through months; ↑ ↓ switch sources. Clipped date windows can still have a complete count for the queried days.">
    {sources.length ? <>
      <div className="lab-scroll" ref={ref}><svg viewBox={`0 0 ${width} ${height}`} role="img" tabIndex={0} aria-label="Inventory continuity by source" onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
        e.preventDefault()
        setFocus((p) => ({ source: Math.max(0, Math.min(sources.length - 1, p.source + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0))), period: Math.max(0, Math.min((sources[0]?.points.length ?? 1) - 1, p.period + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0))) }))
      }}>
        <defs><pattern id={`${id}-gap`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="5" height="5" fill="#202935" /><line y2="5" stroke="#617089" strokeWidth="1" /></pattern></defs>
        {sources.map((source, row) => <g key={source.id}><text x={left - 12} y={(y(source.id) ?? 0) + y.bandwidth() / 2 + 4} textAnchor="end"><title>{source.label}</title>{source.label.length > (width < 500 ? 13 : 24) ? source.label.slice(0, width < 500 ? 12 : 23) + '…' : source.label}</text>
          {source.points.map((p, col) => <rect key={p.start} x={x(p.time)} y={y(source.id)} width={Math.max(.5, x(new Date(p.endExclusive)) - x(p.time) - 1)} height={y.bandwidth()} rx="2"
            fill={p.state === 'unknown' ? `url(#${id}-gap)` : colors[p.state]} opacity={p.state === 'complete' ? .85 : 1}
            stroke={selectedSource?.id === source.id && selected?.start === p.start ? '#fff' : 'none'} strokeWidth={2}
            onPointerEnter={() => setFocus({ source: row, period: col })} onClick={() => setFocus({ source: row, period: col })}>
            <title>{source.label} · {p.start.slice(0, 10)}: {countLabel(p)} · {p.state}</title>
          </rect>)}
        </g>)}
        {x.ticks(Math.max(2, Math.floor((width - left) / 100))).map((tick) => <text key={+tick} x={x(tick)} y={height - 12} textAnchor="middle">{tick.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>)}
      </svg></div>
      <div className="lab-legend"><span><i style={{ background: colors.complete }} />Complete</span><span><i style={{ background: colors.lower_bound }} />Lower bound</span><span><i className="lab-hatched" />Unknown</span></div>
      <output className="viz-inspection" aria-live="polite">{selected ? `${selectedSource.label} · ${selected.start.slice(0, 10)} → ${selected.endExclusive.slice(0, 10)} (end excluded): ${countLabel(selected)} records · ${selected.state}` : 'No monthly inventory in this interval.'}</output>
    </> : <LabEmpty>Select a source to inspect its inventory.</LabEmpty>}
  </LabChart>
}
