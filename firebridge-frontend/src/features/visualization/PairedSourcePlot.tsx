import { useMemo, useState } from 'react'
import { scaleBand, scaleLinear } from 'd3-scale'
import { eligibleMonths, monthPairs } from './lab-model'
import { MONTHS, monthLabel } from './analytics'
import { LabChart, LabEmpty } from './LabChart'
import type { ChartSource } from './model'
import { sensorMeta } from '../../lib/sensors'
import { usePlotWidth } from './usePlotWidth'

const short = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })

export function PairedSourcePlot({ sources }: { sources: ChartSource[] }) {
  const [aId, setAId] = useState(''), [bId, setBId] = useState(''), [yearId, setYearId] = useState('')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const preferred = useMemo(() => [...sources].sort((a, b) => eligibleMonths(b).length - eligibleMonths(a).length), [sources])
  const a = sources.find((s) => s.id === aId) ?? preferred[0]
  const preferredB = useMemo(() => {
    const instrument = a ? sensorMeta(a.id, a.label).instrument : 'Unknown'
    const rank = (s: ChartSource) => {
      const n = monthPairs(a, s).length, other = sensorMeta(s.id, s.label).instrument
      return n + (n && instrument !== 'Unknown' && other !== 'Unknown' && other !== instrument ? 10_000 : 0)
    }
    return sources.filter((s) => s.id !== a?.id).sort((l, r) => rank(r) - rank(l))
  }, [sources, a])
  const b = sources.find((s) => s.id === bId && s.id !== a?.id) ?? preferredB[0]
  const pairs = useMemo(() => monthPairs(a, b), [a, b])
  const years = [...new Set(sources.flatMap((s) => s.points.map((p) => p.start.slice(0, 4))))].sort()
  const rankedYears = [...years].sort((l, r) => pairs.filter((p) => p.key.startsWith(r)).length - pairs.filter((p) => p.key.startsWith(l)).length || r.localeCompare(l))
  const year = years.includes(yearId) ? yearId : rankedYears[0] ?? ''
  const shown = pairs.filter((p) => p.key.startsWith(year))
  const focused = shown.find((p) => p.key === focusKey)
  const { ref, width } = usePlotWidth(650)
  const height = 414, left = 42, right = 112
  const x = scaleLinear().domain([0, Math.max(1, ...shown.flatMap((p) => [p.x, p.y]))]).nice().range([left, width - right])
  const y = scaleBand().domain(MONTHS).range([40, height - 44]).padding(.3)
  const aColor = a?.color ?? '#ffa66e', bColor = b?.color !== aColor ? b?.color ?? '#62cde5' : '#f3ad72'
  const options = sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)
  return <LabChart title="Monthly source comparison" kind="PAIRED DOT PLOT" exportable={shown.length > 0} description="One row per month, two dots on the same count axis. The connector shows the difference between source A and source B; the exact values are available on inspection." controls={sources.length > 1 && <><label>Source A<select aria-label="Comparison source A" value={a?.id ?? ''} onChange={(e) => setAId(e.target.value)}>{options}</select></label><label>Source B<select aria-label="Comparison source B" value={b?.id ?? ''} onChange={(e) => setBId(e.target.value)}>{options.filter((o) => o.key !== a?.id)}</select></label><label>Year<select aria-label="Source comparison year" value={year} onChange={(e) => setYearId(e.target.value)}>{years.map((v) => <option key={v}>{v}</option>)}</select></label></>} note="Only shared exact, full UTC months are paired. × means no valid pair. Native counts reflect instrument resolution and inventory; their difference is not a count of additional fires.">
    {a && b && shown.length ? <>
      <div className="lab-legend"><span><i style={{ background: aColor }} />A · {a.label}</span><span><i style={{ background: bColor }} />B · {b.label}</span></div>
      <div className="lab-scroll" ref={ref}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Paired monthly source counts">
        {x.ticks(width < 450 ? 3 : 5).filter(Number.isInteger).map((v) => <g key={v}><line x1={x(v)} x2={x(v)} y1="30" y2={height - 44} className="viz-grid" /><text x={x(v)} y={height - 22} textAnchor="middle">{short.format(v)}</text></g>)}
        <text x={width - 58} y="23" textAnchor="end" style={{ fill: aColor }}>A</text><text x={width - 5} y="23" textAnchor="end" style={{ fill: bColor }}>B</text>
        {MONTHS.map((name, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`, p = shown.find((value) => value.key === key), cy = (y(name) ?? 0) + y.bandwidth() / 2
          const label = p ? `${monthLabel(key)} · A ${p.x.toLocaleString('en-GB')} · B ${p.y.toLocaleString('en-GB')} records` : `${name}: no exact full-month pair`
          return <g key={key} data-paired-month={key}><text x="30" y={cy + 4} textAnchor="end">{name}</text>{p ? <g tabIndex={0} role="img" aria-label={label} onFocus={() => setFocusKey(key)} onPointerEnter={() => setFocusKey(key)} onClick={() => setFocusKey(key)}>
            <title>{label}</title><line x1={x(p.x)} x2={x(p.y)} y1={cy} y2={cy} stroke="#a6b0bd" strokeOpacity={focused?.key === key ? 1 : .5} strokeWidth={focused?.key === key ? 3 : 2} />
            <circle cx={x(p.x)} cy={cy} r="5" stroke={aColor} fill="#10141b" strokeWidth="2" /><circle cx={x(p.y)} cy={cy} r="3.5" fill={bColor} />
            <text x={width - 58} y={cy + 4} textAnchor="end" style={{ fill: aColor }}>{short.format(p.x)}</text><text x={width - 5} y={cy + 4} textAnchor="end" style={{ fill: bColor }}>{short.format(p.y)}</text>
          </g> : <text x={left + 5} y={cy + 4} className="lab-svg-muted"><title>{label}</title>×</text>}</g>
        })}
        <text x={(left + width - right) / 2} y={height - 3} textAnchor="middle">Records · linear scale</text>
      </svg></div>
      <output className="viz-inspection" aria-live="polite">{focused ? `${monthLabel(focused.key)} · ${a.label}: ${focused.x.toLocaleString('en-GB')} · ${b.label}: ${focused.y.toLocaleString('en-GB')}` : `${shown.length}/12 shared full months in ${year}. Focus or select a row to inspect exact counts.`}</output>
    </> : <LabEmpty>{sources.length < 2 ? 'Select at least two streams for the monthly comparison.' : 'These sources have no shared exact, full months in this year.'}</LabEmpty>}
  </LabChart>
}
