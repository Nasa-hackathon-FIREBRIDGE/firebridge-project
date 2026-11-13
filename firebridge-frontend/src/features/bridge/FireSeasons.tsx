import { useId, useMemo, useRef, type KeyboardEvent } from 'react'
import { useElementWidth } from '../../hooks/useElementWidth'
import type { BridgeReport } from './engine/index.ts'
import { MONTH_SHORT, verdict } from './calendar'
import { fmtCount, fmtInt, fmtMonth, sensorLabel } from './format'

export type SeasonMode = 'harmonized' | 'raw'

/**
 * Fire seasons: one ridge per year, January to December, stacked like a range of hills. Behind
 * each ridge a faint dashed line traces the usual season (the same calendar month in the other
 * years). Months are not coloured one by one; only the exceptions the satellites agree on glow.
 */

type Mark = 'high' | 'low' | 'disputed' | 'raw-flag' | 'confirmed'

interface Point {
  month: string
  index: number
  value: number | null
  usual: number | null
  estimated: boolean
  mark: Mark | null
  label: string
}

const LEFT = 52
const RIGHT = 16
const TOP = 40

const shiftMonth = (month: string, delta: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

type XY = [number, number]

/** Smooth path through points (Catmull–Rom as cubic Béziers), never dipping below the baseline. */
function segments(points: XY[], base: number) {
  const out: string[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    const c1: XY = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)]
    const c2: XY = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)]
    out.push(`C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`)
  }
  return out
}

/** Paths of one year's ridge: filled area, observed and estimated outline, and the usual season. */
function ridge(points: readonly Point[], y0: number, xOf: (index: number) => number, colW: number, lift: (value: number) => number) {
  const runs: Point[][] = []
  for (const p of points) {
    if (p.value === null) continue
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1].index === p.index - 1) runs[runs.length - 1] = [...last, p]
    else runs.push([p])
  }
  const fill: string[] = []
  const solid: string[] = []
  const dashed: string[] = []
  for (const run of runs) {
    const xy: XY[] = [[xOf(run[0].index) - colW / 2, y0], ...run.map((p): XY => [xOf(p.index), y0 - lift(p.value!)]), [xOf(run[run.length - 1].index) + colW / 2, y0]]
    const curve = segments(xy, y0)
    fill.push(`M${xy[0][0].toFixed(1)},${y0} ${curve.join(' ')} Z`)
    curve.forEach((c, k) => {
      const left = run[Math.max(0, k - 1)]
      const right = run[Math.min(run.length - 1, k)]
      ;(left.estimated || right.estimated ? dashed : solid).push(`M${xy[k][0].toFixed(1)},${xy[k][1].toFixed(1)} ${c}`)
    })
  }
  const usual = points.filter((p) => p.usual !== null)
  const groups: XY[][] = []
  usual.forEach((p, k) => {
    const point: XY = [xOf(p.index), y0 - lift(p.usual!)]
    if (k && usual[k - 1].index === p.index - 1) groups[groups.length - 1].push(point)
    else groups.push([point])
  })
  const ghost = groups.filter((g) => g.length > 1).map((g) => `M${g[0][0].toFixed(1)},${g[0][1].toFixed(1)} ${segments(g, y0).join(' ')}`)
  return { fill, solid, dashed, ghost }
}

export function FireSeasons({ report, mode, focus, hover, onFocus, onHover }: { report: BridgeReport; mode: SeasonMode; focus: string; hover: string | null; onFocus: (month: string) => void; onHover: (month: string | null) => void }) {
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useElementWidth<HTMLDivElement>(880)
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const threshold = report.anomalies.threshold

  const rows = useMemo(() => {
    const byMonth = new Map(report.months.map((m) => [m.month, m]))
    const anomalies = new Map(report.anomalies.months.map((a) => [a.month, a]))
    const value = (month: string) => {
      const record = byMonth.get(month)
      if (!record) return null
      return mode === 'raw' ? record.raw : record.bridge?.value ?? null
    }
    const years = [...new Set(report.months.map((m) => m.month.slice(0, 4)))]
    // Usual season: back-transformed mean of log(1 + x) of the same month in the other years,
    // the same "usual" the satellite jury judges against.
    const usual = (year: string, index: number) => {
      const mm = String(index + 1).padStart(2, '0')
      const others = years.filter((y) => y !== year).map((y) => value(`${y}-${mm}`)).filter((v): v is number => v !== null)
      return others.length >= 2 ? Math.expm1(others.reduce((sum, v) => sum + Math.log1p(v), 0) / others.length) : null
    }
    return years.map((year) => ({
      year,
      points: MONTH_SHORT.flatMap((_, index): Point[] => {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`
        const record = byMonth.get(month)
        if (!record) return []
        const a = anomalies.get(month)
        const v = verdict(a, report)
        const val = value(month)
        const rawFlag = a?.raw && Math.abs(a.raw.z) >= threshold ? (a.raw.z > 0 ? 'high' : 'low') : null
        const estimated = mode === 'harmonized' && !!record.bridge && record.bridge.source !== 'aqua'
        let mark: Mark | null = null
        if (mode === 'harmonized') mark = v.tone === 'high' ? 'high' : v.tone === 'low' ? 'low' : v.tone === 'disputed' ? 'disputed' : null
        else if (rawFlag) mark = a?.kind === 'unusual-high' || a?.kind === 'unusual-low' ? 'confirmed' : 'raw-flag'
        const label = `${fmtMonth(month, 'long')}: ${val === null ? 'no record' : mode === 'raw' ? `${fmtInt(val)} native detections` : `${fmtCount(val)} Aqua-equivalent cell-days${estimated ? `, estimated from ${sensorLabel(record.bridge!.source)}` : ''}`}. ${mode === 'raw' ? (rawFlag ? `Raw total unusually ${rawFlag}.` : '') : v.label}.`
        return [{ month, index, value: val, usual: usual(year, index), estimated, mark, label }]
      }),
    }))
  }, [report, mode, threshold])

  const n = rows.length
  const gap = n > 12 ? 34 : n > 8 ? 44 : 56
  const amp = gap * 1.3
  const base = (i: number) => TOP + amp + i * gap
  const height = base(Math.max(0, n - 1)) + 26
  const colW = (width - LEFT - RIGHT) / 12
  const xOf = (index: number) => LEFT + (index + 0.5) * colW
  const max = Math.max(1, ...rows.flatMap((r) => r.points.map((p) => p.value ?? 0)))
  const lift = (value: number) => amp * Math.sqrt(Math.max(0, value) / max)
  const focusedYear = focus.slice(0, 4)
  const narrow = colW < 34
  const core = report.evidence?.seasonality?.core ?? null
  const colours = mode === 'raw' ? { stroke: '#aab0bc', fill: '#8b93a3', alpha: 0.3 } : { stroke: '#ffa070', fill: '#ff7c40', alpha: 0.5 }

  const pick = (x: number, y: number): string | null => {
    const index = Math.floor((x - LEFT) / colW)
    if (index < 0 || index > 11) return null
    for (let i = n - 1; i >= 0; i--) {
      const p = rows[i].points.find((q) => q.index === index)
      if (p && y <= base(i) + 6 && y >= base(i) - lift(p.value ?? 0) - 8) return p.month
    }
    for (let i = 0; i < n; i++) if (y <= base(i) + 6) return rows[i].points.find((q) => q.index === index)?.month ?? null
    return null
  }

  const move = (event: KeyboardEvent, month: string) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -12, ArrowDown: 12 }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const first = report.months[0].month
    const last = report.months[report.months.length - 1].month
    let next = shiftMonth(month, delta)
    while (!cells.current.has(next) && next >= first && next <= last) next = shiftMonth(next, Math.sign(delta))
    if (!cells.current.has(next)) return
    onFocus(next)
    cells.current.get(next)?.focus()
  }

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} onMouseLeave={() => onHover(null)}>
      <svg width={width} height={height} className="absolute inset-0 block overflow-visible" aria-hidden="true">
        <defs>
          <filter id={`${uid}-glow`} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          {rows.map((row, i) => (
            <linearGradient key={row.year} id={`${uid}-fill-${i}`} gradientUnits="userSpaceOnUse" x1="0" y1={base(i) - amp} x2="0" y2={base(i)}>
              <stop offset="0" stopColor={colours.fill} stopOpacity={colours.alpha} />
              <stop offset="1" stopColor={colours.fill} stopOpacity={0.03} />
            </linearGradient>
          ))}
        </defs>

        {/* Quarter guides and the core fire season, measured from this record. */}
        {[3, 6, 9].map((q) => (
          <line key={q} x1={LEFT + q * colW} x2={LEFT + q * colW} y1={TOP - 4} y2={height - 18} stroke="rgba(255,255,255,0.04)" />
        ))}
        {core && core.length < 12 && mode === 'harmonized' && (
          <g>
            {[0, 1].map((part) => {
              const start = part === 0 ? core.start : 0
              const end = part === 0 ? Math.min(12, core.start + core.length) : core.start + core.length - 12
              if (end <= start) return null
              return <rect key={part} x={LEFT + start * colW + 3} y={TOP - 30} width={(end - start) * colW - 6} height={3} rx={1.5} fill="#ff7c40" opacity={0.55} />
            })}
            {(() => {
              const text = narrow ? `CORE SEASON · ${Math.round(core.share * 100)}%` : `CORE FIRE SEASON · ${Math.round(core.share * 100)}% OF A YEAR`
              const start = LEFT + core.start * colW + 3
              // Keep the label inside the chart: anchor it at the right edge when it would overflow.
              const overflow = start + text.length * 6.6 > width - RIGHT
              return (
                <text x={overflow ? width - RIGHT : start} y={TOP - 34} textAnchor={overflow ? 'end' : 'start'} fill="#ffa070" fontSize="10" fontFamily="JetBrains Mono Variable, monospace" letterSpacing="0.06em">
                  {text}
                </text>
              )
            })()}
          </g>
        )}
        {MONTH_SHORT.map((name, index) => (
          <text key={name} x={xOf(index)} y={TOP - 12} textAnchor="middle" fill={focus.slice(5, 7) === String(index + 1).padStart(2, '0') ? '#f3f4f7' : '#737a88'} fontSize="10.5" fontFamily="JetBrains Mono Variable, monospace">
            {narrow ? name.slice(0, 1) : name}
          </text>
        ))}

        {/* Focus column. */}
        {(() => {
          const index = Number(focus.slice(5, 7)) - 1
          return <rect x={xOf(index) - colW / 2 + 1} y={TOP - 4} width={colW - 2} height={height - TOP - 14} rx={8} fill="rgba(255,255,255,0.028)" />
        })()}

        {rows.map((row, i) => {
          const y0 = base(i)
          const { fill, solid, dashed, ghost } = ridge(row.points, y0, xOf, colW, lift)
          const missing = row.points.filter((p) => p.value === null)
          const active = row.year === focusedYear
          return (
            <g key={row.year} className="animate-fade-up motion-reduce:animate-none" style={{ animationDelay: `${i * 70}ms` }}>
              {fill.map((d, k) => (
                <g key={k}>
                  <path d={d} fill="#0f1218" />
                  <path d={d} fill={`url(#${uid}-fill-${i})`} />
                </g>
              ))}
              <line x1={LEFT} x2={width - RIGHT} y1={y0} y2={y0} stroke="rgba(255,255,255,0.07)" />
              {missing.map((p) => (
                <line key={p.month} x1={xOf(p.index) - colW / 2 + 4} x2={xOf(p.index) + colW / 2 - 4} y1={y0} y2={y0} stroke="#737a88" strokeDasharray="1 4" strokeLinecap="round" strokeWidth={1.5} />
              ))}
              {ghost.map((d, k) => <path key={k} d={d} fill="none" stroke="#f3f4f7" strokeOpacity={0.32} strokeWidth={1} strokeDasharray="3 3" />)}
              <path d={solid.join(' ')} fill="none" stroke={colours.stroke} strokeWidth={active ? 1.9 : 1.4} strokeLinejoin="round" />
              <path d={dashed.join(' ')} fill="none" stroke={colours.stroke} strokeWidth={active ? 1.9 : 1.4} strokeDasharray="4 3" strokeOpacity={0.85} />
              <text x={LEFT - 12} y={y0 - 3} textAnchor="end" fill={active ? '#f3f4f7' : '#737a88'} fontSize="11" fontWeight={active ? 600 : 400} fontFamily="JetBrains Mono Variable, monospace">
                {row.year}
              </text>
              {row.points.map((p) => {
                if (!p.mark || p.value === null) return null
                const cx = xOf(p.index)
                const cy = y0 - lift(p.value)
                if (p.mark === 'high' || p.mark === 'confirmed')
                  return (
                    <g key={p.month}>
                      <circle cx={cx} cy={cy} r={9} fill="#ff7c40" opacity={0.75} filter={`url(#${uid}-glow)`} />
                      <circle cx={cx} cy={cy} r={4.5} fill="#ffe4d2" stroke="#ff7c40" strokeWidth={1.5} />
                    </g>
                  )
                if (p.mark === 'low') return <circle key={p.month} cx={cx} cy={cy} r={4.5} fill="#0f1218" stroke="#60a5fa" strokeWidth={2} />
                if (p.mark === 'disputed') return <circle key={p.month} cx={cx} cy={cy} r={5} fill="#0f1218" stroke="#fbbf24" strokeWidth={1.75} strokeDasharray="2.5 2" />
                return <circle key={p.month} cx={cx} cy={cy} r={4.5} fill="#0f1218" stroke="#aab0bc" strokeWidth={1.5} />
              })}
            </g>
          )
        })}

        {/* Hovered and selected months. */}
        {[hover, focus].map((month, k) => {
          if (!month) return null
          const i = rows.findIndex((r) => r.year === month.slice(0, 4))
          const p = rows[i]?.points.find((q) => q.month === month)
          if (!p) return null
          const cy = base(i) - lift(p.value ?? 0)
          return <circle key={k} cx={xOf(p.index)} cy={cy} r={k ? 8 : 7} fill="none" stroke="#f3f4f7" strokeOpacity={k ? 0.95 : 0.45} strokeWidth={k ? 1.75 : 1.25} />
        })}
      </svg>

      {/* Pointer: a point belongs to the front-most ridge drawn over it, as the eye reads it. */}
      <div
        className="absolute inset-0"
        style={{ cursor: hover ? 'pointer' : 'default' }}
        aria-hidden="true"
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const month = pick(event.clientX - box.left, event.clientY - box.top)
          if (month !== hover) onHover(month)
        }}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const month = pick(event.clientX - box.left, event.clientY - box.top)
          if (month) {
            onFocus(month)
            cells.current.get(month)?.focus({ preventScroll: true })
          }
        }}
      />
      {/* Keyboard and assistive technology: one button per month, arrow keys across months and years. */}
      <div role="group" aria-label={`${mode === 'raw' ? 'Native detections from all satellites by month' : 'Aqua-equivalent active cell-days by month, with unusual months marked'}. One row per year. Use the arrow keys to move between months and years.`}>
        {rows.map((row, i) =>
          row.points.map((p) => (
            <button
              key={p.month}
              ref={(node) => {
                if (node) cells.current.set(p.month, node)
                else cells.current.delete(p.month)
              }}
              type="button"
              tabIndex={p.month === focus ? 0 : -1}
              aria-pressed={p.month === focus}
              aria-label={p.label}
              onClick={() => onFocus(p.month)}
              onFocus={() => onFocus(p.month)}
              onKeyDown={(event) => move(event, p.month)}
              className="pointer-events-none absolute m-0 block rounded-md border-0 bg-transparent p-0 focus-visible:outline-none"
              style={{ left: xOf(p.index) - colW / 2, top: base(i) - gap, width: colW, height: gap }}
            />
          )),
        )}
      </div>
    </div>
  )
}
