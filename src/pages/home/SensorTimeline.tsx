import { motion } from 'motion/react'
import { SENSORS, TIMELINE_SENSORS } from '../../lib/sensors'

const START = 2000
const NOW = 2026 + 10.3 / 12 // November 2026
const SPAN = NOW - START
const pct = (year: number) => `${((year - START) / SPAN) * 100}%`
const TICKS = [2000, 2005, 2010, 2015, 2020, 2025]

export function SensorTimeline() {
  return (
    <div className="relative pt-8" role="figure" aria-label="Approximate active-fire record spans for MODIS Terra and Aqua and VIIRS Suomi-NPP, NOAA-20 and NOAA-21, 2000 to 2026">
      <div className="pointer-events-none absolute inset-x-0 bottom-8 top-8 sm:left-[168px]" aria-hidden="true">
        {TICKS.map((year) => (
          <span key={year} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: pct(year) }} />
        ))}
        <div className="absolute inset-y-0 right-0 rounded-xl border border-dashed border-ember-400/35 bg-ember-500/[0.06]" style={{ left: pct(2012) }}>
          <span className="absolute -top-7 left-2 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.12em] text-ember-300">
            MODIS + VIIRS overlap · the bridge
          </span>
        </div>
      </div>
      <ol className="relative m-0 flex list-none flex-col gap-3 p-0 pt-2">
        {TIMELINE_SENSORS.map((key, index) => {
          const sensor = SENSORS[key]
          const end = sensor.until ? sensor.until + 10 / 12 : NOW
          return (
            <li key={key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-0">
              <div className="flex w-[168px] shrink-0 items-center gap-2.5 pr-4">
                <span className="size-2.5 rounded-full" style={{ background: sensor.color, boxShadow: `0 0 12px ${sensor.color}` }} aria-hidden="true" />
                <span className="text-[13.5px] font-medium text-fg">{sensor.label}</span>
                <span className="font-mono text-[10.5px] text-fg-3">{sensor.instrument}</span>
              </div>
              <div className="relative h-8 flex-1">
                <motion.div
                  className="absolute inset-y-1 flex items-center justify-between overflow-hidden rounded-full px-3"
                  style={{
                    left: pct(sensor.since),
                    width: `${((end - sensor.since) / SPAN) * 100}%`,
                    background: `linear-gradient(90deg, ${sensor.color}38, ${sensor.color}1a)`,
                    border: `1px solid ${sensor.color}55`,
                    transformOrigin: 'left center',
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  whileInView={{ scaleX: 1, opacity: 1 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 1.1, delay: 0.15 + index * 0.12, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="font-mono text-[10.5px] text-fg-2">{sensor.since}</span>
                  <span className="hidden truncate pl-3 text-[11px] text-fg-2 md:inline">
                    {sensor.pixel} · {sensor.overpass} overpass{sensor.note ? ` · ${sensor.note}` : ''}
                  </span>
                </motion.div>
                {!sensor.until && (
                  <span className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full" style={{ left: `calc(${pct(NOW)} - 4px)`, background: sensor.color }} aria-hidden="true">
                    <span className="absolute inset-0 rounded-full animate-pulse-ring" style={{ background: sensor.color }} />
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="relative mt-3 h-5 sm:ml-[168px]" aria-hidden="true">
        {TICKS.map((year) => (
          <span key={year} className="absolute -translate-x-1/2 font-mono text-[10.5px] text-fg-3" style={{ left: pct(year) }}>{year}</span>
        ))}
        <span className="absolute -translate-x-full font-mono text-[10.5px] text-ember-300" style={{ left: pct(NOW) }}>today</span>
      </div>
    </div>
  )
}
