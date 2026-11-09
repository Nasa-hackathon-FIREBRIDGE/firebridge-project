import { useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { SENSORS } from '../../lib/sensors'

/** Illustrative scene, 3 km × 3 km. Fires are ellipses in km. */
const EXTENT = 3
const FIRES = [
  { x: 1.32, y: 1.55, rx: 0.36, ry: 0.24, rotate: -25 },
  { x: 2.22, y: 0.78, rx: 0.14, ry: 0.1, rotate: 10 },
  { x: 0.62, y: 2.38, rx: 0.08, ry: 0.07, rotate: 0 },
]

function inFire(px: number, py: number) {
  return FIRES.some((fire) => {
    const angle = (fire.rotate * Math.PI) / 180
    const dx = px - fire.x
    const dy = py - fire.y
    const u = dx * Math.cos(angle) + dy * Math.sin(angle)
    const v = -dx * Math.sin(angle) + dy * Math.cos(angle)
    return (u * u) / (fire.rx * fire.rx) + (v * v) / (fire.ry * fire.ry) <= 1
  })
}

/** Fraction of each cell covered by fire, sampled on a fine grid. */
function coverage(cells: number) {
  const size = EXTENT / cells
  const samples = 24
  const out: number[] = []
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      let hits = 0
      for (let i = 0; i < samples; i++) {
        for (let j = 0; j < samples; j++) {
          if (inFire(col * size + ((i + 0.5) / samples) * size, row * size + ((j + 0.5) / samples) * size)) hits++
        }
      }
      out.push(hits / (samples * samples))
    }
  }
  return out
}

function Scene({ cells, threshold, color, label, pixel }: { cells: number; threshold: number; color: string; label: string; pixel: string }) {
  const reduced = useReducedMotion()
  const fractions = useMemo(() => coverage(cells), [cells])
  const detected = fractions.filter((value) => value >= threshold).length
  const cell = 240 / cells
  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900">
        <svg viewBox="0 0 240 240" className="block h-auto w-full" aria-hidden="true">
          <defs>
            <radialGradient id={`burn-${cells}`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffd28a" />
              <stop offset="0.5" stopColor="#ff7c40" />
              <stop offset="1" stopColor="#bd390d" stopOpacity="0.4" />
            </radialGradient>
            <pattern id={`terrain-${cells}`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
              <line x1="0" y1="0" x2="0" y2="12" stroke="rgba(255,255,255,0.025)" strokeWidth="5" />
            </pattern>
          </defs>
          <rect width="240" height="240" fill="#0d1117" />
          <rect width="240" height="240" fill={`url(#terrain-${cells})`} />
          {FIRES.map((fire, index) => (
            <ellipse
              key={index}
              cx={(fire.x / EXTENT) * 240}
              cy={(fire.y / EXTENT) * 240}
              rx={(fire.rx / EXTENT) * 240}
              ry={(fire.ry / EXTENT) * 240}
              transform={`rotate(${fire.rotate} ${(fire.x / EXTENT) * 240} ${(fire.y / EXTENT) * 240})`}
              fill={`url(#burn-${cells})`}
            />
          ))}
          {fractions.map((fraction, index) => {
            const col = index % cells
            const row = Math.floor(index / cells)
            const hit = fraction >= threshold
            return (
              <motion.rect
                key={index}
                x={col * cell + 1}
                y={row * cell + 1}
                width={cell - 2}
                height={cell - 2}
                rx={cells > 4 ? 2 : 5}
                fill={hit ? color : 'transparent'}
                stroke={hit ? color : 'rgba(255,255,255,0.09)'}
                strokeWidth={hit ? 1.5 : 1}
                initial={hit && !reduced ? { fillOpacity: 0, strokeOpacity: 0.2 } : false}
                whileInView={hit ? { fillOpacity: 0.28, strokeOpacity: 1 } : undefined}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.5 + (col / cells) * 1.4 }}
                style={hit && reduced ? { fillOpacity: 0.28 } : undefined}
              />
            )
          })}
          {!reduced && (
            <motion.rect
              y="0"
              width="3"
              height="240"
              fill={color}
              initial={{ x: -4, opacity: 0 }}
              whileInView={{ x: 244, opacity: [0, 1, 1, 0] }}
              viewport={{ once: true }}
              transition={{ duration: 1.9, delay: 0.4, ease: 'linear' }}
              style={{ filter: `drop-shadow(0 0 6px ${color})` }}
            />
          )}
        </svg>
        <span className="absolute left-3 top-3 rounded-full border border-white/10 bg-ink-950/80 px-2.5 py-1 font-mono text-[10.5px] text-fg-2 backdrop-blur">
          {pixel} pixels
        </span>
      </div>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-fg-2">{label}</span>
        <span className="font-display text-2xl font-semibold tabular-nums" style={{ color }}>
          {detected} <span className="text-[13px] font-medium text-fg-3">detections</span>
        </span>
      </figcaption>
    </figure>
  )
}

export function PixelComparison() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Scene cells={3} threshold={0.03} color={SENSORS.aqua.color} label="MODIS · Aqua" pixel="1 km" />
      <Scene cells={8} threshold={0.12} color={SENSORS.noaa20.color} label="VIIRS · NOAA-20" pixel="375 m" />
    </div>
  )
}
