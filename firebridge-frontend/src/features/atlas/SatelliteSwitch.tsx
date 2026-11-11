import type { Instrument } from './atlas'
import type { AtlasController } from './useAtlas'

const ratio = (a: number, b: number) => {
  const r = a / b
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`
}

const INSTRUMENTS: { key: Instrument; label: string; detail: string }[] = [
  { key: 'all', label: 'All satellites', detail: '' },
  { key: 'modis', label: 'MODIS', detail: '1 km' },
  { key: 'viirs', label: 'VIIRS', detail: '375 m' },
]

/** "Seen by": the same fires through each instrument. The heart of the MODIS → VIIRS story. */
export function SatelliteSwitch({ atlas }: { atlas: AtlasController }) {
  const { modis, viirs } = atlas.allSatellites
  const insight =
    modis && viirs
      ? atlas.instrument === 'modis'
        ? `MODIS saw ${modis.toLocaleString('en-US')} of the ${(modis + viirs).toLocaleString('en-US')} detections in this period.`
        : atlas.instrument === 'viirs'
          ? `VIIRS saw ${viirs.toLocaleString('en-US')} detections, ${ratio(viirs, modis)} as many as MODIS.`
          : viirs >= modis
            ? `VIIRS recorded ${ratio(viirs, modis)} as many detections as MODIS: its 375 m pixels catch smaller fires.`
            : `MODIS recorded ${ratio(modis, viirs)} as many detections as VIIRS in this period.`
      : modis
        ? 'Only MODIS observed this period.'
        : viirs
          ? 'Only VIIRS observed this period.'
          : ''
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 font-sans">
      <div role="radiogroup" aria-label="Seen by" className="flex items-center gap-0.5 rounded-full border border-white/10 bg-ink-950/60 p-[3px]">
        <span className="px-2 text-[11.5px] text-fg-3 max-sm:hidden">Seen by</span>
        {INSTRUMENTS.map((option) => {
          const available = option.key === 'all' || (option.key === 'modis' ? modis : viirs) > 0 || atlas.instrument === option.key
          const on = atlas.instrument === option.key
          return (
            <button key={option.key} type="button" role="radio" aria-checked={on} disabled={!available} onClick={() => atlas.setInstrument(option.key)}
              className={`whitespace-nowrap rounded-full border-0 px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-35 ${on ? 'bg-gradient-to-br from-flare to-ember-500 text-[#1a0802]' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
              {option.label}
              {option.detail && <span className={`ml-1 font-mono text-[10px] max-sm:hidden ${on ? 'text-[#1a0802]/70' : 'text-fg-3'}`}>{option.detail}</span>}
            </button>
          )
        })}
      </div>
      {insight && <p className="m-0 min-w-0 flex-1 text-[12px] leading-snug text-fg-2 max-sm:basis-full" aria-live="polite">{insight}</p>}
    </div>
  )
}

