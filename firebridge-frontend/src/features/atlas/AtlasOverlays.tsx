import { X, ZoomIn } from 'lucide-react'
import { createPortal } from 'react-dom'
import { SENSORS } from '../../lib/sensors'
import { AskWhy } from '../copilot/AskWhy'
import { ATLAS_SENSORS, DAY, fmtCoord, fmtDay, fmtSpan, sensorColorOf, sensorLabelOf } from './atlas'
import type { AtlasController } from './useAtlas'

const glass = 'border border-white/10 bg-ink-900/80 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.9)] backdrop-blur-md'
const clock = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const fmtMw = (value: number | null) => (value === null || Number.isNaN(value) ? 'not measured' : `${value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1)} MW`)


export function ReplayClock({ atlas }: { atlas: AtlasController }) {
  if (atlas.playhead === null) return null
  const day = Math.floor((atlas.playhead - 1) / DAY)
  return (
    <div className={`absolute left-3.5 top-[124px] z-[5] rounded-2xl px-4 py-3 font-sans ${glass}`} role="status" aria-live="off">
      <button type="button" aria-label="Leave the replay" onClick={atlas.stopReplay} className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full border-0 bg-transparent text-fg-3 hover:bg-white/10 hover:text-fg"><X size={13} /></button>
      <p className="m-0 pr-6 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ember-300">{atlas.playing ? 'Replaying' : 'Replay paused'}</p>
      <p className="m-0 mt-0.5 font-display text-[24px] font-semibold leading-tight tabular-nums text-fg">{fmtDay(day)}</p>
      <p className="m-0 mt-0.5 text-[12px] text-fg-2"><strong className="font-semibold tabular-nums text-fg">{atlas.glowing.toLocaleString('en-US')}</strong> detections in the last {Math.round(atlas.glowDays)} days</p>
    </div>
  )
}

export function AtlasLegend({ atlas }: { atlas: AtlasController }) {
  const replaying = atlas.playhead !== null
  return (
    <div className={`pointer-events-none absolute left-3.5 top-[64px] z-[4] rounded-xl px-3 py-2 font-sans ${glass}`} aria-hidden="true">
      {replaying ? (
        <div className="flex items-center gap-3">
          {[['#fff4d6', 'just now'], ['#ffc56b', 'recent'], ['#ff7c40', 'cooling'], ['#8f2d0f', `${Math.round(atlas.glowDays)} days ago`]].map(([color, text]) => (
            <span key={text} className="flex items-center gap-1.5 text-[11px] text-fg-2"><i className="size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />{text}</span>
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-3">
          {[[1, 7, '#ffd28a'], [20, 19, '#ff7c40'], [200, 32, '#d62d0a']].map(([n, size, color]) => (
            <span key={n} className="flex flex-col items-center gap-1">
              <i className="rounded-full border border-[rgb(255_245_238/0.85)]" style={{ width: size as number, height: size as number, background: color as string, boxShadow: `0 0 14px ${color}` }} />
              <span className="font-mono text-[10px] tabular-nums text-fg-2">{n}</span>
            </span>
          ))}
          <span className="max-w-[118px] pb-0.5 text-[11px] leading-snug text-fg-3 max-sm:hidden">detections in each circle, grouped as you zoom</span>
        </div>
      )}
    </div>
  )
}

export function AtlasTooltip({ atlas }: { atlas: AtlasController }) {
  const { hover, data } = atlas
  if (!hover || atlas.pick) return null
  const text = hover.kind === 'group'
    ? <><strong className="font-semibold text-fg">{hover.count.toLocaleString('en-US')}</strong> detections · click for details</>
    : <><i className="mr-1.5 inline-block size-2 rounded-full" style={{ background: sensorColorOf(data.sensor[hover.index]) }} />{sensorLabelOf(data.sensor[hover.index])} · {fmtDay(Math.floor(data.t[hover.index] / DAY))}</>
  return (
    <div className={`pointer-events-none absolute z-[6] whitespace-nowrap rounded-lg px-2.5 py-1.5 font-sans text-[12px] text-fg-2 ${glass}`} style={{ left: hover.x + 14, top: hover.y + 12 }}>
      {text}
    </div>
  )
}

function YearBars({ years }: { years: { year: number; count: number }[] }) {
  const max = Math.max(1, ...years.map((y) => y.count))
  return (
    <div className="mt-3">
      <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={years.map((y) => `${y.year}: ${y.count}`).join(', ')}>
        {years.map((y) => (
          <span key={y.year} className="min-w-0 flex-1 rounded-t-[2px]" title={`${y.year}: ${y.count.toLocaleString('en-US')}`}
            style={{ height: `${y.count ? Math.max(10, (y.count / max) * 100) : 4}%`, background: y.count ? 'linear-gradient(180deg, #ffd28a, #ff5f1f)' : 'rgb(255 255 255 / 0.08)' }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-fg-3"><span>{years[0].year}</span><span>{years[years.length - 1].year}</span></div>
    </div>
  )
}

/** What is under the circle, in plain language. Rendered into a MapLibre popup anchored to it. */
export function AtlasPopup({ atlas }: { atlas: AtlasController }) {
  const { pick, data, popupNode } = atlas
  if (!pick || !popupNode) return null
  const { summary } = pick
  let body
  if (pick.indices.length === 1) {
    const i = pick.indices[0]
    const s = data.sensor[i]
    const meta = SENSORS[ATLAS_SENSORS[s]]
    const day = Math.floor(data.t[i] / DAY)
    const night = /^n/i.test(data.dayNight[i] ?? '')
    body = (
      <>
        <p className="m-0 flex items-center gap-2 text-[12px] text-fg-2"><i className="size-2.5 rounded-full" style={{ background: meta.color }} />{meta.label} · {meta.instrument} · {meta.pixel} pixel</p>
        <p className="m-0 mt-1 text-[15px] font-semibold text-fg">{clock.format(data.t[i])} UTC</p>
        <p className="m-0 mt-2 text-[12.5px] leading-relaxed text-fg-2">
          A {night ? 'night-time' : 'daytime'} hot spot with a fire radiative power of <strong className="font-semibold text-fg">{fmtMw(data.frp[i])}</strong>, detection confidence {data.confidence[i] === 'unknown' ? 'not supplied' : data.confidence[i]}.
        </p>
        <p className="m-0 mt-1.5 font-mono text-[10.5px] text-fg-3">{fmtCoord(data.lon[i], data.lat[i])} · ID {data.ids[i]}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => atlas.showDay(day)} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[12px] text-fg hover:bg-white/10">Show all fires that day</button>
        </div>
      </>
    )
  } else {
    const sensors = summary.bySensor.map((n, s) => ({ n, s })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
    const firstDay = Math.floor(summary.first! / DAY)
    const lastDay = Math.floor(summary.last! / DAY)
    body = (
      <>
        <p className="m-0 text-[15px] font-semibold text-fg">{summary.count.toLocaleString('en-US')} detections</p>
        <p className="m-0 mt-0.5 text-[12.5px] text-fg-2">
          on {summary.fireDays.toLocaleString('en-US')} day{summary.fireDays === 1 ? '' : 's'} · {fmtSpan(firstDay, lastDay + 1)}
        </p>
        {summary.years.length > 1 && <YearBars years={summary.years} />}
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[12px] text-fg-2">
          {sensors.map(({ n, s }) => <li key={s} className="flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: sensorColorOf(s) }} />{sensorLabelOf(s)} <span className="tabular-nums text-fg">{n.toLocaleString('en-US')}</span></li>)}
        </ul>
        <p className="m-0 mt-2 text-[12px] text-fg-2">Strongest: <strong className="font-semibold text-fg">{fmtMw(summary.maxFrp)}</strong></p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {summary.bounds && (
            <button type="button" onClick={() => { atlas.focusOn(summary.bounds!, 13); atlas.closePick() }} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[12px] text-fg hover:bg-white/10"><ZoomIn size={13} />Zoom in</button>
          )}
          <AskWhy question={`What happened around ${fmtCoord(data.lon[pick.indices[0]], data.lat[pick.indices[0]])} between ${fmtDay(firstDay)} and ${fmtDay(lastDay)}?`} month={new Date(summary.last!).toISOString().slice(0, 7)} label="Ask the copilot" />
        </div>
      </>
    )
  }
  return createPortal(
    <div className="relative w-[268px] font-sans" onKeyDown={(event) => { if (event.key === 'Escape') atlas.closePick() }}>
      <button type="button" aria-label="Close" onClick={atlas.closePick} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border-0 bg-transparent text-fg-3 hover:bg-white/10 hover:text-fg"><X size={13} /></button>
      <div className="pr-5">{body}</div>
    </div>,
    popupNode,
  )
}

export function AtlasLoading({ loaded, total }: { loaded: number; total: number | null }) {
  const share = total ? Math.min(1, loaded / total) : null
  return (
    <div className={`pointer-events-none absolute left-1/2 top-3.5 z-[5] flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 font-sans text-[12px] text-fg-2 ${glass}`} role="status">
      <span className="relative size-2"><span className="absolute inset-0 animate-ping rounded-full bg-ember-400/70" /><span className="absolute inset-0 rounded-full bg-ember-400" /></span>
      Loading every detection · {loaded.toLocaleString('en-US')}{total ? ` of ${total.toLocaleString('en-US')}` : ''}
      {share !== null && <span className="h-1 w-16 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-ember-400" style={{ width: `${share * 100}%` }} /></span>}
    </div>
  )
}
