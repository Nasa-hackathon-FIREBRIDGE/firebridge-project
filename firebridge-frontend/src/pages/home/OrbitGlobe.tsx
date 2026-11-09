import { useReducedMotion } from 'motion/react'
import { SENSORS, TIMELINE_SENSORS } from '../../lib/sensors'

const C = 280
const R = 168

// Deterministic hot-spot positions (lon/lat-ish on the visible hemisphere).
const HOTSPOTS: [number, number, number][] = [
  [-0.32, -0.38, 1.0], [-0.26, -0.33, 0.7], [-0.36, -0.29, 0.5], [-0.2, -0.41, 0.6], [-0.28, -0.22, 0.9],
  [0.05, -0.12, 0.45], [0.12, 0.06, 0.8], [0.18, 0.12, 0.55], [0.08, 0.18, 0.4], [0.26, 0.02, 0.35],
  [-0.55, 0.1, 0.5], [-0.48, 0.2, 0.7], [0.48, -0.42, 0.45], [0.55, -0.35, 0.6], [0.4, 0.35, 0.4],
  [-0.1, 0.42, 0.5], [0.0, 0.5, 0.35], [0.62, 0.05, 0.3], [-0.65, -0.1, 0.35], [0.3, -0.56, 0.4],
]

const ORBITS = [
  { rx: 248, ry: 64, rotate: -18, duration: 15, sensors: ['terra', 'aqua'] },
  { rx: 232, ry: 92, rotate: 28, duration: 19, sensors: ['snpp', 'noaa20', 'noaa21'] },
] as const

function ellipsePath(rx: number, ry: number) {
  return `M ${C - rx},${C} a ${rx},${ry} 0 1,0 ${rx * 2},0 a ${rx},${ry} 0 1,0 ${-rx * 2},0`
}

export function OrbitGlobe() {
  const reduced = useReducedMotion()
  return (
    <svg viewBox="0 0 560 560" className="h-auto w-full max-w-[560px]" role="img" aria-label="Illustration: MODIS and VIIRS satellites orbiting Earth above active-fire hot spots">
      <defs>
        <radialGradient id="globe-fill" cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#1f2633" />
          <stop offset="0.55" stopColor="#11141b" />
          <stop offset="1" stopColor="#07080c" />
        </radialGradient>
        <radialGradient id="globe-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.62" stopColor="#ff5f1f" stopOpacity="0" />
          <stop offset="0.72" stopColor="#ff5f1f" stopOpacity="0.16" />
          <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="terminator" cx="0.75" cy="0.7" r="0.75">
          <stop offset="0.4" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id="hotspot" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff1c2" />
          <stop offset="0.35" stopColor="#ffb547" />
          <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
        </radialGradient>
        <clipPath id="globe-clip"><circle cx={C} cy={C} r={R} /></clipPath>
        <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <circle cx={C} cy={C} r={R + 70} fill="url(#globe-halo)" />
      <circle cx={C} cy={C} r={R} fill="url(#globe-fill)" />

      {/* Graticule */}
      <g clipPath="url(#globe-clip)" stroke="rgba(255,255,255,0.07)" fill="none" strokeWidth="1">
        {[-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].map((f) => (
          <ellipse key={`lat${f}`} cx={C} cy={C + f * R} rx={R * Math.sqrt(1 - f * f)} ry={R * 0.16 * Math.sqrt(1 - f * f)} />
        ))}
        {[0.15, 0.4, 0.65, 0.9].map((f) => (
          <ellipse key={`lon${f}`} cx={C} cy={C} rx={R * f} ry={R} />
        ))}
        <line x1={C} y1={C - R} x2={C} y2={C + R} />
      </g>

      {/* Fire detections */}
      <g clipPath="url(#globe-clip)">
        {HOTSPOTS.map(([x, y, intensity], index) => {
          const cx = C + x * R
          const cy = C + y * R
          const r = 5 + intensity * 9
          return (
            <g key={index}>
              <circle cx={cx} cy={cy} r={r} fill="url(#hotspot)" opacity={0.55 + intensity * 0.45}>
                {!reduced && <animate attributeName="opacity" values={`${0.35 + intensity * 0.3};${0.7 + intensity * 0.3};${0.35 + intensity * 0.3}`} dur={`${2.2 + (index % 5) * 0.45}s`} repeatCount="indefinite" />}
              </circle>
              <circle cx={cx} cy={cy} r={1.4 + intensity} fill="#fff5ee" />
            </g>
          )
        })}
      </g>
      <circle cx={C} cy={C} r={R} fill="url(#terminator)" />
      <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,0.1)" />

      {/* Orbits and satellites */}
      {ORBITS.map((orbit, orbitIndex) => (
        <g key={orbitIndex} transform={`rotate(${orbit.rotate} ${C} ${C})`}>
          <path d={ellipsePath(orbit.rx, orbit.ry)} fill="none" stroke="rgba(255,255,255,0.12)" strokeDasharray="2 6" />
          {orbit.sensors.map((key, index) => {
            const sensor = SENSORS[key]
            const begin = -(orbit.duration / orbit.sensors.length) * index
            return (
              <g key={key}>
                {reduced ? (
                  <g transform={`translate(${C + orbit.rx * Math.cos(index * 2.1 + orbitIndex)} ${C + orbit.ry * Math.sin(index * 2.1 + orbitIndex)})`}>
                    <circle r="9" fill={sensor.color} opacity="0.25" filter="url(#soft-glow)" />
                    <circle r="4" fill={sensor.color} stroke="#06070b" strokeWidth="1.5" />
                  </g>
                ) : (
                  <g>
                    <circle r="10" fill={sensor.color} opacity="0.28" filter="url(#soft-glow)" />
                    <circle r="4.2" fill={sensor.color} stroke="#06070b" strokeWidth="1.5" />
                    <animateMotion dur={`${orbit.duration}s`} begin={`${begin}s`} repeatCount="indefinite" path={ellipsePath(orbit.rx, orbit.ry)} />
                  </g>
                )}
              </g>
            )
          })}
        </g>
      ))}

      {/* Legend chips rendered inside the SVG so they scale with it */}
      <g fontFamily="'JetBrains Mono Variable', monospace" fontSize="11">
        <g transform="translate(26 70)">
          <rect width="148" height="30" rx="15" fill="rgba(14,16,22,0.85)" stroke="rgba(255,255,255,0.1)" />
          <circle cx="17" cy="15" r="4" fill={SENSORS.terra.color} />
          <circle cx="29" cy="15" r="4" fill={SENSORS.aqua.color} />
          <text x="42" y="19" fill="#aab0bc">MODIS · 1 km</text>
        </g>
        <g transform="translate(372 470)">
          <rect width="168" height="30" rx="15" fill="rgba(14,16,22,0.85)" stroke="rgba(255,255,255,0.1)" />
          {TIMELINE_SENSORS.slice(2).map((key, index) => (
            <circle key={key} cx={17 + index * 11} cy="15" r="4" fill={SENSORS[key].color} />
          ))}
          <text x="52" y="19" fill="#aab0bc">VIIRS · 375 m</text>
        </g>
      </g>
    </svg>
  )
}
