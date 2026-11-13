import { isLand } from './landMask'

/**
 * Decorative "overpass" scene for the analysis preparation state: a dot-matrix Earth centred on the
 * study area while polar-orbiting satellites sweep their swaths across it and illustrative fire pixels
 * flare inside the scanned band. Nothing here is live data or represents analysis progress.
 */

export type OverpassSatellite = {
  instrument: string
  color: string
  /** Real cross-track swath width, used for the illustrated footprint. */
  swathKm: number
  /** Illustrated fire-pixel edge in CSS px (MODIS 1 km pixels draw larger than VIIRS 375 m). */
  pixel: number
  /** Seconds per illustrated orbit. */
  period: number
  phase: number
  /** Apparent inclination offset of the near-polar track, radians. */
  tilt: number
  /** Orbit radius in globe radii (exaggerated for legibility). */
  altitude: number
  /** Slow drift of the ground track across the visible disc. */
  sweep: { amplitude: number; period: number; phase: number }
}

export type OverpassTarget = { lat: number; lon: number; rings: [number, number][][]; label?: string }
export type OverpassTone = 'normal' | 'warn'
export type OverpassScene = { setTone: (tone: OverpassTone) => void; destroy: () => void }

type Rgb = [number, number, number]
type Vec = [number, number, number]
type Geometry = { type: string; coordinates: unknown }

const TAU = Math.PI * 2
const DEG = Math.PI / 180
const EARTH_RADIUS_KM = 6371
const DOT_COUNT = 16000
const AFTERGLOW = 1.15
const HOT_LIFE = 4.2
const INTRO = 2.6
const ORBIT_STEPS = 120
const TRAIL_STEPS = 22
const TRAIL_ARC = 0.95
const EMBER: Rgb = [255, 124, 64]
const WARN: Rgb = [251, 191, 36]
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const easeOut = (value: number) => 1 - Math.pow(1 - clamp(value), 3)
const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${r},${g},${b},${clamp(alpha).toFixed(3)})`
function hexRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return Number.isFinite(value) ? [(value >> 16) & 255, (value >> 8) & 255, value & 255] : EMBER
}
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function ecef(lat: number, lon: number): Vec {
  const c = Math.cos(lat * DEG)
  return [c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG)]
}

/** Loose fire-climatology weighting so flares favour savannas and boreal belts, never ice sheets. */
function fireWeight(lat: number, lon: number) {
  if (lat < -58 || (lat > 59 && lon > -75 && lon < -10)) return 0
  const a = Math.abs(lat)
  if (a < 18) return 0.1
  if (a < 35) return 0.045
  if (a < 48) return 0.05
  if (lat > 50 && lat < 68) return 0.07
  return 0.012
}

type Globe = { count: number; xyz: Float64Array; fire: Uint8Array; graticule: Vec[][] }
let globe: Globe | undefined
function buildGlobe(): Globe {
  if (globe) return globe
  const random = seeded(2000)
  const xyz: number[] = []
  const fire: number[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < DOT_COUNT; i++) {
    const s = 1 - (2 * i + 1) / DOT_COUNT
    const lat = Math.asin(s) / DEG
    const lon = ((((i * golden) / DEG) % 360) + 360) % 360 - 180
    if (!isLand(lat, lon)) continue
    xyz.push(...ecef(lat, lon))
    fire.push(random() < fireWeight(lat, lon) ? 1 : 0)
  }
  const graticule: Vec[][] = []
  for (let lon = -180; lon < 180; lon += 30) graticule.push(Array.from({ length: 41 }, (_, k) => ecef(-80 + k * 4, lon)))
  for (const lat of [-60, -30, 0, 30, 60]) graticule.push(Array.from({ length: 91 }, (_, k) => ecef(lat, -180 + k * 4)))
  globe = { count: fire.length, xyz: Float64Array.from(xyz), fire: Uint8Array.from(fire), graticule }
  return globe
}

/** Centre and outline of a saved study area (bounding-box centre, antimeridian-safe). */
export function overpassTarget(geometry: Geometry | null | undefined, label?: string): OverpassTarget | undefined {
  if (!geometry || !Array.isArray(geometry.coordinates)) return undefined
  const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []) as unknown[]
  const rings: [number, number][][] = []
  for (const polygon of polygons) {
    const outer = Array.isArray(polygon) ? polygon[0] : undefined
    if (!Array.isArray(outer)) continue
    const ring = outer.filter((point): point is [number, number] =>
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(([lon, lat]) => [lon, lat] as [number, number])
    if (ring.length >= 3) rings.push(ring)
  }
  if (!rings.length) return undefined
  const reference = rings[0][0][0]
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
  for (const ring of rings) for (const [lon, lat] of ring) {
    const unwrapped = lon + 360 * Math.round((reference - lon) / 360)
    west = Math.min(west, unwrapped); east = Math.max(east, unwrapped)
    south = Math.min(south, lat); north = Math.max(north, lat)
  }
  const lon = ((((west + east) / 2 + 180) % 360) + 360) % 360 - 180
  return { lat: clamp((south + north) / 2, -90, 90), lon, rings, label }
}

export function startOverpassScene(
  canvas: HTMLCanvasElement,
  { satellites, target, reducedMotion }: { satellites: OverpassSatellite[]; target?: OverpassTarget; reducedMotion: boolean },
): OverpassScene | null {
  let context: CanvasRenderingContext2D | null = null
  try { context = canvas.getContext('2d') } catch { context = null }
  if (!context) return null
  const c = context
  const g = buildGlobe()
  const view = new Float64Array(g.count * 3)
  const scans = satellites.map(() => new Float64Array(g.count).fill(-1e4))
  const hotAt = new Float64Array(g.count).fill(-1e4)
  const hotBy = new Uint8Array(g.count)
  const sats = satellites.map(s => ({ ...s, rgb: hexRgb(s.color), half: s.swathKm / 2 / EARTH_RADIUS_KM, cosHalf: Math.cos(s.swathKm / 2 / EARTH_RADIUS_KM) }))
  const random = seeded(2026)
  const stars = Array.from({ length: 70 }, () => ({ x: random(), y: random(), r: 0.4 + random() * 0.9, a: 0.12 + random() * 0.5, w: 0.4 + random() * 1.6, p: random() * TAU }))
  const targetXyz = target ? ecef(target.lat, target.lon) : undefined
  const targetRings = target?.rings.map(ring => ring.map(([lon, lat]) => ecef(lat, lon))) ?? []
  const centreLat = target ? clamp(target.lat * 0.85, -52, 52) : 18
  const centreLon = target ? target.lon : 12
  const sprite = glowSprite()
  const buckets: number[][] = Array.from({ length: 8 }, () => [])
  const lit: number[] = []
  let tone: OverpassTone = 'normal'
  let width = 1, height = 1, dpr = 1
  let clock = 0, last = 0, frameId = 0, visible = true, destroyed = false
  let cam = { sl: 0, cl: 1, sp: 0, cp: 1 }

  const toView = (x: number, y: number, z: number): Vec => {
    const e = cam.cl * x + cam.sl * y
    return [-cam.sl * x + cam.cl * y, cam.cp * z - cam.sp * e, cam.sp * z + cam.cp * e]
  }
  const orbitFrame = (s: (typeof sats)[number], t: number) => {
    const sweep = s.sweep.amplitude * Math.sin((TAU * t) / s.sweep.period + s.sweep.phase)
    const sa = Math.sin(sweep), st = Math.sin(s.tilt), ct = Math.cos(s.tilt)
    return { u: [sa * ct, sa * st, Math.cos(sweep)] as Vec, v: [-st, ct, 0] as Vec, theta: (TAU * t) / s.period + s.phase }
  }
  const onOrbit = ({ u, v }: { u: Vec; v: Vec }, theta: number): Vec => {
    const cs = Math.cos(theta), sn = Math.sin(theta)
    return [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn]
  }

  function step(t: number) {
    const intro = reducedMotion ? 1 : easeOut(t / INTRO)
    const lon = (centreLon + (1 - intro) * 110 + 7 * Math.sin(t * 0.06) * intro) * DEG
    const lat = (centreLat - (1 - intro) * 14 + 2.5 * Math.sin(t * 0.045) * intro) * DEG
    cam = { sl: Math.sin(lon), cl: Math.cos(lon), sp: Math.sin(lat), cp: Math.cos(lat) }
    for (let i = 0; i < g.count; i++) {
      const [x, y, z] = toView(g.xyz[i * 3], g.xyz[i * 3 + 1], g.xyz[i * 3 + 2])
      view[i * 3] = x; view[i * 3 + 1] = y; view[i * 3 + 2] = z
    }
    sats.forEach((s, k) => {
      const frame = orbitFrame(s, t)
      const n = onOrbit(frame, frame.theta)
      const scanned = scans[k]
      for (let i = 0; i < g.count; i++) {
        if (view[i * 3] * n[0] + view[i * 3 + 1] * n[1] + view[i * 3 + 2] * n[2] < s.cosHalf) continue
        if (g.fire[i] && t - scanned[i] > 0.8 && random() < 0.7) { hotAt[i] = t; hotBy[i] = k }
        scanned[i] = t
      }
    })
  }

  function draw(t: number) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, width, height)
    const fade = reducedMotion ? 1 : easeOut(t / 0.9)
    const cx = width / 2, cy = height / 2
    const R = Math.min(width, height) * 0.33 * (0.94 + 0.06 * fade)

    c.fillStyle = '#dbe7ff'
    for (const s of stars) {
      c.globalAlpha = s.a * (reducedMotion ? 0.8 : 0.6 + 0.4 * Math.sin(t * s.w + s.p))
      c.fillRect(s.x * width, s.y * height, s.r, s.r)
    }
    c.globalAlpha = fade
    const atmosphere = c.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.3)
    atmosphere.addColorStop(0, 'rgba(56,198,244,0.24)')
    atmosphere.addColorStop(0.35, 'rgba(56,198,244,0.07)')
    atmosphere.addColorStop(1, 'rgba(56,198,244,0)')
    c.fillStyle = atmosphere
    c.beginPath(); c.arc(cx, cy, R * 1.3, 0, TAU); c.fill()

    const frames = sats.map(s => orbitFrame(s, t))
    const subPoints = frames.map(frame => onOrbit(frame, frame.theta))
    sats.forEach((s, k) => drawOrbit(s, frames[k], false, cx, cy, R, fade))

    // Globe body, graticule and land.
    const ocean = c.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R)
    ocean.addColorStop(0, '#163a4a'); ocean.addColorStop(0.55, '#0c2230'); ocean.addColorStop(1, '#061019')
    c.fillStyle = ocean
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill()
    c.strokeStyle = 'rgba(140,190,200,0.08)'; c.lineWidth = 0.6
    c.beginPath()
    for (const line of g.graticule) {
      let pen = false
      for (const [x, y, z] of line) {
        const p = toView(x, y, z)
        if (p[2] <= 0) { pen = false; continue }
        if (pen) c.lineTo(cx + R * p[0], cy - R * p[1]); else c.moveTo(cx + R * p[0], cy - R * p[1])
        pen = true
      }
    }
    c.stroke()

    const size = Math.max(1, R * 0.0125)
    buckets.forEach(bucket => { bucket.length = 0 })
    lit.length = 0
    for (let i = 0; i < g.count; i++) {
      const z = view[i * 3 + 2]
      if (z <= 0) continue
      const x = cx + R * view[i * 3], y = cy - R * view[i * 3 + 1]
      const limb = Math.pow(z, 0.75)
      let best = 0, bestK = 0
      for (let k = 0; k < sats.length; k++) {
        const age = t - scans[k][i]
        if (age > AFTERGLOW * 4) continue
        const glow = Math.exp(-age / AFTERGLOW)
        if (glow > best) { best = glow; bestK = k }
      }
      if (best > 0.04) lit.push(x, y, bestK, best * (0.3 + 0.7 * limb))
      else buckets[Math.min(7, Math.floor(limb * 8))].push(x, y, size * (0.45 + 0.55 * Math.sqrt(z)))
    }
    c.fillStyle = '#9db8bf'
    buckets.forEach((bucket, b) => {
      if (!bucket.length) return
      c.globalAlpha = fade * (0.08 + (0.7 * (b + 0.5)) / 8)
      c.beginPath()
      for (let j = 0; j < bucket.length; j += 3) c.rect(bucket[j] - bucket[j + 2] / 2, bucket[j + 1] - bucket[j + 2] / 2, bucket[j + 2], bucket[j + 2])
      c.fill()
    })
    const litSize = size * 1.25
    sats.forEach((s, k) => {
      c.fillStyle = rgba(s.rgb, 1)
      for (let j = 0; j < lit.length; j += 4) {
        if (lit[j + 2] !== k) continue
        c.globalAlpha = fade * (0.25 + 0.75 * lit[j + 3])
        c.fillRect(lit[j] - litSize / 2, lit[j + 1] - litSize / 2, litSize, litSize)
      }
    })
    c.globalAlpha = fade

    // Day-side light and atmospheric rim.
    c.save()
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip()
    const shade = c.createRadialGradient(cx - R * 0.45, cy - R * 0.5, R * 0.1, cx - R * 0.2, cy - R * 0.2, R * 1.55)
    shade.addColorStop(0, 'rgba(255,255,255,0.05)'); shade.addColorStop(0.55, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(1,3,7,0.62)')
    c.fillStyle = shade
    c.fillRect(cx - R, cy - R, R * 2, R * 2)
    c.restore()
    const rim = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
    rim.addColorStop(0, 'rgba(130,225,255,0.6)'); rim.addColorStop(0.5, 'rgba(56,198,244,0.16)'); rim.addColorStop(1, 'rgba(56,198,244,0.04)')
    c.strokeStyle = rim; c.lineWidth = 1.2
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke()

    sats.forEach((s, k) => drawBeam(s, frames[k], subPoints[k], t, k, cx, cy, R, fade))
    drawHotspots(t, cx, cy, R, fade)
    drawTarget(t, subPoints, cx, cy, R)
    sats.forEach((s, k) => drawOrbit(s, frames[k], true, cx, cy, R, fade))
    c.globalAlpha = 1
  }

  function drawOrbit(s: (typeof sats)[number], frame: ReturnType<typeof orbitFrame>, front: boolean, cx: number, cy: number, R: number, fade: number) {
    const r = R * s.altitude
    c.globalAlpha = fade
    c.setLineDash([1.5, 4]); c.lineWidth = 1
    c.strokeStyle = rgba(s.rgb, front ? 0.34 : 0.13)
    c.beginPath()
    let pen = false
    for (let k = 0; k <= ORBIT_STEPS; k++) {
      const p = onOrbit(frame, (k / ORBIT_STEPS) * TAU)
      if ((p[2] >= 0) !== front) { pen = false; continue }
      if (pen) c.lineTo(cx + r * p[0], cy - r * p[1]); else c.moveTo(cx + r * p[0], cy - r * p[1])
      pen = true
    }
    c.stroke(); c.setLineDash([])
    c.lineWidth = 1.7; c.lineCap = 'round'
    for (let k = 0; k < TRAIL_STEPS; k++) {
      const a = onOrbit(frame, frame.theta - TRAIL_ARC * (1 - k / TRAIL_STEPS))
      const b = onOrbit(frame, frame.theta - TRAIL_ARC * (1 - (k + 1) / TRAIL_STEPS))
      if ((a[2] + b[2] >= 0) !== front) continue
      c.strokeStyle = rgba(s.rgb, 0.9 * Math.pow((k + 1) / TRAIL_STEPS, 1.8))
      c.beginPath(); c.moveTo(cx + r * a[0], cy - r * a[1]); c.lineTo(cx + r * b[0], cy - r * b[1]); c.stroke()
    }
    const n = onOrbit(frame, frame.theta)
    if ((n[2] >= 0) !== front) return
    const x = cx + r * n[0], y = cy - r * n[1]
    const scale = 0.9 + 0.2 * n[2]
    const halo = c.createRadialGradient(x, y, 0, x, y, 13 * scale)
    halo.addColorStop(0, rgba(s.rgb, 0.55)); halo.addColorStop(1, rgba(s.rgb, 0))
    c.fillStyle = halo
    c.beginPath(); c.arc(x, y, 13 * scale, 0, TAU); c.fill()
    const velocity = onOrbit(frame, frame.theta + Math.PI / 2)
    c.save()
    c.translate(x, y); c.rotate(Math.atan2(-velocity[1], velocity[0])); c.scale(scale, scale)
    c.fillStyle = rgba(s.rgb, 0.92)
    c.fillRect(-1.5, -9, 3, 5.6); c.fillRect(-1.5, 3.4, 3, 5.6)
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.6
    c.beginPath(); c.moveTo(0, -3.4); c.lineTo(0, 3.4); c.stroke()
    c.fillStyle = '#f6efe2'
    c.fillRect(-2.5, -1.9, 5, 3.8)
    c.restore()
    if (front) {
      c.save()
      c.shadowColor = 'rgba(2,6,10,0.95)'; c.shadowBlur = 5
      c.font = `600 9px ${MONO}`; c.textAlign = 'left'
      c.fillStyle = rgba(s.rgb, 0.95)
      c.fillText(s.instrument, x + 11, y - 8)
      c.restore()
    }
  }

  function drawBeam(s: (typeof sats)[number], frame: ReturnType<typeof orbitFrame>, n: Vec, t: number, k: number, cx: number, cy: number, R: number, fade: number) {
    if (n[2] < 0.05) return
    const along = onOrbit(frame, frame.theta + Math.PI / 2)
    const cross: Vec = [n[1] * along[2] - n[2] * along[1], n[2] * along[0] - n[0] * along[2], n[0] * along[1] - n[1] * along[0]]
    const at = (angle: number): Vec => {
      const cs = Math.cos(angle), sn = Math.sin(angle)
      return [n[0] * cs + cross[0] * sn, n[1] * cs + cross[1] * sn, n[2] * cs + cross[2] * sn]
    }
    const r = R * s.altitude
    const sx = cx + r * n[0], sy = cy - r * n[1]
    const left = at(-s.half), right = at(s.half)
    const lx = cx + R * left[0], ly = cy - R * left[1], rx = cx + R * right[0], ry = cy - R * right[1]
    c.globalAlpha = fade * clamp(n[2] * 4)
    const beam = c.createLinearGradient(sx, sy, (lx + rx) / 2, (ly + ry) / 2)
    beam.addColorStop(0, rgba(s.rgb, 0.32)); beam.addColorStop(1, rgba(s.rgb, 0.03))
    c.fillStyle = beam
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(lx, ly); c.lineTo(rx, ry); c.closePath(); c.fill()
    // Whisk-broom scan line across the swath, with the mirror's instantaneous footprint.
    c.strokeStyle = rgba(s.rgb, 0.8); c.lineWidth = 1.1
    c.beginPath()
    for (let j = 0; j <= 12; j++) {
      const p = at(-s.half + (2 * s.half * j) / 12)
      if (j) c.lineTo(cx + R * p[0], cy - R * p[1]); else c.moveTo(cx + R * p[0], cy - R * p[1])
    }
    c.stroke()
    const mirror = at(s.half * (reducedMotion ? 0.4 : Math.sin(t * TAU * 1.4 + k * 2)))
    c.fillStyle = '#ffffff'
    c.beginPath(); c.arc(cx + R * mirror[0], cy - R * mirror[1], 1.6, 0, TAU); c.fill()
  }

  function drawHotspots(t: number, cx: number, cy: number, R: number, fade: number) {
    c.globalCompositeOperation = 'lighter'
    const radius = R * 0.11
    for (let i = 0; i < g.count; i++) {
      const age = t - hotAt[i]
      const z = view[i * 3 + 2]
      if (age > HOT_LIFE || age < 0 || z <= 0.02) continue
      const envelope = age < 0.15 ? age / 0.15 : Math.exp(-(age - 0.15) / 1.4)
      const flicker = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(t * 17 + i)
      const intensity = Math.min(1, 1.25 * envelope * flicker * (0.4 + 0.6 * z)) * fade
      const x = cx + R * view[i * 3], y = cy - R * view[i * 3 + 1]
      c.globalAlpha = intensity
      if (sprite) c.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2)
      const s = sats[hotBy[i]]
      const pixel = s.pixel * (0.6 + 0.4 * z)
      c.fillStyle = '#ffd9a0'
      c.fillRect(x - pixel / 2, y - pixel / 2, pixel, pixel)
      if (age < 0.7) {
        c.globalAlpha = (1 - age / 0.7) * fade
        c.strokeStyle = rgba(s.rgb, 1); c.lineWidth = 0.8
        c.strokeRect(x - pixel, y - pixel, pixel * 2, pixel * 2)
      }
    }
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = fade
  }

  function drawTarget(t: number, subPoints: Vec[], cx: number, cy: number, R: number) {
    if (!targetXyz) return
    const p = toView(...targetXyz)
    const reveal = reducedMotion ? 1 : clamp((t - 1.8) / 0.7)
    if (p[2] < 0.08 || reveal <= 0) return
    const tx = cx + R * p[0], ty = cy - R * p[1]
    let passing = -1
    sats.forEach((s, k) => {
      const n = subPoints[k]
      if (p[0] * n[0] + p[1] * n[1] + p[2] * n[2] > s.cosHalf) passing = k
    })
    const color = passing >= 0 ? sats[passing].rgb : tone === 'warn' ? WARN : EMBER
    let half = 9
    c.globalAlpha = reveal
    c.beginPath()
    for (const ring of targetRings) {
      ring.forEach(([x, y, z], j) => {
        const q = toView(x, y, z)
        const px = cx + R * q[0], py = cy - R * q[1]
        half = Math.max(half, Math.abs(px - tx) + 5, Math.abs(py - ty) + 5)
        if (j) c.lineTo(px, py); else c.moveTo(px, py)
      })
      c.closePath()
    }
    c.fillStyle = rgba(EMBER, 0.24); c.fill()
    c.strokeStyle = rgba(EMBER, 0.9); c.lineWidth = 1; c.stroke()
    half = Math.min(half, R * 0.5)
    const pulse = reducedMotion ? 0.35 : (t % 2.4) / 2.4
    c.strokeStyle = rgba(color, 0.55 * (1 - pulse) * reveal); c.lineWidth = 1
    c.beginPath(); c.arc(tx, ty, half * (0.7 + 1.6 * pulse), 0, TAU); c.stroke()
    const k = half * (1 + 1.4 * (1 - easeOut(reveal)))
    const arm = Math.min(6, k * 0.6)
    c.strokeStyle = rgba(color, reveal); c.lineWidth = 1.4; c.lineCap = 'square'
    c.beginPath()
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.moveTo(tx + dx * k, ty + dy * (k - arm)); c.lineTo(tx + dx * k, ty + dy * k); c.lineTo(tx + dx * (k - arm), ty + dy * k)
    }
    c.stroke()
    c.fillStyle = rgba(color, reveal)
    c.beginPath(); c.arc(tx, ty, 1.6, 0, TAU); c.fill()
    const dir = tx + k + 120 > width ? -1 : 1
    const ly = Math.max(16, ty - k - 12)
    const lx = tx + dir * (k + 12)
    c.strokeStyle = rgba(color, 0.7 * reveal); c.lineWidth = 0.8
    c.beginPath(); c.moveTo(tx + dir * k, ty - k); c.lineTo(lx, ly); c.lineTo(lx + dir * 14, ly); c.stroke()
    c.save()
    c.shadowColor = 'rgba(2,6,10,0.95)'; c.shadowBlur = 6
    c.textAlign = dir > 0 ? 'left' : 'right'
    c.font = `600 9px ${MONO}`
    c.fillStyle = rgba(color, reveal)
    c.fillText(passing >= 0 ? `${sats[passing].instrument} OVERPASS` : 'STUDY AREA', lx + dir * 18, ly + 3)
    if (target?.label) {
      const label = target.label.length > 26 ? `${target.label.slice(0, 25)}…` : target.label
      c.font = `500 10px ${MONO}`
      c.fillStyle = `rgba(233,237,242,${(0.85 * reveal).toFixed(3)})`
      c.fillText(label, lx + dir * 18, ly + 16)
    }
    c.restore()
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = Math.max(1, rect.width); height = Math.max(1, rect.height)
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
  }
  function frame(now: number) {
    frameId = 0
    if (destroyed) return
    clock += last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    step(clock)
    draw(clock)
    if (visible) frameId = requestAnimationFrame(frame)
  }
  function resume() {
    if (reducedMotion || destroyed || frameId || !visible) return
    last = 0
    frameId = requestAnimationFrame(frame)
  }

  resize()
  if (reducedMotion) {
    // One still frame that already shows a scanned swath and a few flares.
    for (let t = 4; t <= 7.5; t += 1 / 30) step(t)
    clock = 7.5
    draw(clock)
  }
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { resize(); if (reducedMotion || !visible) draw(clock) }) : undefined
  resizer?.observe(canvas)
  const watcher = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) resume()
    else if (frameId) { cancelAnimationFrame(frameId); frameId = 0 }
  }) : undefined
  watcher?.observe(canvas)
  resume()

  return {
    setTone(next) {
      tone = next
      if (reducedMotion) draw(clock)
    },
    destroy() {
      destroyed = true
      if (frameId) cancelAnimationFrame(frameId)
      resizer?.disconnect()
      watcher?.disconnect()
    },
  }
}

function glowSprite() {
  if (typeof document === 'undefined') return undefined
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 64
  const c = sprite.getContext('2d')
  if (!c) return undefined
  const glow = c.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.addColorStop(0, 'rgba(255,220,160,1)')
  glow.addColorStop(0.25, 'rgba(255,124,64,0.75)')
  glow.addColorStop(0.6, 'rgba(232,74,16,0.22)')
  glow.addColorStop(1, 'rgba(232,74,16,0)')
  c.fillStyle = glow
  c.fillRect(0, 0, 64, 64)
  return sprite
}
