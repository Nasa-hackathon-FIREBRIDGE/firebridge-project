import { useId, useMemo, useState } from 'react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import { useElementWidth } from '../../hooks/useElementWidth'
import { formatDay, type DayCell } from './computeInsights'

/**
 * Ember horizon: every day of the record on one line, like a skyline at night. Each day with
 * fire rises as a spike of light (log scale) and is mirrored faintly below, as on water. The
 * busiest day carries its own label; pointing reads any day, clicking shows it on the map.
 */

const TOP = 40
const RISE = 150
const SINK = 46

function describe(cell: DayCell) {
  if (cell.total === null) return `${formatDay(cell.date)} · inventory unknown`
  const parts = (Object.entries(cell.bySensor) as [SensorKey, number][]).filter(([, v]) => v > 0).map(([key, v]) => `${SENSORS[key].label} ${v}`)
  return `${formatDay(cell.date)} · ${cell.missing.length ? 'at least ' : ''}${cell.total.toLocaleString('en-US')} detection${cell.total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(' · ')})` : ''}`
}

export function EmberHorizon({ periods, onSelect }: { periods: DayCell[]; onSelect?: (cell: DayCell) => void }) {
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useElementWidth<HTMLDivElement>(1100)
  const [hover, setHover] = useState<DayCell | null>(null)
  const max = useMemo(() => periods.reduce((m, c) => Math.max(m, c.total ?? 0), 1), [periods])
  const peak = useMemo(() => periods.reduce<DayCell | null>((best, c) => ((c.total ?? 0) > (best?.total ?? 0) ? c : best), null), [periods])
  const base = TOP + RISE
  const height = base + SINK + 30
  const n = periods.length
  const step = width / Math.max(1, n)
  const bar = Math.max(1, step * 0.72)
  // Linear: the towers are the big fire days; ordinary days stay close to the horizon.
  const level = (v: number) => v / max
  const x = (i: number) => (i + 0.5) * step
  const years = periods.flatMap((c, i) => (c.date.endsWith('-01-01') || i === 0 ? [{ i, year: c.date.slice(0, 4) }] : []))
  const peakIndex = peak ? periods.indexOf(peak) : -1
  const peakLabel = peak ? (width < 640 ? `Busiest day: ${peak.total?.toLocaleString('en-US')}` : `${formatDay(peak.date)}: the busiest day, ${peak.total?.toLocaleString('en-US')} detections`) : ''
  // Keep the label inside the figure: anchor it to the left of the spike when it would overflow.
  const labelLeft = peakIndex >= 0 && x(peakIndex) + 8 + peakLabel.length * 7.4 > width
  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg width={width} height={height} className="absolute inset-0 block" role="img" aria-label={`Every day of the record on one line${peak ? `; the busiest day was ${formatDay(peak.date)} with ${peak.total} detections` : ''}. The Timeline tab selects days with the keyboard.`}>
          <defs>
            <linearGradient id={`${uid}-spike`} gradientUnits="userSpaceOnUse" x1="0" y1={base - RISE} x2="0" y2={base}>
              <stop offset="0" stopColor="#fff1e6" />
              <stop offset="0.25" stopColor="#ffb547" />
              <stop offset="0.6" stopColor="#ff5f1f" />
              <stop offset="1" stopColor="#8f2d0f" />
            </linearGradient>
            <linearGradient id={`${uid}-water`} gradientUnits="userSpaceOnUse" x1="0" y1={base} x2="0" y2={base + SINK}>
              <stop offset="0" stopColor="#ff5f1f" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
            </linearGradient>
            <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
            <radialGradient id={`${uid}-haze`} cx="0.5" cy="1" r="0.6">
              <stop offset="0" stopColor="#ff5f1f" stopOpacity="0.16" />
              <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x={0} y={base - RISE} width={width} height={RISE} fill={`url(#${uid}-haze)`} />
          {years.map(({ i, year }) => (
            <g key={year}>
              <line x1={x(i) - step / 2} x2={x(i) - step / 2} y1={base - RISE - 8} y2={base + SINK} stroke="rgba(255,255,255,0.05)" />
              <text x={x(i) - step / 2 + 4} y={height - 6} fill="#737a88" fontSize="11" fontFamily="JetBrains Mono Variable, monospace">{year}</text>
            </g>
          ))}
          {/* Glow behind the strongest days. */}
          <g filter={`url(#${uid}-glow)`} opacity={0.75}>
            {periods.map((c, i) => (c.total && level(c.total) > 0.3 ? <rect key={c.date} x={x(i) - bar} y={base - RISE * level(c.total)} width={bar * 2} height={RISE * level(c.total)} fill="#ff7c40" /> : null))}
          </g>
          {periods.map((c, i) => {
            if (c.total === null) return <rect key={c.date} x={x(i) - bar / 2} y={base - 1} width={bar} height={2} fill="rgba(255,255,255,0.12)" />
            if (!c.total) return null
            const h = Math.max(1.5, RISE * level(c.total))
            return (
              <g key={c.date}>
                <rect x={x(i) - bar / 2} y={base - h} width={bar} height={h} fill={`url(#${uid}-spike)`} opacity={c.missing.length ? 0.6 : 1} />
                <rect x={x(i) - bar / 2} y={base + 1} width={bar} height={Math.min(SINK, h * 0.3)} fill={`url(#${uid}-water)`} />
              </g>
            )
          })}
          <line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} stroke="rgba(255,200,160,0.35)" />
          {peak && peakIndex >= 0 && (
            <g>
              <line x1={x(peakIndex)} x2={x(peakIndex)} y1={base - RISE - 2} y2={TOP - 14} stroke="#ffc5a3" strokeOpacity={0.6} />
              <circle cx={x(peakIndex)} cy={base - RISE * level(peak.total ?? 0)} r={3} fill="#fff5ee" />
              <text x={x(peakIndex) + (labelLeft ? -8 : 8)} y={TOP - 18} textAnchor={labelLeft ? 'end' : 'start'} fill="#f4ede3" fontSize="15" fontStyle="italic" fontFamily="Inter Variable, sans-serif">
                {peakLabel}
              </text>
            </g>
          )}
          {hover && (() => {
            const i = periods.indexOf(hover)
            return <line x1={x(i)} x2={x(i)} y1={TOP} y2={base + SINK} stroke="#f4ede3" strokeOpacity={0.5} strokeDasharray="2 3" />
          })()}
        </svg>
        <div
          className="absolute inset-0"
          style={{ cursor: hover?.total ? 'pointer' : 'default' }}
          aria-hidden="true"
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const cell = periods[Math.floor((event.clientX - box.left) / step)] ?? null
            if (cell !== hover) setHover(cell)
          }}
          onMouseLeave={() => setHover(null)}
          onClick={() => hover && onSelect?.(hover)}
        />
      </div>
      <p className="m-0 mt-2 min-h-5 text-[12.5px] text-fg-2" aria-live="polite">{hover ? describe(hover) : 'Point at the horizon to read a day · click to show it on the map.'}</p>
    </div>
  )
}
