import { ArrowRight, Flame, MapPinned } from 'lucide-react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import type { Episode } from './engine/index.ts'
import { fmtDate, fmtInt, fmtRatio, fmtShare, sensorColor, sensorLabel } from './format'
import { useBridgeReport } from './useBridgeReport'
import { Legend, LegendItem } from './ui'
import { Figures } from '../story/Story'

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
  // While loading, the verdict card above reports progress.
  if (!analysisId || state.status === 'idle' || state.status === 'loading') return null
  if (state.status === 'error' || state.status === 'too-large')
    return <p className="card m-0 p-5 text-[13px] text-fg-2">{state.status === 'too-large' ? 'Fire episodes are computed in the browser and this selection is too large; narrow the area or period.' : 'Fire episodes could not be computed right now.'}</p>
  const { report } = state
  const e = report.episodes
  const gap = report.headline
  const explained = gap?.shares && gap.shares.residual >= 0 ? gap.shares.pixel + gap.shares.smallFires : null
  const shown = e.top.slice(0, 6)
  const sensors = ORDER.filter((s) => shown.some((ep) => ep.bySensor[s]))
  const floor = report.sensitivity.floor
  const longest = shown.reduce<Episode | null>((best, ep) => (!best || ep.durationHours > best.durationHours ? ep : best), null)
  return (
    <div className="flex flex-col gap-14 font-sans">
      {gap && explained !== null && (
        <figure className="relative m-0 grid gap-6 border-y border-white/[0.07] py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" aria-label="Sensor bridge summary">
          <blockquote className="relative m-0 max-w-[34ch] font-serif text-[clamp(24px,2.8vw,38px)] font-[420] italic leading-[1.18] tracking-[-0.01em] text-paper" style={{ fontVariationSettings: '"opsz" 144' }}>
            <span className="absolute -left-2 -top-8 font-serif text-[90px] not-italic leading-none text-ember-400/40 lg:-left-12" aria-hidden="true">“</span>
            {sensorLabel(gap.platform)} records {fmtRatio(gap.ratioDetections)} as many detections as Aqua here; {fmtShare(explained)} of that gap is pixel size and fires below MODIS’s floor, not more burning.
          </blockquote>
          {onOpenBridge && (
            <button type="button" onClick={onOpenBridge} className="group inline-flex items-center gap-2 self-end rounded-full border border-white/[0.1] bg-transparent px-4 py-2 text-[13px] font-medium text-fg-2 transition-colors hover:border-white/25 hover:text-fg">
              Open the sensor bridge
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </figure>
      )}
      <section className="relative grid gap-x-10 gap-y-6 pt-2 lg:grid-cols-[96px_minmax(0,1fr)]" aria-labelledby="episodes-heading">
        <div className="hidden lg:block" />
        <div className="flex min-w-0 flex-col gap-8">
          <header className="flex max-w-4xl flex-col gap-3">
            <p className="m-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-fg-3">Detections are not fires</p>
            <h3 id="episodes-heading" className="m-0 max-w-[30ch] font-serif text-[clamp(24px,2.5vw,34px)] font-[400] leading-[1.12] tracking-[-0.015em] text-paper" style={{ fontVariationSettings: '"opsz" 96' }}>
              Fire episodes: {fmtInt(e.detections)} detections, {fmtInt(e.count)} clusters{longest && longest.durationHours >= 36 ? `, the longest burning ${duration(longest.durationHours)}` : ''}
            </h3>
            <p className="m-0 max-w-[64ch] font-serif text-[16.5px] font-[400] leading-[1.6] text-paper-2" style={{ fontVariationSettings: '"opsz" 18' }}>
              Chaining detections that lie within {e.linkMetres / 1000} km and {e.linkHours} h of each other turns pixels into clusters. One fire can split and neighbouring fires can merge, so a cluster is a reading aid, not a confirmed incident.
            </p>
          </header>
          <Figures
            label="Clusters in four numbers"
            items={[
              { label: 'Detection clusters', value: fmtInt(e.count), note: `${fmtShare(e.count ? e.singletons / e.count : null)} are a single detection` },
              { label: 'Lasting a day or more', value: fmtInt(e.multiDay), note: 'clusters spanning ≥ 24 h' },
              { label: 'Also seen by MODIS', value: fmtShare(e.count ? e.withModis / e.count : null), note: `${fmtInt(e.withModis)} clusters include Terra or Aqua` },
              { label: 'Seen by VIIRS only', value: fmtShare(e.count ? e.viirsOnly / e.count : null), note: e.viirsOnlyBelowFloor !== null && e.viirsOnly ? `${fmtShare(e.viirsOnlyBelowFloor / e.viirsOnly)} of them peak below the ${floor} MW MODIS floor` : 'no Terra or Aqua detection in the cluster' },
            ]}
          />
          {e.top.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.2em] text-fg-3">The largest episodes</p>
                <Legend label="Satellites">{sensors.map((s) => <LegendItem key={s} color={sensorColor(s)} label={SENSORS[s].label} />)}</Legend>
              </div>
              <ol className="m-0 flex list-none flex-col p-0">
                {shown.map((episode, index) => {
                  const start = episode.start.slice(0, 10)
                  const end = episode.end.slice(0, 10)
                  return (
                    <li key={episode.id} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 border-t border-white/[0.06] py-5 sm:grid-cols-[3.5rem_minmax(0,1.2fr)_minmax(0,1fr)_auto]">
                      <span className="font-serif text-[38px] font-[420] italic leading-none text-transparent [-webkit-text-stroke:1px_rgba(255,160,112,0.6)]" style={{ fontVariationSettings: '"opsz" 144' }} aria-hidden="true">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="m-0 flex flex-wrap items-baseline gap-x-2 font-serif text-[20px] font-[400] text-paper" style={{ fontVariationSettings: '"opsz" 36' }}>
                          <Flame size={14} className="self-center text-ember-300" aria-hidden="true" />
                          <time dateTime={episode.start}>{fmtDate(start)}</time>
                          {end !== start && <span className="text-paper-2">→ <time dateTime={episode.end}>{fmtDate(end)}</time></span>}
                        </p>
                        <p className="m-0 mt-1 text-[12.5px] text-fg-3">
                          {duration(episode.durationHours)} · {fmtInt(episode.detections)} detections · {episode.passes} passes{episode.maxFrp !== null ? ` · peak ${fmtInt(episode.maxFrp)} MW` : ''} · {episode.lat.toFixed(2)}°, {episode.lon.toFixed(2)}°
                        </p>
                      </div>
                      <div className="col-span-3 col-start-2 sm:col-span-1 sm:col-start-auto"><SensorSplit episode={episode} /></div>
                      {onShowEpisode && (
                        <button type="button" className="row-start-1 col-start-3 inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-transparent px-3 py-1.5 text-[12px] font-medium text-fg-2 transition-colors hover:border-ember-400/40 hover:text-ember-100 sm:col-start-4" onClick={() => onShowEpisode(start, nextDay(end))} aria-label={`Show episode of ${fmtDate(start)} on the map`}>
                          <MapPinned size={13} aria-hidden="true" />
                          Map
                        </button>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
