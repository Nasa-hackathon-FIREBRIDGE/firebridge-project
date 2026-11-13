import { useEffect, useRef } from 'react'
import { SENSORS, type SensorKey } from '../../lib/sensors'
import { LAND_DOTS } from './landDots'

/**
 * The home page Earth. Real continents as a dot matrix, lit by the Sun, turning under the five
 * fire satellites on their real sun-synchronous planes: Terra on the 10:30 plane; Aqua, Suomi-NPP,
 * NOAA-20 and NOAA-21 on the 13:30 plane. Each satellite sweeps its scan swath across the ground;
 * a fire flashes in the satellite's colour when the swath passes over it. MODIS (1 km pixels) only
 * catches the larger fires, VIIRS (375 m) the small ones too, which is the challenge in one picture.
 *
 * Illustration: fire regions are approximate and orbit altitudes are exaggerated so the rings read.
 */

export interface GlobePin {
  id: string
  lon: number
  lat: number
  label: string
}

type V3 = [number, number, number]

const DEG = Math.PI / 180
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const fromLonLat = (lon: number, lat: number): V3 => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)]

/** Equatorial frame fixed to the Sun: X toward local noon, Z toward the north pole. */
const SUN: V3 = [1, 0, 0]
/** The viewer: 20° above the equator, at about 10:40 local time, so the day side faces us. */
const CAMERA = norm(fromLonLat(-20, 20))
const RIGHT = norm(cross([0, 0, 1], CAMERA))
const UP = cross(CAMERA, RIGHT)

const ORBIT_SECONDS = 16
const SPIN_SECONDS = 150
/** Start over Africa and Europe, so the first minute sweeps the busiest fire regions. */
const START_SPIN = -35 * DEG
const INCLINATION = 98.2 * DEG

interface Satellite {
  key: SensorKey
  /** Local solar time of the ascending node, hours. */
  node: number
  phase: number
  radius: number
  /** Half-width of the scan swath, as an angle at the Earth's centre. */
  swath: number
  /** Smallest fire (0-1 scale) the instrument records. */
  floor: number
  instrument: 'MODIS' | 'VIIRS'
}

// MODIS 2,330 km swath (10.5° half-angle), VIIRS 3,040 km (13.7°). Terra descends at 10:30, so its
// ascending node is at 22:30; the afternoon satellites ascend at 13:30, NOAA-20 half an orbit ahead
// of Suomi-NPP and NOAA-21 between them.
const SATELLITES: Satellite[] = [
  { key: 'terra', node: 22.5, phase: 1.1, radius: 1.17, swath: 10.5 * DEG, floor: 0.42, instrument: 'MODIS' },
  { key: 'aqua', node: 13.5, phase: -0.18, radius: 1.17, swath: 10.5 * DEG, floor: 0.42, instrument: 'MODIS' },
  { key: 'snpp', node: 13.5, phase: 0, radius: 1.27, swath: 13.7 * DEG, floor: 0.03, instrument: 'VIIRS' },
  { key: 'noaa20', node: 13.5, phase: Math.PI, radius: 1.27, swath: 13.7 * DEG, floor: 0.03, instrument: 'VIIRS' },
  { key: 'noaa21', node: 13.5, phase: Math.PI / 2, radius: 1.27, swath: 13.7 * DEG, floor: 0.03, instrument: 'VIIRS' },
]

function orbitBasis(s: Satellite): [V3, V3] {
  const psi = (s.node - 12) * 15 * DEG
  const n: V3 = [Math.cos(psi), Math.sin(psi), 0]
  const m: V3 = [-Math.sin(psi) * Math.cos(INCLINATION), Math.cos(psi) * Math.cos(INCLINATION), Math.sin(INCLINATION)]
  return [n, m]
}
const BASES = SATELLITES.map(orbitBasis)
/** Normal of each orbit plane: the direction across the ground track, along which the swath spreads. */
const NORMALS = BASES.map(([n, m]) => norm(cross(n, m)))
const satDirection = (i: number, u: number): V3 => {
  const [n, m] = BASES[i]
  return [Math.cos(u) * n[0] + Math.sin(u) * m[0], Math.cos(u) * n[1] + Math.sin(u) * m[1], Math.cos(u) * n[2] + Math.sin(u) * m[2]]
}

// Approximate regions where satellites record the most vegetation fires (illustrative).
const FIRE_REGIONS: [number, number, number, number][] = [
  [22, 8, 7, 1.0], [24, -11, 7, 1.0], [-2, 9, 6, 0.6], [46, -18, 3, 0.25], [-50, -11, 6, 0.8], [-61, -17, 4, 0.4],
  [-68, 7, 4, 0.3], [-90, 17, 4, 0.3], [-120, 40, 4, 0.25], [-115, 57, 6, 0.3], [120, 58, 8, 0.45], [70, 50, 6, 0.25],
  [76, 30, 3, 0.3], [80, 21, 4, 0.3], [100, 18, 5, 0.6], [112, -1, 5, 0.35], [132, -15, 7, 0.7], [-4, 34, 3, 0.25],
  [6, 36, 3, 0.2], [35, 48, 5, 0.25],
]

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function decodeLand(): Float32Array {
  const bytes = Uint8Array.from(atob(LAND_DOTS), (c) => c.charCodeAt(0))
  const pairs = new Int16Array(bytes.buffer)
  const out = new Float32Array((pairs.length / 2) * 5)
  for (let i = 0, j = 0; i < pairs.length; i += 2, j += 5) {
    const lon = pairs[i] / 10
    const lat = pairs[i + 1] / 10
    const v = fromLonLat(lon, lat)
    out[j] = v[0]
    out[j + 1] = v[1]
    out[j + 2] = v[2]
    out[j + 3] = lon
    out[j + 4] = lat
  }
  return out
}

interface Fire {
  v: V3
  size: number
  flash: number
  color: string
  last: number[]
}

function makeFires(land: Float32Array): Fire[] {
  const random = seeded(2026)
  const fires: Fire[] = []
  for (const [lon, lat, spread, weight] of FIRE_REGIONS) {
    const near: number[] = []
    for (let j = 0; j < land.length; j += 5) if (Math.abs(land[j + 3] - lon) < spread && Math.abs(land[j + 4] - lat) < spread * 0.8) near.push(j)
    const count = Math.round(weight * 34)
    for (let k = 0; k < count && near.length; k++) {
      const j = near[Math.floor(random() * near.length)]
      const v = fromLonLat(land[j + 3] + (random() - 0.5) * 1.1, land[j + 4] + (random() - 0.5) * 1.1)
      // Many small fires, few large ones.
      fires.push({ v, size: Math.pow(random(), 2.6), flash: -99, color: '#ff7c40', last: SATELLITES.map(() => -99) })
    }
  }
  return fires
}

export interface GlobeCounts {
  modis: number
  viirs: number
}

export function EarthGlobe({ pins = [], onOpenPin, onCounts, label }: { pins?: GlobePin[]; onOpenPin?: (id: string) => void; onCounts?: (counts: GlobeCounts) => void; label: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pinsRef = useRef(pins)
  const openRef = useRef(onOpenPin)
  const countsRef = useRef(onCounts)
  useEffect(() => {
    pinsRef.current = pins
    openRef.current = onOpenPin
    countsRef.current = onCounts
  })

  useEffect(() => {
    const element = canvas.current
    const container = wrap.current
    const ctx = element?.getContext('2d')
    if (!element || !container || !ctx) return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const land = decodeLand()
    const fires = makeFires(land)
    const counts: GlobeCounts = { modis: 0, viirs: 0 }
    let size = 0
    let dpr = 1
    let spinOffset = START_SPIN
    let velocity = 0
    let dragging: { x: number; spin: number } | null = null
    let hits: { id: string; x: number; y: number }[] = []
    let frame = 0
    let visible = true
    let clock = 0
    let last = performance.now()

    const resize = () => {
      const width = container.clientWidth
      dpr = Math.min(2, window.devicePixelRatio || 1)
      size = width
      element.width = Math.round(width * dpr)
      element.height = Math.round(width * dpr)
      element.style.width = `${width}px`
      element.style.height = `${width}px`
    }

    // Advance the simulation: satellites move, swaths detect fires.
    const step = (t: number) => {
      const spin = (t / SPIN_SECONDS) * 2 * Math.PI + spinOffset
      const c = Math.cos(spin)
      const s = Math.sin(spin)
      SATELLITES.forEach((sat, i) => {
        const d = satDirection(i, (t / ORBIT_SECONDS) * 2 * Math.PI + sat.phase)
        const threshold = Math.cos(sat.swath)
        for (const fire of fires) {
          if (fire.size < sat.floor) continue
          const f: V3 = [fire.v[0] * c - fire.v[1] * s, fire.v[0] * s + fire.v[1] * c, fire.v[2]]
          if (dot(d, f) > threshold && t - fire.last[i] > ORBIT_SECONDS * 0.6) {
            fire.last[i] = t
            fire.flash = t
            fire.color = SENSORS[sat.key].color
            counts[sat.instrument === 'MODIS' ? 'modis' : 'viirs']++
            countsRef.current?.({ ...counts })
          }
        }
      })
      return spin
    }

    const draw = (t: number, spin: number) => {
      const W = size * dpr
      // A larger Earth on a phone, where there are no side read-outs to leave room for.
      const R = W * (size < 640 ? 0.37 : 0.3)
      const cx = W / 2
      const cy = W / 2
      const c = Math.cos(spin)
      const s = Math.sin(spin)
      const rot = (v: V3): V3 => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]
      const project = (v: V3, radius = 1): [number, number, number] => [cx + R * radius * dot(v, RIGHT), cy - R * radius * dot(v, UP), dot(v, CAMERA)]
      ctx.clearRect(0, 0, W, W)

      // Atmosphere: ember halo and a thin rim on the sunlit side.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.55)
      halo.addColorStop(0, 'rgba(255,95,31,0.22)')
      halo.addColorStop(0.35, 'rgba(255,95,31,0.07)')
      halo.addColorStop(1, 'rgba(255,95,31,0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.55, 0, Math.PI * 2)
      ctx.fill()

      // Orbits behind the Earth.
      const orbitPath = (i: number, front: boolean) => {
        const sat = SATELLITES[i]
        ctx.beginPath()
        let drawing = false
        for (let k = 0; k <= 180; k++) {
          const v = satDirection(i, (k / 180) * Math.PI * 2)
          const [x, y, z] = project(v, sat.radius)
          const show = front ? z >= 0 : z < 0
          if (show && !drawing) {
            ctx.moveTo(x, y)
            drawing = true
          } else if (show) ctx.lineTo(x, y)
          else drawing = false
        }
      }
      const drawnPlanes = new Set<string>()
      const planeKey = (sat: Satellite) => `${sat.node}:${sat.radius}`
      ctx.setLineDash([2 * dpr, 6 * dpr])
      ctx.lineWidth = 1 * dpr
      SATELLITES.forEach((sat, i) => {
        if (drawnPlanes.has(planeKey(sat))) return
        drawnPlanes.add(planeKey(sat))
        orbitPath(i, false)
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'
        ctx.stroke()
      })
      ctx.setLineDash([])

      const sats = SATELLITES.map((sat, i) => {
        const d = satDirection(i, (t / ORBIT_SECONDS) * 2 * Math.PI + sat.phase)
        const [x, y, z] = project(d, sat.radius)
        return { sat, d, x, y, z, behind: z < 0 && Math.hypot(x - cx, y - cy) < R }
      })
      const drawSatellite = (p: (typeof sats)[number]) => {
        const color = SENSORS[p.sat.key].color
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14 * dpr)
        glow.addColorStop(0, `${color}cc`)
        glow.addColorStop(1, `${color}00`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p.x, p.y, 14 * dpr, 0, Math.PI * 2)
        ctx.fill()
        // Body and solar panel.
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.fillStyle = '#e8ecf3'
        ctx.fillRect(-2.5 * dpr, -2.5 * dpr, 5 * dpr, 5 * dpr)
        ctx.fillStyle = color
        ctx.fillRect(-9 * dpr, -1.2 * dpr, 5 * dpr, 2.4 * dpr)
        ctx.fillRect(4 * dpr, -1.2 * dpr, 5 * dpr, 2.4 * dpr)
        ctx.restore()
        if (!p.behind) {
          ctx.font = `${600} ${10 * dpr}px "JetBrains Mono Variable", ui-monospace, monospace`
          ctx.fillStyle = color
          ctx.textBaseline = 'middle'
          const leftSide = p.x < cx
          ctx.textAlign = leftSide ? 'right' : 'left'
          ctx.fillText(SENSORS[p.sat.key].label.toUpperCase(), p.x + (leftSide ? -14 : 14) * dpr, p.y)
        }
      }
      sats.filter((p) => p.behind).forEach(drawSatellite)

      // The Earth: ocean, lit toward the Sun.
      const sx = dot(SUN, RIGHT)
      const sy = -dot(SUN, UP)
      const ocean = ctx.createRadialGradient(cx + sx * R * 0.45, cy + sy * R * 0.45, R * 0.05, cx, cy, R)
      ocean.addColorStop(0, '#1d2a40')
      ocean.addColorStop(0.55, '#0f1522')
      ocean.addColorStop(1, '#070910')
      ctx.fillStyle = ocean
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()

      // Graticule every 30°.
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1 * dpr
      const line = (pointAt: (k: number) => V3, steps: number) => {
        ctx.beginPath()
        let drawing = false
        for (let k = 0; k <= steps; k++) {
          const [x, y, z] = project(rot(pointAt(k)))
          if (z > 0 && drawing) ctx.lineTo(x, y)
          else if (z > 0) {
            ctx.moveTo(x, y)
            drawing = true
          } else drawing = false
        }
        ctx.stroke()
      }
      for (let lat = -60; lat <= 60; lat += 30) line((k) => fromLonLat(-180 + k * 4, lat), 90)
      for (let lon = -180; lon < 180; lon += 30) line((k) => fromLonLat(lon, -90 + k * 2), 90)

      // Land: one dot per grid point, warm in daylight, cool and dim at night, fading toward the limb.
      const day: number[][] = Array.from({ length: 8 }, () => [])
      const night: number[][] = Array.from({ length: 3 }, () => [])
      for (let j = 0; j < land.length; j += 5) {
        const v: V3 = [land[j] * c - land[j + 1] * s, land[j] * s + land[j + 1] * c, land[j + 2]]
        const z = dot(v, CAMERA)
        if (z <= 0.02) continue
        const light = dot(v, SUN)
        const limb = 0.4 + 0.6 * z
        const x = cx + R * dot(v, RIGHT)
        const y = cy - R * dot(v, UP)
        if (light > 0.02) day[Math.min(7, Math.floor((0.35 + 0.65 * light) * limb * 8))].push(x, y)
        else night[Math.min(2, Math.floor(limb * 3))].push(x, y)
      }
      const dotSize = Math.max(1.3 * dpr, R * 0.0082)
      const paint = (groups: number[][], rgb: string, top: number) =>
        groups.forEach((points, b) => {
          if (!points.length) return
          ctx.fillStyle = `rgba(${rgb},${((b + 0.6) / groups.length) * top})`
          for (let k = 0; k < points.length; k += 2) ctx.fillRect(points[k] - dotSize / 2, points[k + 1] - dotSize / 2, dotSize, dotSize)
        })
      paint(night, '120,136,166', 0.45)
      paint(day, '236,222,200', 1)

      // Night: the terminator, a soft shadow on the side away from the Sun.
      const shade = ctx.createLinearGradient(cx + sx * R, cy + sy * R, cx - sx * R, cy - sy * R)
      shade.addColorStop(0, 'rgba(4,5,9,0)')
      shade.addColorStop(0.45, 'rgba(4,5,9,0.05)')
      shade.addColorStop(1, 'rgba(4,5,9,0.7)')
      ctx.fillStyle = shade
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2)

      // Scan swaths: a luminous ribbon trailing each satellite across the ground, scan line in front.
      ctx.globalCompositeOperation = 'lighter'
      SATELLITES.forEach((sat, i) => {
        const u = (t / ORBIT_SECONDS) * 2 * Math.PI + sat.phase
        const color = SENSORS[sat.key].color
        const normal = NORMALS[i]
        const cs = Math.cos(sat.swath)
        const sn = Math.sin(sat.swath)
        const left: [number, number][] = []
        const right: [number, number][] = []
        for (let k = 0; k <= 22; k++) {
          const centre = satDirection(i, u - k * 0.035)
          if (dot(centre, CAMERA) <= 0.05) break
          const a: V3 = [cs * centre[0] + sn * normal[0], cs * centre[1] + sn * normal[1], cs * centre[2] + sn * normal[2]]
          const b: V3 = [cs * centre[0] - sn * normal[0], cs * centre[1] - sn * normal[1], cs * centre[2] - sn * normal[2]]
          const pa = project(a)
          const pb = project(b)
          left.push([pa[0], pa[1]])
          right.push([pb[0], pb[1]])
        }
        if (left.length < 2) return
        const head = project(satDirection(i, u))
        const tail = project(satDirection(i, u - (left.length - 1) * 0.035))
        const fade = ctx.createLinearGradient(head[0], head[1], tail[0], tail[1])
        fade.addColorStop(0, `${color}55`)
        fade.addColorStop(1, `${color}00`)
        ctx.fillStyle = fade
        ctx.beginPath()
        left.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1])
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 1.6 * dpr
        ctx.beginPath()
        ctx.moveTo(left[0][0], left[0][1])
        ctx.lineTo(right[0][0], right[0][1])
        ctx.stroke()
        ctx.globalAlpha = 1
      })
      ctx.globalCompositeOperation = 'source-over'

      // Fires: a dim ember until a swath passes, then a flash in the satellite's colour.
      for (const fire of fires) {
        const v = rot(fire.v)
        const z = dot(v, CAMERA)
        if (z <= 0.05) continue
        const x = cx + R * dot(v, RIGHT)
        const y = cy - R * dot(v, UP)
        const age = t - fire.flash
        const base = (0.9 + fire.size * 2.4) * dpr
        ctx.fillStyle = `rgba(255,124,64,${0.25 + 0.4 * z})`
        ctx.beginPath()
        ctx.arc(x, y, base, 0, Math.PI * 2)
        ctx.fill()
        if (age >= 0 && age < 2.4) {
          const k = age / 2.4
          ctx.strokeStyle = fire.color
          ctx.globalAlpha = (1 - k) * 0.9
          ctx.lineWidth = 1.4 * dpr
          ctx.beginPath()
          ctx.arc(x, y, base + k * 16 * dpr, 0, Math.PI * 2)
          ctx.stroke()
          const core = ctx.createRadialGradient(x, y, 0, x, y, base * 4)
          core.addColorStop(0, '#fff3e6')
          core.addColorStop(0.4, fire.color)
          core.addColorStop(1, `${fire.color}00`)
          ctx.globalAlpha = (1 - k) * 0.95
          ctx.fillStyle = core
          ctx.beginPath()
          ctx.arc(x, y, base * 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }

      // Places already analysed on the server.
      hits = []
      ctx.font = `${500} ${10.5 * dpr}px "Inter Variable", ui-sans-serif, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      // Nearby places share one region of the globe: a label that would overlap another is left out.
      const labels: [number, number, number, number][] = []
      for (const pin of pinsRef.current) {
        const v = rot(fromLonLat(pin.lon, pin.lat))
        const z = dot(v, CAMERA)
        if (z <= 0.1) continue
        const x = cx + R * dot(v, RIGHT)
        const y = cy - R * dot(v, UP)
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + pin.lon)
        ctx.strokeStyle = `rgba(255,197,163,${0.5 + 0.5 * pulse})`
        ctx.lineWidth = 1.5 * dpr
        ctx.beginPath()
        ctx.arc(x, y, (5 + pulse * 3) * dpr, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ffe4d2'
        ctx.beginPath()
        ctx.arc(x, y, 2.2 * dpr, 0, Math.PI * 2)
        ctx.fill()
        const box: [number, number, number, number] = [x + 9 * dpr, y - 8 * dpr, x + 13 * dpr + ctx.measureText(pin.label).width, y + 8 * dpr]
        if (!labels.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) {
          labels.push(box)
          ctx.fillStyle = `rgba(244,237,227,${0.55 + 0.4 * z})`
          ctx.fillText(pin.label, x + 11 * dpr, y)
        }
        hits.push({ id: pin.id, x: x / dpr, y: y / dpr })
      }
      ctx.restore()

      // Rim light.
      ctx.strokeStyle = 'rgba(255,170,120,0.22)'
      ctx.lineWidth = 1.2 * dpr
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.stroke()

      // Orbits in front, scan beams, satellites.
      ctx.setLineDash([2 * dpr, 6 * dpr])
      drawnPlanes.clear()
      SATELLITES.forEach((sat, i) => {
        if (drawnPlanes.has(planeKey(sat))) return
        drawnPlanes.add(planeKey(sat))
        orbitPath(i, true)
        ctx.strokeStyle = 'rgba(255,220,200,0.32)'
        ctx.stroke()
      })
      ctx.setLineDash([])
      for (const p of sats) {
        if (p.behind || p.z < -0.2) continue
        const [gx, gy, gz] = project(p.d)
        if (gz <= 0) continue
        const beam = ctx.createLinearGradient(p.x, p.y, gx, gy)
        const color = SENSORS[p.sat.key].color
        beam.addColorStop(0, `${color}88`)
        beam.addColorStop(1, `${color}00`)
        ctx.fillStyle = beam
        const across = NORMALS[SATELLITES.indexOf(p.sat)]
        const edge = Math.sin(p.sat.swath) * R
        const ax = dot(across, RIGHT) * edge
        const ay = -dot(across, UP) * edge
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(gx + ax, gy + ay)
        ctx.lineTo(gx - ax, gy - ay)
        ctx.closePath()
        ctx.globalAlpha = 0.35
        ctx.fill()
        ctx.globalAlpha = 1
      }
      sats.filter((p) => !p.behind).forEach(drawSatellite)
    }

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!dragging) {
        spinOffset += velocity * dt
        velocity *= Math.pow(0.04, dt)
      }
      clock += dt
      draw(clock, step(clock))
      frame = visible && !reduced ? requestAnimationFrame(loop) : 0
    }

    resize()
    if (reduced) {
      // One still frame, after a short simulated sweep so detections are visible.
      for (let t = 0; t < 22; t += 0.05) step(t)
      clock = 22
      draw(clock, step(clock))
    } else frame = requestAnimationFrame(loop)

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      resize()
      if (reduced || !frame) draw(clock, step(clock))
    }) : null
    resizeObserver?.observe(container)
    const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState === 'visible'
      if (visible && !frame && !reduced) {
        last = performance.now()
        frame = requestAnimationFrame(loop)
      }
    }) : null
    intersection?.observe(container)

    const pointer = (event: PointerEvent) => {
      const box = element.getBoundingClientRect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }
    const hitAt = (x: number, y: number) => hits.find((h) => Math.hypot(h.x - x, h.y - y) < 12)
    const down = (event: PointerEvent) => {
      dragging = { x: event.clientX, spin: spinOffset }
      element.setPointerCapture?.(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (dragging) {
        const next = dragging.spin + ((event.clientX - dragging.x) / Math.max(1, size)) * Math.PI * 1.4
        velocity = (next - spinOffset) * 30
        spinOffset = next
        if (reduced) draw(clock, step(clock))
        return
      }
      const { x, y } = pointer(event)
      element.style.cursor = hitAt(x, y) ? 'pointer' : 'grab'
    }
    const up = (event: PointerEvent) => {
      const moved = dragging && Math.abs(event.clientX - dragging.x) > 4
      dragging = null
      if (moved) return
      const { x, y } = pointer(event)
      const hit = hitAt(x, y)
      if (hit) openRef.current?.(hit.id)
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', () => (dragging = null))

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      intersection?.disconnect()
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
    }
  }, [])

  return (
    <div ref={wrap} className="relative aspect-square w-full">
      <canvas ref={canvas} className="absolute inset-0 block touch-pan-y" role="img" aria-label={label} style={{ cursor: 'grab' }} />
    </div>
  )
}
