import { Pause, Play } from 'lucide-react'
import { AtlasTimeline } from './AtlasTimeline'
import { SatelliteSwitch } from './SatelliteSwitch'
import { fmtRate, type AtlasController } from './useAtlas'

/** The one control under the map: when. */
export function AtlasDeck({ atlas }: { atlas: AtlasController }) {
  const { data, summary, window } = atlas
  const whole = window.start === data.firstDay && window.end === data.endDay
  return (
    <div className="atlas-deck border-t border-white/[0.06] bg-ink-900 px-4 pb-3 pt-3 font-sans">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2.5" aria-live="polite">
          <strong className="font-display text-[16px] font-semibold text-fg">{whole ? 'All years' : atlas.label}</strong>
          <span className="text-[12.5px] text-fg-2">
            {summary.count.toLocaleString('en-US')} detections on {summary.fireDays.toLocaleString('en-US')} day{summary.fireDays === 1 ? '' : 's'}
          </span>
        </p>
        {whole ? <span className="text-[11.5px] text-fg-3">Drag across the timeline to choose a period, or click a month</span> : (
          <button type="button" onClick={() => atlas.setWindow(data.firstDay, data.endDay, true)} className="border-0 bg-transparent p-0 text-[12px] text-ember-300 hover:text-ember-200">Show all years</button>
        )}
      </div>
      <div className="mb-3 mt-2.5"><SatelliteSwitch atlas={atlas} /></div>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={atlas.togglePlay}
          aria-label={atlas.playing ? 'Pause replay' : 'Replay the fires day by day'}
          title={atlas.playing ? 'Pause' : 'Replay the fires day by day'}
          className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border-0 transition-transform hover:scale-105 ${atlas.playing ? 'bg-white/10 text-fg' : 'bg-gradient-to-br from-flare to-ember-500 text-[#1a0802] shadow-[0_8px_24px_-8px_rgb(255_95_31/0.9)]'}`}
        >
          {atlas.playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
        </button>
        <AtlasTimeline data={data} sensors={atlas.sensors} window={window} onWindow={atlas.setWindow} playhead={atlas.playhead} />
        <button type="button" onClick={atlas.cycleSpeed} title={`Replay speed: ${fmtRate(atlas.daysPerSecond)}. Click to change.`} aria-label={`Replay speed: ${atlas.speed.label}, ${fmtRate(atlas.daysPerSecond)}`}
          className="mt-2 shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-transparent px-2.5 py-1 text-[11px] text-fg-2 hover:text-fg">
          {atlas.speed.label} <span className="font-mono text-[10px] text-fg-3 max-sm:hidden">{fmtRate(atlas.daysPerSecond)}</span>
        </button>
      </div>
    </div>
  )
}
