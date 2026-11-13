import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { DAY, fmtDay, fmtSpan, type AtlasData } from './atlas'

const HEIGHT = 44
const MIN_BAR = 3

function binDays(data: AtlasData, sensors: readonly number[], width: number) {
  const days = data.endDay - data.firstDay
  const count = Math.max(1, Math.min(days, Math.floor(width / MIN_BAR)))
  const edges = Array.from({ length: count + 1 }, (_, k) => Math.round((k * days) / count))
  const totals: number[] = []
  let max = 0
  for (let k = 0; k < count; k++) {
    let total = 0
    for (const s of sensors) for (let d = edges[k]; d < edges[k + 1]; d++) total += data.daily[s][d]
    totals.push(total)
    max = Math.max(max, total)
  }
  return { edges, totals, max }
}

function ticks(first: number, end: number) {
  const out: { day: number; label: string }[] = []
  const span = end - first
  const yearly = span > 540
  const a = new Date(first * DAY)
  const cursor = new Date(Date.UTC(a.getUTCFullYear(), yearly ? 0 : a.getUTCMonth(), 1))
  while (cursor.getTime() < end * DAY) {
    const day = Math.round(cursor.getTime() / DAY)
    if (day > first) out.push({ day, label: yearly || cursor.getUTCMonth() === 0 ? String(cursor.getUTCFullYear()) : cursor.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) })
    if (yearly) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1)
    else cursor.setUTCMonth(cursor.getUTCMonth() + (span > 200 ? 3 : 1))
  }
  return out
}

type Drag = { mode: 'move' | 'start' | 'end' | 'new'; originDay: number; start: number; end: number; moved: boolean }

/** Fire activity over the whole record. Drag across it to choose a period; drag the period to move it. */
export function AtlasTimeline({ data, sensors, window, onWindow, playhead }: {
  data: AtlasData
  sensors: readonly number[]
  window: { start: number; end: number }
  onWindow: (start: number, end: number, commit?: boolean) => void
  playhead: number | null
}) {
  const track = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; bin: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<Drag | null>(null)
  const days = data.endDay - data.firstDay
  const whole = window.start === data.firstDay && window.end === data.endDay

  useEffect(() => {
    const element = track.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bins = useMemo(() => binDays(data, sensors, width || 600), [data, sensors, width])
  const xOf = (day: number) => ((day - data.firstDay) / days) * width
  const dayAt = (x: number) => data.firstDay + Math.round((Math.max(0, Math.min(width, x)) / Math.max(1, width)) * days)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext?.('2d')
    if (!element || !context || !width) return
    const ratio = globalThis.devicePixelRatio || 1
    element.width = Math.round(width * ratio)
    element.height = HEIGHT * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, HEIGHT)
    const count = bins.totals.length
    const slot = width / count
    const bar = Math.max(1, slot - (slot >= 3 ? 1 : 0))
    // Square-root heights keep quiet seasons visible next to the largest outbreaks.
    const scale = bins.max ? (HEIGHT - 2) / Math.sqrt(bins.max) : 0
    const gradient = context.createLinearGradient(0, HEIGHT, 0, 0)
    gradient.addColorStop(0, '#bd390d')
    gradient.addColorStop(0.55, '#ff7c40')
    gradient.addColorStop(1, '#ffd28a')
    for (let k = 0; k < count; k++) {
      const total = bins.totals[k]
      if (!total) continue
      const inside = whole || (bins.edges[k + 1] > window.start - data.firstDay && bins.edges[k] < window.end - data.firstDay)
      const height = Math.max(1.5, Math.sqrt(total) * scale)
      context.globalAlpha = inside ? 1 : 0.22
      context.fillStyle = gradient
      context.fillRect(k * slot, HEIGHT - height, bar, height)
    }
    context.globalAlpha = 1
  }, [bins, width, window, data, whole])

  const begin = (mode: Drag['mode']) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !track.current) return
    event.stopPropagation()
    const x = event.clientX - track.current.getBoundingClientRect().left
    drag.current = { mode, originDay: dayAt(x), start: window.start, end: window.end, moved: false }
    setDragging(true)
    setHover(null)
    track.current.setPointerCapture?.(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!track.current) return
    const x = event.clientX - track.current.getBoundingClientRect().left
    const current = drag.current
    if (!current) {
      setHover({ x, bin: Math.min(bins.totals.length - 1, Math.max(0, Math.floor((x / Math.max(1, width)) * bins.totals.length))) })
      return
    }
    const day = dayAt(x)
    const delta = day - current.originDay
    if (delta) current.moved = true
    if (!current.moved) return
    if (current.mode === 'move') {
      const size = current.end - current.start
      const start = Math.min(data.endDay - size, Math.max(data.firstDay, current.start + delta))
      onWindow(start, start + size)
    } else if (current.mode === 'start') onWindow(Math.min(day, current.end - 1), current.end)
    else if (current.mode === 'end') onWindow(current.start, Math.max(day, current.start + 1))
    else onWindow(Math.min(day, current.originDay), Math.max(day, current.originDay) + 1)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    drag.current = null
    setDragging(false)
    track.current?.releasePointerCapture?.(event.pointerId)
    if (!current) return
    if (!current.moved && current.mode === 'new') {
      // A click picks the month under the pointer: the most natural unit to read a fire season.
      const d = new Date(current.originDay * DAY)
      const start = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY)
      const stop = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY)
      onWindow(Math.max(data.firstDay, start), Math.min(data.endDay, stop), true)
      return
    }
    onWindow(window.start, window.end, true)
  }

  const key = (edge: 'start' | 'end' | 'move') => (event: KeyboardEvent<HTMLElement>) => {
    const size = window.end - window.start
    const step = event.shiftKey ? 7 : event.key === 'PageUp' || event.key === 'PageDown' ? 30 : 1
    const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown' ? -1 : 0
    if (!sign) return
    event.preventDefault()
    const by = sign * (edge === 'move' && event.shiftKey ? size : step)
    if (edge === 'start') onWindow(Math.min(window.end - 1, window.start + by), window.end, true)
    else if (edge === 'end') onWindow(window.start, Math.max(window.start + 1, window.end + by), true)
    else {
      const start = Math.min(data.endDay - size, Math.max(data.firstDay, window.start + by))
      onWindow(start, start + size, true)
    }
  }

  const left = width ? xOf(window.start) : 0
  const right = width ? xOf(window.end) : 0
  const brushWidth = Math.max(6, right - left)
  const hovered = hover && !dragging ? hover : null
  const hoverSpan = hovered ? [data.firstDay + bins.edges[hovered.bin], data.firstDay + bins.edges[hovered.bin + 1]] : null
  const axis = useMemo(() => {
    const all = ticks(data.firstDay, data.endDay)
    // Keep labels at least ~40 px apart on narrow screens.
    const every = width && all.length > 1 ? Math.max(1, Math.ceil(40 / ((width * (all[1].day - all[0].day)) / days))) : 1
    return all.filter((_, k) => k % every === 0)
  }, [data, width, days])
  const playX = playhead !== null && width ? ((playhead / DAY - data.firstDay) / days) * width : null

  return (
    <div className="min-w-0 flex-1 select-none font-sans">
      <div
        ref={track}
        className="relative cursor-crosshair touch-none"
        style={{ height: HEIGHT }}
        onPointerDown={begin('new')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" role="img" aria-label={`Fire activity from ${fmtDay(data.firstDay)} to ${fmtDay(data.endDay - 1)} (bar height on a square-root scale). Selected: ${fmtSpan(window.start, window.end)}.`} />
        {width > 0 && (
          <div
            role="slider"
            tabIndex={0}
            aria-label="Selected period"
            aria-valuemin={data.firstDay}
            aria-valuemax={data.endDay}
            aria-valuenow={window.start}
            aria-valuetext={fmtSpan(window.start, window.end)}
            onPointerDown={whole ? undefined : begin('move')}
            onKeyDown={key('move')}
            className={`absolute -inset-y-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ember-300/70 ${whole ? 'pointer-events-none' : 'cursor-grab border border-ember-300/70 bg-ember-400/[0.08] shadow-[0_0_24px_-6px_rgb(255_124_64/0.7)] active:cursor-grabbing'}`}
            style={{ left: Math.min(left, width - brushWidth), width: brushWidth }}
          >
            {!whole && (['start', 'end'] as const).map((edge) => (
              <span
                key={edge}
                role="slider"
                tabIndex={0}
                aria-label={edge === 'start' ? 'Period start' : 'Period end'}
                aria-valuemin={data.firstDay}
                aria-valuemax={data.endDay}
                aria-valuenow={edge === 'start' ? window.start : window.end}
                aria-valuetext={fmtDay(edge === 'start' ? window.start : window.end - 1)}
                onPointerDown={begin(edge)}
                onKeyDown={key(edge)}
                className={`pointer-events-auto absolute top-1/2 h-4 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-ember-200 outline-none focus-visible:ring-2 focus-visible:ring-white ${edge === 'start' ? '-left-[4px]' : '-right-[4px]'}`}
              />
            ))}
          </div>
        )}
        {playX !== null && (
          <span className="pointer-events-none absolute -inset-y-1.5 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_2px_rgb(255_210_138/0.9)]" style={{ left: playX }} aria-hidden="true" />
        )}
        {hovered && hoverSpan && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900/95 px-2.5 py-1.5 text-[11.5px] text-fg shadow-lg"
            style={{ left: Math.min(width - 80, Math.max(80, hovered.x)) }}
          >
            <span className="text-fg-2">{fmtSpan(hoverSpan[0], hoverSpan[1])}</span>
            <strong className="ml-2 font-medium tabular-nums">{bins.totals[hovered.bin].toLocaleString('en-US')}</strong>
            <span className="text-fg-3"> detections · click for the month</span>
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-3.5 font-mono text-[10px] text-fg-3" aria-hidden="true">
        {width > 0 && axis.map((tick) => (
          <span key={tick.day} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: xOf(tick.day) }}>{tick.label}</span>
        ))}
      </div>
    </div>
  )
}
