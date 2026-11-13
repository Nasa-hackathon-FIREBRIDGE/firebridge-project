import { useMemo, useState } from 'react'
import { SENSORS } from '../../lib/sensors'
import { useElementWidth } from '../../hooks/useElementWidth'
import { formatMonth, type MonthBucket, type SensorTotal } from './computeInsights'

/**
 * The fleet as a river: monthly detections stacked by satellite around a centre line
 * (a streamgraph). A satellite joining the record shows as a new stream entering, which is exactly the fleet effect a raw total cannot see.
 */

const H = 300
const PAD = 34

type XY = [number, number]
function curve(points: XY[]) {
  let d = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i === 0) {
      d += `M${p[0].toFixed(1)},${p[1].toFixed(1)}`
      continue
    }
    const p0 = points[Math.max(0, i - 2)]
    const p1 = points[i - 1]
    const p3 = points[Math.min(points.length - 1, i + 1)]
    const c1: XY = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6]
    const c2: XY = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`
  }
  return d
}

export function FleetStreams({ months, sensors }: { months: MonthBucket[]; sensors: SensorTotal[] }) {
  const { ref, width } = useElementWidth<HTMLDivElement>(1100)
  const [hover, setHover] = useState<number | null>(null)
  const keys = sensors.map((s) => s.key)
  const geometry = useMemo(() => {
    const max = Math.max(1, ...months.map((m) => m.total))
    const scale = (H - 2 * PAD) / max
    const step = width / Math.max(1, months.length - 1)
    const x = (i: number) => (months.length === 1 ? width / 2 : i * step)
    const streams = keys.map(() => ({ top: [] as XY[], bottom: [] as XY[] }))
    months.forEach((m, i) => {
      let y = H / 2 - (m.total * scale) / 2
      keys.forEach((key, k) => {
        const v = (m.bySensor[key] ?? 0) * scale
        streams[k].top.push([x(i), y])
        y += v
        streams[k].bottom.push([x(i), y])
      })
    })
    // A satellite joining after the start: the first month it appears.
    const joins = keys.flatMap((key) => {
      const first = months.findIndex((m) => (m.bySensor[key] ?? 0) > 0)
      return first > 2 ? [{ key, i: first }] : []
    })
    return { streams, joins, x, step }
  }, [months, keys, width])
  const total = sensors.reduce((sum, s) => sum + (s.count ?? 0), 0)
  const years = months.flatMap((m, i) => (m.month.endsWith('-01') || i === 0 ? [{ i, year: m.month.slice(0, 4) }] : []))
  const hovered = hover !== null ? months[hover] : null
  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: H + 26 }}>
        <svg width={width} height={H + 26} className="absolute inset-0 block" role="img" aria-label={`Monthly detections by satellite, stacked: ${sensors.map((s) => `${s.label} ${s.count ?? 'unknown'}`).join(', ')}`}>
          {years.map(({ i, year }) => (
            <g key={year}>
              <line x1={geometry.x(i)} x2={geometry.x(i)} y1={8} y2={H} stroke="rgba(255,255,255,0.045)" />
              <text x={geometry.x(i) + 4} y={H + 20} fill="#737a88" fontSize="11" fontFamily="JetBrains Mono Variable, monospace">{year}</text>
            </g>
          ))}
          {geometry.streams.map((stream, k) => (
            <path key={keys[k]} d={`${curve(stream.top)} L${curve([...stream.bottom].reverse()).slice(1)} Z`} fill={SENSORS[keys[k]].color} fillOpacity={hover === null ? 0.82 : 0.6} stroke="#06070b" strokeWidth={0.6} />
          ))}
          {geometry.joins.map((j) => {
            const k = keys.indexOf(j.key)
            const top = geometry.streams[k].top[j.i][1]
            const px = geometry.x(j.i)
            return (
              <g key={j.key}>
                <line x1={px} x2={px} y1={Math.min(top, H / 2) - 4} y2={14} stroke={SENSORS[j.key].color} strokeOpacity={0.7} strokeDasharray="2 3" />
                <text x={px + 6} y={18} fill="#f4ede3" fontSize="13.5" fontStyle="italic" fontFamily="Inter Variable, sans-serif">
                  {SENSORS[j.key].label} joins · {formatMonth(months[j.i].month, 'short')}
                </text>
              </g>
            )
          })}
          {hover !== null && <line x1={geometry.x(hover)} x2={geometry.x(hover)} y1={8} y2={H} stroke="#f4ede3" strokeOpacity={0.6} />}
        </svg>
        <div
          className="absolute inset-0"
          aria-hidden="true"
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const i = Math.round((event.clientX - box.left) / geometry.step)
            setHover(i >= 0 && i < months.length ? i : null)
          }}
          onMouseLeave={() => setHover(null)}
        />
      </div>
      <p className="m-0 mt-2 min-h-5 text-[12.5px] text-fg-2" aria-live="polite">
        {hovered
          ? `${formatMonth(hovered.month)} · ${hovered.total.toLocaleString('en-US')} detections · ${keys.filter((k) => hovered.bySensor[k]).map((k) => `${SENSORS[k].label} ${hovered.bySensor[k]}`).join(' · ')}`
          : 'Point at the river to read a month.'}
      </p>
      <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-6 gap-y-2 p-0" aria-label="Satellites">
        {sensors.map((s) => (
          <li key={s.key} className="flex items-baseline gap-2 text-[12.5px] text-fg-2">
            <span className="size-2.5 translate-y-[1px] rounded-full" style={{ background: s.color }} aria-hidden="true" />
            <span className="text-fg">{s.label}</span>
            <span className="font-mono text-[11px] text-fg-3">{s.instrument} · {s.pixel}</span>
            <span className="font-serif text-[15px] text-paper tabular-nums" style={{ fontVariationSettings: '"opsz" 24' }}>{s.count === null ? '—' : `${Math.round((s.count / Math.max(1, total)) * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

