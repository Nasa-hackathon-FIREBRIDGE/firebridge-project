import { useId } from 'react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import { useElementWidth } from '../../hooks/useElementWidth'
import type { OverpassRow } from '../bridge/engine/index.ts'

/**
 * The 24-hour sky. Noon at the top, midnight at the bottom; one orbit ring per satellite. Dots are
 * the measured median overpass of each year (local solar time, from the archive's own timestamps),
 * so a satellite that drifts draws an arc. The ember band on the rim is when fires burn hardest.
 */

const RINGS: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21']
const PEAK: [number, number] = [13, 18.5]

const angle = (hours: number) => ((hours - 12) / 24) * 2 * Math.PI - Math.PI / 2
const clock = (hours: number) => {
  const total = Math.round((((hours % 24) + 24) % 24) * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const a = angle(from)
  const b = angle(to)
  const large = Math.abs(to - from) > 12 ? 1 : 0
  const sweep = to > from ? 1 : 0
  return `M${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} A${r},${r} 0 ${large} ${sweep} ${cx + r * Math.cos(b)},${cy + r * Math.sin(b)}`
}

export function SkyClock({ rows }: { rows: readonly OverpassRow[] }) {
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useElementWidth<HTMLDivElement>(560)
  const size = Math.min(width, 620)
  const R = size / 2 - 62
  const cx = size / 2
  const cy = size / 2
  const present = RINGS.filter((s) => rows.some((r) => r.sensor === s && r.n >= 5))
  const ringOf = (sensor: SensorKey) => R * (0.4 + 0.11 * present.indexOf(sensor))
  const pos = (r: number, hours: number) => [cx + r * Math.cos(angle(hours)), cy + r * Math.sin(angle(hours))] as const
  return (
    <div ref={ref} className="flex w-full flex-col items-center gap-4">
      <svg width={size} height={size} role="img" aria-label={`Measured overpass times by satellite and year: ${present.map((s) => `${SENSORS[s].label} ${rows.filter((r) => r.sensor === s && r.pass === 'day' && r.n >= 5).map((r) => `${r.year} ${clock(r.median)}`).join(', ')}`).join('; ')}. Fires burn hardest between 13:00 and 18:30.`}>
        <defs>
          <radialGradient id={`${uid}-day`} cx="0.5" cy="0.15" r="0.75">
            <stop offset="0" stopColor="#ffb547" stopOpacity="0.14" />
            <stop offset="0.6" stopColor="#ff7c40" stopOpacity="0.04" />
            <stop offset="1" stopColor="#06070b" stopOpacity="0" />
          </radialGradient>
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <circle cx={cx} cy={cy} r={R + 18} fill={`url(#${uid}-day)`} />
        <path d={`M${cx - R - 18},${cy} A${R + 18},${R + 18} 0 0 0 ${cx + R + 18},${cy}`} fill="rgba(0,0,0,0.35)" transform={`rotate(0 ${cx} ${cy})`} />
        {/* Hours. */}
        {Array.from({ length: 24 }, (_, h) => {
          const [x1, y1] = pos(R + 10, h)
          const [x2, y2] = pos(R + (h % 6 === 0 ? 20 : 15), h)
          return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.25)" strokeWidth={h % 6 === 0 ? 1.4 : 0.8} />
        })}
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = pos(R + 40, h)
          return <text key={h} x={x} y={y + 4} textAnchor="middle" fill="#aab0bc" fontSize="12" fontFamily="JetBrains Mono Variable, monospace">{clock(h)}</text>
        })}
        <text x={cx} y={cy - R * 0.2} textAnchor="middle" fill="#737a88" fontSize="10" fontFamily="JetBrains Mono Variable, monospace" letterSpacing="0.2em">DAY</text>
        <text x={cx} y={cy + R * 0.26} textAnchor="middle" fill="#5b6270" fontSize="10" fontFamily="JetBrains Mono Variable, monospace" letterSpacing="0.2em">NIGHT</text>
        {/* When fires burn hardest (Giglio 2007). */}
        <path d={arc(cx, cy, R + 4, PEAK[0], PEAK[1])} stroke="#ff7c40" strokeWidth={14} fill="none" opacity={0.35} filter={`url(#${uid}-glow)`} />
        <path d={arc(cx, cy, R + 4, PEAK[0], PEAK[1])} stroke="#ff7c40" strokeWidth={4} strokeLinecap="round" fill="none" />
        {(() => {
          const [x, y] = pos(R - 16, 15.9)
          return (
            <text x={x} y={y} textAnchor="end" fill="#ffc5a3" fontSize="12.5" fontFamily="Inter Variable, sans-serif" fontStyle="italic">
              <tspan x={x}>peak burning</tspan>
              <tspan x={x} dy="15">13:00–18:30</tspan>
            </text>
          )
        })()}
        {/* One orbit ring per satellite. */}
        {present.map((sensor) => {
          const r = ringOf(sensor)
          const color = SENSORS[sensor].color
          const days = rows.filter((row) => row.sensor === sensor && row.pass === 'day' && row.n >= 5).sort((a, b) => a.year.localeCompare(b.year))
          const nights = rows.filter((row) => row.sensor === sensor && row.pass === 'night' && row.n >= 5)
          const first = days[0]
          const last = days[days.length - 1]
          const drift = first && last ? ((last.median - first.median + 36) % 24) - 12 : 0
          return (
            <g key={sensor}>
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeOpacity={0.12} />
              {first && last && Math.abs(drift) * 60 >= 20 && (
                <>
                  <path d={arc(cx, cy, r, Math.min(first.median, first.median + drift), Math.max(first.median, first.median + drift))} stroke={color} strokeWidth={8} fill="none" opacity={0.3} filter={`url(#${uid}-glow)`} />
                  <path d={arc(cx, cy, r, Math.min(first.median, first.median + drift), Math.max(first.median, first.median + drift))} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" />
                </>
              )}
              {days.map((row) => {
                const [x, y] = pos(r, row.median)
                return <circle key={row.year} cx={x} cy={y} r={row === last ? 5 : 3} fill={color} stroke="#06070b" strokeWidth={1}><title>{`${SENSORS[sensor].label} ${row.year}: ${clock(row.median)} (${row.n} detections)`}</title></circle>
              })}
              {nights.map((row) => {
                const [x, y] = pos(r, row.median)
                return <circle key={`n${row.year}`} cx={x} cy={y} r={2.5} fill="#06070b" stroke={color} strokeWidth={1.2}><title>{`${SENSORS[sensor].label} night ${row.year}: ${clock(row.median)}`}</title></circle>
              })}
            </g>
          )
        })}
        <circle cx={cx} cy={cy} r={3} fill="#f4ede3" />
      </svg>
      <ul className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 p-0" aria-label="Measured daytime overpass, first and last year">
        {present.map((sensor) => {
          const days = rows.filter((row) => row.sensor === sensor && row.pass === 'day' && row.n >= 5).sort((a, b) => a.year.localeCompare(b.year))
          const first = days[0]
          const last = days[days.length - 1]
          const shift = first && last ? Math.round(((((last.median - first.median + 36) % 24) - 12) * 60)) : 0
          return (
            <li key={sensor} className="flex items-baseline gap-2 text-[12.5px] text-fg-2">
              <span className="size-2.5 translate-y-[1px] rounded-full" style={{ background: SENSORS[sensor].color }} aria-hidden="true" />
              <span className="text-fg">{SENSORS[sensor].label}</span>
              <span className="font-mono text-[11.5px] tabular-nums">{first && last && first !== last ? `${clock(first.median)} → ${clock(last.median)}` : last ? clock(last.median) : '—'}</span>
              {Math.abs(shift) >= 20 && <span className={`text-[11.5px] font-medium ${shift > 0 ? 'text-ember-300' : 'text-info'}`}>{shift > 0 ? '+' : '−'}{Math.abs(shift)} min</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
