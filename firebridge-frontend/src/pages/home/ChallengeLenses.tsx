import { SENSORS, TIMELINE_SENSORS } from '../../lib/sensors'

/**
 * Three small drawings of the three ways the same fire is counted differently: pixel size, hour of
 * the pass, and the changing fleet. Each is a diagram of documented instrument facts, not data.
 */

/** One square kilometre as MODIS sees it (one pixel) with the 375 m VIIRS grid over it, and a
 *  1,000 m² fire at true size. */
export function MiniPixels() {
  const S = 200
  const k = S / 1000
  const fire = { x: 610 * k, y: 380 * k, r: Math.sqrt(1000 / Math.PI) * k }
  return (
    <svg viewBox={`0 0 ${S + 2} ${S + 2}`} className="h-auto w-full max-w-[220px]" role="img" aria-label="One square kilometre: a single 1 km MODIS pixel, the 375 m VIIRS pixels over the same ground, and a 1,000 square metre fire at true size">
      <defs>
        <radialGradient id="lens-fire">
          <stop offset="0" stopColor="#fff1e6" />
          <stop offset="0.35" stopColor="#ffb547" />
          <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width={S} height={S} rx="3" fill="#0b0d12" stroke={SENSORS.aqua.color} strokeOpacity="0.8" strokeWidth="1.5" />
      <rect x={1 + 375 * k} y={1 + 375 * k} width={375 * k} height={375 * k} fill={SENSORS.noaa20.color} opacity="0.16" />
      {[375, 750].map((v) => (
        <g key={v} stroke={SENSORS.noaa20.color} strokeOpacity="0.45">
          <line x1={1 + v * k} x2={1 + v * k} y1="1" y2={S + 1} />
          <line y1={1 + v * k} y2={1 + v * k} x1="1" x2={S + 1} />
        </g>
      ))}
      <circle cx={1 + fire.x} cy={1 + fire.y} r="16" fill="url(#lens-fire)" opacity="0.7" />
      <circle cx={1 + fire.x} cy={1 + fire.y} r={Math.max(1.8, fire.r)} fill="#fff5ee" />
    </svg>
  )
}

const angleOf = (hours: number) => Math.PI - ((hours - 6) / 12) * Math.PI
const at = (hours: number, r: number, cx: number, cy: number) => [cx + r * Math.cos(angleOf(hours)), cy - r * Math.sin(angleOf(hours))] as const

/** The daytime half of a 24-hour dial: when each satellite passes, when fire burns hardest, and
 *  where Aqua's drift is taking its pass. */
export function MiniDial() {
  const cx = 130
  const cy = 128
  const R = 88
  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = at(from, r, cx, cy)
    const [x2, y2] = at(to, r, cx, cy)
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`
  }
  const mark = (hours: number, color: string, label: string, r: number, up = false) => {
    const [x, y] = at(hours, r, cx, cy)
    const [lx, ly] = at(hours, r - (up ? -16 : 18), cx, cy)
    return (
      <g key={label}>
        <circle cx={x} cy={y} r="4.5" fill={color} stroke="#06070b" strokeWidth="1.5" />
        <text x={lx} y={ly + 3} textAnchor="middle" fill={color} fontSize="9.5" fontWeight="600" fontFamily="JetBrains Mono Variable, monospace">{label}</text>
      </g>
    )
  }
  return (
    <svg viewBox="0 0 260 142" className="h-auto w-full max-w-[270px]" role="img" aria-label="Daytime dial from 06:00 to 18:00: Terra passes near 10:30, Aqua and VIIRS near 13:30, fires burn hardest between 13:00 and 18:30, and Aqua's pass is drifting later">
      <path d={arc(6, 18, R)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <path d={arc(13, 18, R)} fill="none" stroke="#ff7c40" strokeWidth="7" strokeLinecap="round" opacity="0.85" />
      <path d={arc(13.5, 15.5, R - 22)} fill="none" stroke={SENSORS.aqua.color} strokeWidth="2" strokeDasharray="3 3" markerEnd="url(#lens-arrow)" />
      <defs>
        <marker id="lens-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={SENSORS.aqua.color} />
        </marker>
      </defs>
      {[6, 12, 18].map((h) => {
        const [x, y] = at(h, R + 24, cx, cy)
        return <text key={h} x={x} y={y + 3} textAnchor="middle" fill="#737a88" fontSize="9" fontFamily="JetBrains Mono Variable, monospace">{`${String(h).padStart(2, '0')}:00`}</text>
      })}
      {mark(10.5, SENSORS.terra.color, 'TERRA', R - 22)}
      {mark(13.5, SENSORS.snpp.color, 'VIIRS', R + 2, true)}
      {mark(13.5, SENSORS.aqua.color, 'AQUA', R - 22)}
      <circle cx={cx} cy={cy} r="2.5" fill="#f4ede3" />
    </svg>
  )
}

const START = 2000
const END = 2027

/** Five satellites joining (and leaving) the record: every join lifts a raw total. */
export function MiniFleet() {
  const W = 240
  const x = (year: number) => 18 + ((year - START) / (END - START)) * (W - 28)
  const rows = TIMELINE_SENSORS.map((key) => SENSORS[key])
  return (
    <svg viewBox={`0 0 ${W} 120`} className="h-auto w-full max-w-[260px]" role="img" aria-label="Record spans: Terra from 2000, Aqua from 2002, Suomi-NPP from 2012, NOAA-20 from 2018 and NOAA-21 from 2023">
      {[2000, 2010, 2020].map((year) => (
        <g key={year}>
          <line x1={x(year)} x2={x(year)} y1="4" y2="98" stroke="rgba(255,255,255,0.06)" />
          <text x={x(year)} y="114" textAnchor="middle" fill="#737a88" fontSize="9" fontFamily="JetBrains Mono Variable, monospace">{year}</text>
        </g>
      ))}
      {rows.map((sensor, i) => {
        const y = 14 + i * 19
        const end = sensor.until ? sensor.until + 0.85 : 2026.85
        return (
          <g key={sensor.key}>
            <line x1={x(sensor.since)} x2={x(end)} y1={y} y2={y} stroke={sensor.color} strokeWidth="3" strokeLinecap="round" opacity="0.85" />
            {sensor.since > 2005 && <circle cx={x(sensor.since)} cy={y} r="5" fill="none" stroke={sensor.color} strokeWidth="1.5" />}
            <text x={x(sensor.since) - 8} y={y + 3} textAnchor="end" fill="#aab0bc" fontSize="8.5" fontFamily="Inter Variable, sans-serif">{sensor.since > 2005 ? sensor.label : ''}</text>
          </g>
        )
      })}
      <text x={x(START) + 2} y={14 + 3 - 9} fill="#aab0bc" fontSize="8.5" fontFamily="Inter Variable, sans-serif">Terra, Aqua</text>
    </svg>
  )
}
