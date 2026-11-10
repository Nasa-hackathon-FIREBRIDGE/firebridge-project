import type { SensorKey } from '../../../lib/sensors.ts'
import type { Observation } from './prepare.ts'

export interface Episode {
  id: string
  start: string
  end: string
  durationHours: number
  detections: number
  /** Distinct satellite overpasses (sensor × acquisition minute) that recorded it. */
  passes: number
  bySensor: Partial<Record<SensorKey, number>>
  maxFrp: number | null
  lon: number
  lat: number
  bbox: [number, number, number, number]
  modis: boolean
  viirs: boolean
}

export interface EpisodeSummary {
  linkMetres: number
  linkHours: number
  detections: number
  count: number
  singletons: number
  multiDay: number
  withModis: number
  viirsOnly: number
  modisOnly: number
  /** VIIRS-only clusters whose peak FRP is below the measured MODIS floor (set by the engine). */
  viirsOnlyBelowFloor: number | null
  /** Largest first, by detections then passes. */
  top: Episode[]
  /** All episodes, chronological (for timelines). */
  all: Episode[]
}

/**
 * Chain detections that are at most `linkMetres` apart and at most `linkHours` apart into
 * detection clusters (single-linkage, union-find over a space-time hash). A cluster is a
 * spatio-temporal group of satellite detections, not a confirmed fire incident: one fire can
 * split into several clusters and neighbouring fires can merge.
 */
export function detectEpisodes(observations: readonly Observation[], linkMetres = 2000, linkHours = 24, topN = 12): EpisodeSummary {
  const n = observations.length
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const window = linkHours * 3_600_000
  const buckets = new Map<string, number[]>()
  const key = (gx: number, gy: number, gt: number) => `${gx}:${gy}:${gt}`
  for (let i = 0; i < n; i++) {
    const o = observations[i]
    const gx = Math.floor(o.x / linkMetres)
    const gy = Math.floor(o.y / linkMetres)
    const gt = Math.floor(o.t / window)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dt = -1; dt <= 1; dt++) {
          const bucket = buckets.get(key(gx + dx, gy + dy, gt + dt))
          if (!bucket) continue
          for (const j of bucket) {
            const p = observations[j]
            if (Math.abs(p.t - o.t) <= window && Math.hypot(p.x - o.x, p.y - o.y) <= linkMetres) {
              const a = find(i)
              const b = find(j)
              if (a !== b) parent[a] = b
            }
          }
        }
    const own = key(gx, gy, gt)
    const bucket = buckets.get(own)
    if (bucket) bucket.push(i)
    else buckets.set(own, [i])
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(i)
    else groups.set(root, [i])
  }
  const all: Episode[] = []
  for (const members of groups.values()) {
    let first = Infinity
    let last = -Infinity
    let peak: number | null = null
    let sumLon = 0
    let sumLat = 0
    const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
    const bySensor: Partial<Record<SensorKey, number>> = {}
    const passes = new Set<string>()
    for (const i of members) {
      const o = observations[i]
      first = Math.min(first, o.t)
      last = Math.max(last, o.t)
      if (o.frp !== null) peak = Math.max(peak ?? 0, o.frp)
      sumLon += o.lon
      sumLat += o.lat
      bbox[0] = Math.min(bbox[0], o.lon)
      bbox[1] = Math.min(bbox[1], o.lat)
      bbox[2] = Math.max(bbox[2], o.lon)
      bbox[3] = Math.max(bbox[3], o.lat)
      bySensor[o.sensor] = (bySensor[o.sensor] ?? 0) + 1
      passes.add(`${o.sensor}:${Math.floor(o.t / 60_000)}`)
    }
    const sensors = Object.keys(bySensor) as SensorKey[]
    all.push({
      id: '',
      start: new Date(first).toISOString(),
      end: new Date(last).toISOString(),
      durationHours: (last - first) / 3_600_000,
      detections: members.length,
      passes: passes.size,
      bySensor,
      maxFrp: peak,
      lon: sumLon / members.length,
      lat: sumLat / members.length,
      bbox,
      modis: sensors.some((s) => s === 'terra' || s === 'aqua'),
      viirs: sensors.some((s) => s === 'snpp' || s === 'noaa20' || s === 'noaa21'),
    })
  }
  all.sort((a, b) => a.start.localeCompare(b.start) || a.lon - b.lon)
  all.forEach((episode, i) => (episode.id = `E${String(i + 1).padStart(4, '0')}`))
  const top = [...all].sort((a, b) => b.detections - a.detections || b.passes - a.passes).slice(0, topN)
  return {
    linkMetres,
    linkHours,
    detections: n,
    count: all.length,
    singletons: all.filter((e) => e.detections === 1).length,
    multiDay: all.filter((e) => e.durationHours >= 24).length,
    withModis: all.filter((e) => e.modis).length,
    viirsOnly: all.filter((e) => e.viirs && !e.modis).length,
    modisOnly: all.filter((e) => e.modis && !e.viirs).length,
    viirsOnlyBelowFloor: null,
    top,
    all,
  }
}
