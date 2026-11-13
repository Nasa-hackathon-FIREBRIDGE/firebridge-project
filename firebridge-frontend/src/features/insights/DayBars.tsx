import { useState } from 'react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import { formatDay, type DayCell } from './computeInsights'

function describeDay(cell: DayCell) {
  if (cell.total === null) return `${formatDay(cell.date)} · inventory unknown`
  const parts = (Object.entries(cell.bySensor) as [SensorKey, number][]).filter(([, v]) => v > 0).map(([key, v]) => `${SENSORS[key].label} ${v}`)
  const missing = cell.missing.length ? ` · at least: no ${cell.missing.map((key) => SENSORS[key].label).join(' or ')} record that day` : ''
  return `${formatDay(cell.date)} · ${cell.missing.length ? '≥ ' : ''}${cell.total.toLocaleString('en-US')} detection${cell.total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(' · ')})` : ''}${missing}`
}

/** Short records (under three weeks): one bar per day. */
export function DayBars({ periods, onSelect }: { periods: DayCell[]; onSelect?: (cell: DayCell) => void }) {
  const [hover, setHover] = useState<DayCell | null>(null)
  const max = periods.reduce((m, cell) => Math.max(m, cell.total ?? 0), 1)
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Daily detections: ${periods.map(describeDay).join('; ')}`}>
        {periods.map((cell) => (
          <button
            key={cell.date}
            type="button"
            onClick={() => onSelect?.(cell)}
            onMouseEnter={() => setHover(cell)}
            onFocus={() => setHover(cell)}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 rounded-lg border-0 bg-transparent p-1 hover:bg-white/[0.03]"
            aria-label={describeDay(cell)}
          >
            <span className="w-full max-w-10 origin-bottom rounded-md bg-ember-gradient animate-grow-y" style={{ height: `${cell.total ? Math.max(4, (cell.total / max) * 100) : 2}%`, opacity: cell.total ? 1 : 0.25 }} />
            <span className="font-mono text-[10px] text-fg-3">{cell.date.slice(5)}</span>
          </button>
        ))}
      </div>
      <p className="mb-0 mt-3 min-h-5 text-[12.5px] text-fg-2">{hover ? describeDay(hover) : 'Point at a day for its satellite breakdown · click to show it on the map.'}</p>
    </div>
  )
}
