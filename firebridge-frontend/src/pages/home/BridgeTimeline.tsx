import { useId } from 'react'
import { SENSORS } from '../../lib/sensors'
import { useElementWidth } from '../../hooks/useElementWidth'

/**
 * The bridge, literally. MODIS records fade out above (both satellites have left their maintained
 * orbits and are drifting toward the end of their missions); VIIRS records run on below. An arch
 * spans the years they flew together, and beneath it one ember
 * thread, the Aqua-equivalent record, carries on across the gap.
 */

const START = 2000
const END = 2031
const NOW = 2026 + 10.4 / 12

export function BridgeTimeline() {
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useElementWidth<HTMLDivElement>(1100)
  const W = Math.max(320, width)
  const narrow = W < 640
  const H = narrow ? 300 : 340
  const L = 12
  const Rm = 12
  const x = (year: number) => L + ((year - START) / (END - START)) * (W - L - Rm)
  const modisY = [64, 84]
  const viirsY = [H - 120, H - 100, H - 80]
  const recordY = H - 40
  const archTop = 22
  const bridgeFrom = x(2012)
  const bridgeTo = x(NOW)
  const modis = [
    { s: SENSORS.terra, from: 2000.83, to: NOW + 0.5, y: modisY[0] },
    { s: SENSORS.aqua, from: 2002.5, to: NOW + 0.5, y: modisY[1] },
  ]
  const viirs = [
    { s: SENSORS.snpp, from: 2012.05, to: 2026.84, y: viirsY[0], ends: true },
    { s: SENSORS.noaa20, from: 2018.25, to: NOW, y: viirsY[1], ends: false },
    { s: SENSORS.noaa21, from: 2023.17, to: NOW, y: viirsY[2], ends: false },
  ]
  const label = (text: string, xPos: number, y: number, color: string, anchor: 'start' | 'end' = 'start') => (
    <text x={xPos} y={y} textAnchor={anchor} fill={color} fontSize={narrow ? 10 : 11.5} fontWeight={600} fontFamily="Inter Variable, sans-serif" stroke="#06070b" strokeWidth="3" paintOrder="stroke">
      {text}
    </text>
  )
  return (
    <div ref={ref} className="w-full">
      <svg width={W} height={H} className="block" role="img" aria-label="Timeline 2000 to 2031: MODIS on Terra (from 2000) and Aqua (from 2002) fade out today, both satellites drifting toward the end of their missions; VIIRS on Suomi-NPP (from 2012), NOAA-20 (2018) and NOAA-21 (2023) continue. An arch spans 2012 to today, the years both flew; beneath it one Aqua-equivalent record runs continuously.">
        <defs>
          <linearGradient id={`${uid}-fade`} x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset={(x(NOW - 1.2) / x(NOW + 0.6)).toFixed(3)} stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${uid}-modis-mask`}>
            <rect x={0} y={0} width={x(NOW + 0.6)} height={H} fill={`url(#${uid}-fade)`} />
          </mask>
          <linearGradient id={`${uid}-arch`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffb547" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ff5f1f" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id={`${uid}-record`} x1="0" x2="1">
            <stop offset="0" stopColor="#ff7c40" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#ffb547" />
            <stop offset="1" stopColor="#ff7c40" stopOpacity="0.4" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>

        {[2000, 2005, 2010, 2015, 2020, 2025, 2030].map((year) => (
          <g key={year}>
            <line x1={x(year)} x2={x(year)} y1={archTop} y2={H - 22} stroke="rgba(255,255,255,0.045)" />
            <text x={x(year)} y={H - 6} textAnchor="middle" fill="#737a88" fontSize="10.5" fontFamily="JetBrains Mono Variable, monospace">{year}</text>
          </g>
        ))}

        {/* The years both instruments flew: the span of the bridge. */}
        <rect x={bridgeFrom} y={archTop} width={bridgeTo - bridgeFrom} height={H - 22 - archTop} fill="#ff7c40" opacity="0.045" rx="10" />
        <path d={`M${bridgeFrom},${recordY} C${bridgeFrom},${archTop + 10} ${bridgeTo},${archTop + 10} ${bridgeTo},${recordY}`} fill="none" stroke={`url(#${uid}-arch)`} strokeWidth="10" opacity="0.4" filter={`url(#${uid}-glow)`} />
        <path d={`M${bridgeFrom},${recordY} C${bridgeFrom},${archTop + 10} ${bridgeTo},${archTop + 10} ${bridgeTo},${recordY}`} fill="none" stroke={`url(#${uid}-arch)`} strokeWidth="2.5" />
        {Array.from({ length: 13 }, (_, k) => {
          // Suspension cables from the arch down to the record.
          const tt = (k + 1) / 14
          const bx = (1 - tt) ** 3 * bridgeFrom + 3 * (1 - tt) ** 2 * tt * bridgeFrom + 3 * (1 - tt) * tt ** 2 * bridgeTo + tt ** 3 * bridgeTo
          const by = (1 - tt) ** 3 * recordY + 3 * (1 - tt) ** 2 * tt * (archTop + 10) + 3 * (1 - tt) * tt ** 2 * (archTop + 10) + tt ** 3 * recordY
          return <line key={k} x1={bx} x2={bx} y1={by} y2={recordY} stroke="#ffb547" strokeOpacity="0.16" />
        })}
        {label(narrow ? 'Flown together' : `Flown together since 2012 · the calibration span`, (bridgeFrom + bridgeTo) / 2, archTop + 4, '#ffc5a3', 'start')}

        {/* MODIS, fading out as the instruments end. */}
        <g mask={`url(#${uid}-modis-mask)`}>
          {modis.map((m) => (
            <g key={m.s.key}>
              <line x1={x(m.from)} x2={x(m.to)} y1={m.y} y2={m.y} stroke={m.s.color} strokeWidth="6" strokeLinecap="round" opacity="0.3" filter={`url(#${uid}-glow)`} />
              <line x1={x(m.from)} x2={x(m.to)} y1={m.y} y2={m.y} stroke={m.s.color} strokeWidth="2.5" strokeLinecap="round" />
            </g>
          ))}
        </g>
        {label('MODIS · Terra', x(2000.83), modisY[0] - 9, SENSORS.terra.color)}
        {label('MODIS · Aqua', x(2002.5), modisY[1] + 19, SENSORS.aqua.color)}
        {!narrow && label('both drifting, near the end of their missions', x(NOW) - 6, modisY[0] - 9, '#aab0bc', 'end')}

        {/* VIIRS, carrying on. */}
        {viirs.map((v) => (
          <g key={v.s.key}>
            <line x1={x(v.from)} x2={x(v.to)} y1={v.y} y2={v.y} stroke={v.s.color} strokeWidth="6" strokeLinecap="round" opacity="0.3" filter={`url(#${uid}-glow)`} />
            <line x1={x(v.from)} x2={x(v.to)} y1={v.y} y2={v.y} stroke={v.s.color} strokeWidth="2.5" strokeLinecap="round" />
            {!v.ends && <line x1={x(v.to)} x2={x(END - 0.3)} y1={v.y} y2={v.y} stroke={v.s.color} strokeWidth="2" strokeDasharray="2 5" opacity="0.6" />}
            {label(`VIIRS · ${v.s.label}`, x(v.from) - 8, v.y + 4, v.s.color, 'end')}
          </g>
        ))}

        {/* One comparable record. */}
        <line x1={x(2002.5)} x2={x(END - 0.3)} y1={recordY} y2={recordY} stroke="#ff7c40" strokeWidth="10" opacity="0.35" filter={`url(#${uid}-glow)`} />
        <line x1={x(2002.5)} x2={x(NOW)} y1={recordY} y2={recordY} stroke={`url(#${uid}-record)`} strokeWidth="3.5" strokeLinecap="round" />
        <line x1={x(NOW)} x2={x(END - 0.3)} y1={recordY} y2={recordY} stroke="#ffb547" strokeWidth="2.5" strokeDasharray="3 5" />
        {label('FIREBRIDGE · one Aqua-equivalent record', x(2002.5), recordY - 12, '#ffc5a3')}
        <line x1={x(NOW)} x2={x(NOW)} y1={archTop} y2={H - 22} stroke="#f4ede3" strokeOpacity="0.35" strokeDasharray="2 3" />
        {label('today', x(NOW) + 6, H - 26, '#f4ede3')}
      </svg>
    </div>
  )
}
