import { useMemo, useState } from 'react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import { formatDay, type DayCell } from './computeInsights'

const LEVELS = ['#3a1709', '#6e2610', '#b5380d', '#ff6a26', '#ffb547']
const EMPTY = '#161920'
const STEP = 15
const SIZE = 12

function level(value: number, max: number) {
  if (value <= 0) return -1
  return Math.min(LEVELS.length - 1, Math.floor((Math.log1p(value) / Math.log1p(max)) * LEVELS.length - 1e-9))
}

function describe(cell: DayCell) {
  if (cell.total === null) return `${formatDay(cell.date)} · inventory unknown`
  const parts = (Object.entries(cell.bySensor) as [SensorKey, number][]).filter(([, v]) => v > 0).map(([key, v]) => `${SENSORS[key].label} ${v}`)
  return `${formatDay(cell.date)} · ${cell.total.toLocaleString('en-US')} detection${cell.total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(' · ')})` : ''}`
}

export function ActivityHeatmap({ periods, onSelect }: { periods: DayCell[]; onSelect?: (cell: DayCell) => void }) {
  const [hover, setHover] = useState<DayCell | null>(null)
  const max = useMemo(() => periods.reduce((m, cell) => Math.max(m, cell.total ?? 0), 1), [periods])
  const years = useMemo(() => {
    const groups = new Map<string, DayCell[]>()
    for (const cell of periods) groups.set(cell.date.slice(0, 4), [...(groups.get(cell.date.slice(0, 4)) ?? []), cell])
    return [...groups.entries()]
  }, [periods])

  if (periods.length < 21) {
    return (
      <div>
        <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Daily detections: ${periods.map(describe).join('; ')}`}>
          {periods.map((cell) => (
            <button
              key={cell.date}
              type="button"
              onClick={() => onSelect?.(cell)}
              onMouseEnter={() => setHover(cell)}
              onFocus={() => setHover(cell)}
              className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 rounded-lg p-1 hover:bg-white/[0.03]"
              aria-label={describe(cell)}
            >
              <span className="w-full max-w-10 origin-bottom rounded-md bg-ember-gradient animate-grow-y" style={{ height: `${cell.total ? Math.max(4, (cell.total / max) * 100) : 2}%`, opacity: cell.total ? 1 : 0.25 }} />
              <span className="font-mono text-[10px] text-fg-3">{cell.date.slice(5)}</span>
            </button>
          ))}
        </div>
        <p className="mb-0 mt-3 min-h-5 text-[12.5px] text-fg-2">{hover ? describe(hover) : 'Hover a day for its satellite breakdown · click to show it on the map.'}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-5 overflow-x-auto pb-1">
        {years.map(([year, cells]) => {
          const first = new Date(`${cells[0].date}T00:00:00Z`)
          const offset = (first.getUTCDay() + 6) % 7 // Monday-first
          const weeks = Math.ceil((cells.length + offset) / 7)
          const width = 30 + weeks * STEP
          const height = 18 + 7 * STEP
          const monthLabels: { x: number; label: string }[] = []
          cells.forEach((cell, index) => {
            if (cell.date.endsWith('-01') || index === 0) {
              const week = Math.floor((index + offset) / 7)
              monthLabels.push({ x: 30 + week * STEP, label: new Date(`${cell.date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) })
            }
          })
          return (
            <div key={year} className="min-w-0">
              {years.length > 1 && <p className="mb-1.5 mt-0 font-mono text-[11px] text-fg-3">{year}</p>}
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="block h-auto w-full min-w-[640px]"
                role="img"
                aria-label={`Daily detection calendar for ${year}. Use the Timeline tab for keyboard selection.`}
                onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <pattern id={`unknown-${year}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="4" height="4" fill={EMPTY} />
                    <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
                  </pattern>
                </defs>
                {monthLabels.map((month, index) => (
                  <text key={index} x={month.x} y={10} fill="#737a88" fontSize="9.5" fontFamily="JetBrains Mono Variable, monospace">{month.label}</text>
                ))}
                {['Mon', 'Wed', 'Fri'].map((day, index) => (
                  <text key={day} x={0} y={18 + (index * 2) * STEP + 10} fill="#5b6270" fontSize="9" fontFamily="JetBrains Mono Variable, monospace">{day}</text>
                ))}
                {cells.map((cell, index) => {
                  const position = index + offset
                  const x = 30 + Math.floor(position / 7) * STEP
                  const y = 18 + (position % 7) * STEP
                  const l = cell.total === null ? -2 : level(cell.total, max)
                  const active = hover?.date === cell.date
                  return (
                    <rect
                      key={cell.date}
                      x={x}
                      y={y}
                      width={SIZE}
                      height={SIZE}
                      rx={3}
                      fill={l === -2 ? `url(#unknown-${year})` : l === -1 ? EMPTY : LEVELS[l]}
                      stroke={active ? '#fff5ee' : l >= 3 ? 'rgba(255,200,150,0.25)' : 'rgba(255,255,255,0.03)'}
                      strokeWidth={active ? 1.5 : 1}
                      className="cursor-pointer transition-[stroke] duration-100"
                      onMouseEnter={() => setHover(cell)}
                      onClick={() => onSelect?.(cell)}
                    >
                      <title>{describe(cell)}</title>
                    </rect>
                  )
                })}
              </svg>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 min-h-5 text-[12.5px] text-fg-2" aria-live="polite">{hover ? describe(hover) : 'Hover a day for its satellite breakdown · click to show it on the map.'}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-fg-3" aria-hidden="true">
          None
          <span className="size-2.5 rounded-[3px]" style={{ background: EMPTY }} />
          {LEVELS.map((color) => <span key={color} className="size-2.5 rounded-[3px]" style={{ background: color }} />)}
          More
        </div>
      </div>
    </div>
  )
}
