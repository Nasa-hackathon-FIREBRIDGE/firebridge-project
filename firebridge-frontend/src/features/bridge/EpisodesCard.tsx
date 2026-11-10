import { ArrowRight, Flame, MapPinned } from 'lucide-react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import type { Episode } from './engine/index.ts'
import { fmtDate, fmtInt, fmtRatio, fmtShare, sensorColor, sensorLabel } from './format'
import { BridgeProgress } from './BridgePanel'
import { useBridgeReport } from './useBridgeReport'
import { Legend, LegendItem, Tile } from './ui'

const ORDER: SensorKey[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21', 'landsat', 'other']
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function duration(hours: number) {
  if (hours < 1) return 'single pass'
  if (hours < 36) return `${Math.round(hours)} h`
  return `${(hours / 24).toFixed(1)} days`
}

function SensorSplit({ episode }: { episode: Episode }) {
  const parts = ORDER.filter((s) => episode.bySensor[s])
  return (
    <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((s) => `${sensorLabel(s)} ${episode.bySensor[s]}`).join(', ')}>
      {parts.map((s) => <span key={s} style={{ width: `${(episode.bySensor[s]! / episode.detections) * 100}%`, background: sensorColor(s) }} />)}
    </div>
  )
}

export function EpisodesCard({ analysisId, onShowEpisode, onOpenBridge }: { analysisId?: string; onShowEpisode?: (start: string, endExclusive: string) => void; onOpenBridge?: () => void }) {
  const state = useBridgeReport(analysisId)
  if (!analysisId || state.status === 'idle') return null
  if (state.status === 'loading') return <BridgeProgress state={state} />
  if (state.status === 'error' || state.status === 'too-large')
    return <p className="card m-0 p-5 text-[13px] text-fg-2">{state.status === 'too-large' ? 'Fire episodes are computed in the browser and this selection is too large; narrow the area or period.' : 'Fire episodes could not be computed right now.'}</p>
  const { report } = state
  const e = report.episodes
  const gap = report.headline
  const explained = gap?.shares && gap.shares.residual >= 0 ? gap.shares.pixel + gap.shares.smallFires : null
  const shown = e.top.slice(0, 6)
  const sensors = ORDER.filter((s) => shown.some((ep) => ep.bySensor[s]))
  const floor = report.sensitivity.floor
  return (
    <div className="flex flex-col gap-5 font-sans">
      {gap && explained !== null && (
        <section className="card relative flex flex-wrap items-center justify-between gap-4 overflow-hidden p-5" aria-label="Sensor bridge summary">
          <div className="pointer-events-none absolute -left-20 -top-24 size-56 rounded-full bg-ember-500/10 blur-3xl" aria-hidden="true" />
          <p className="relative m-0 max-w-3xl text-[14px] leading-relaxed text-fg-2">
            <strong className="font-semibold text-fg">{sensorLabel(gap.platform)} records {fmtRatio(gap.ratioDetections)} as many detections as Aqua here</strong>, and {fmtShare(explained)} of that gap comes from pixel size and fires below MODIS’s detection floor, not from more burning.
          </p>
          {onOpenBridge && (
            <button type="button" onClick={onOpenBridge} className="ui-button relative">
              Open the sensor bridge
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </section>
      )}
      <section className="card min-w-0 p-5 sm:p-6" aria-labelledby="episodes-heading">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="m-0 mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">Detections are not fires</p>
            <h3 id="episodes-heading" className="m-0 text-[16px] font-semibold text-fg">Fire episodes</h3>
            <p className="mb-0 mt-1.5 text-[13px] leading-relaxed text-fg-2">
              Chaining detections that lie within {e.linkMetres / 1000} km and {e.linkHours} h of each other turns {fmtInt(e.detections)} detections into <strong className="font-semibold text-fg">{fmtInt(e.count)} clusters</strong>. One fire can split, and neighbouring fires can merge, so a cluster is a reading aid, not a confirmed incident.
            </p>
          </div>
        </header>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile tone="ember" label="Detection clusters" value={fmtInt(e.count)} sub={`${fmtShare(e.count ? e.singletons / e.count : null)} are a single detection`} />
          <Tile label="Lasting a day or more" value={fmtInt(e.multiDay)} sub="clusters spanning ≥ 24 h" />
          <Tile label="Also seen by MODIS" value={fmtShare(e.count ? e.withModis / e.count : null)} sub={`${fmtInt(e.withModis)} clusters include Terra or Aqua`} />
          <Tile label="Seen by VIIRS only" value={fmtShare(e.count ? e.viirsOnly / e.count : null)} sub={e.viirsOnlyBelowFloor !== null && e.viirsOnly ? `${fmtShare(e.viirsOnlyBelowFloor / e.viirsOnly)} of them peak below the ${floor} MW MODIS floor` : 'no Terra or Aqua detection in the cluster'} />
        </div>
        {e.top.length > 0 && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-[13px] font-medium text-fg">Largest episodes</p>
              <Legend label="Satellites">{sensors.map((s) => <LegendItem key={s} color={sensorColor(s)} label={SENSORS[s].label} />)}</Legend>
            </div>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {shown.map((episode, index) => {
                const start = episode.start.slice(0, 10)
                const end = episode.end.slice(0, 10)
                return (
                  <li key={episode.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl px-2 py-2.5 hover:bg-white/[0.02] sm:grid-cols-[1.5rem_minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                    <span className="font-mono text-[11px] text-fg-3">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13.5px] text-fg">
                        <Flame size={13} className="self-center text-ember-300" aria-hidden="true" />
                        <time dateTime={episode.start}>{fmtDate(start)}</time>
                        {end !== start && <span className="text-fg-3">→ <time dateTime={episode.end}>{fmtDate(end)}</time></span>}
                      </p>
                      <p className="m-0 mt-0.5 text-[12px] text-fg-3">
                        {duration(episode.durationHours)} · {fmtInt(episode.detections)} detections · {episode.passes} passes{episode.maxFrp !== null ? ` · peak ${fmtInt(episode.maxFrp)} MW` : ''} · {episode.lat.toFixed(2)}°, {episode.lon.toFixed(2)}°
                      </p>
                    </div>
                    <div className="col-span-3 col-start-2 sm:col-span-1 sm:col-start-auto"><SensorSplit episode={episode} /></div>
                    {onShowEpisode && (
                      <button type="button" className="ui-button ui-button--small row-start-1 col-start-3 sm:col-start-4" onClick={() => onShowEpisode(start, nextDay(end))} aria-label={`Show episode of ${fmtDate(start)} on the map`}>
                        <MapPinned size={13} aria-hidden="true" />
                        Map
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </section>
    </div>
  )
}
