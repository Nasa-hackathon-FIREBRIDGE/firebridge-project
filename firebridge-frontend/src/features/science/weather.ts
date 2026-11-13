import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BridgeReport } from '../bridge/engine/index.ts'
import { seededRandom } from '../bridge/engine/stats.ts'

/**
 * Weather beside fire. NASA POWER serves daily MERRA-2 meteorology for any point on Earth
 * (open CORS, no key); FIREBRIDGE reads it at the centre of the analysis's fire activity and asks
 * whether months that were hotter or drier than usual for their time of year also burned more.
 */

export interface WeatherMonth {
  month: string
  /** Mean daily maximum temperature at 2 m, °C. */
  tmax: number
  /** Total precipitation, mm. */
  rain: number
}

const POWER = 'https://power.larc.nasa.gov/api/temporal/daily/point'
const FILL = -999

const ymd = (date: string) => date.replaceAll('-', '')

/** Daily NASA POWER values, aggregated to calendar months with at least 20 valid days. */
export async function fetchPowerMonths(lat: number, lon: number, start: string, endExclusive: string, signal?: AbortSignal): Promise<WeatherMonth[]> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const lastDay = new Date(Date.parse(`${endExclusive.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const end = lastDay < yesterday ? lastDay : yesterday
  const url = `${POWER}?parameters=T2M_MAX,PRECTOTCORR&community=AG&latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start=${ymd(start.slice(0, 10))}&end=${ymd(end)}&format=JSON`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`NASA POWER answered ${response.status}`)
  const body = (await response.json()) as { properties?: { parameter?: Record<string, Record<string, number>> } }
  const parameter = body.properties?.parameter
  if (!parameter?.T2M_MAX || !parameter.PRECTOTCORR) throw new Error('NASA POWER returned no daily values')
  return aggregateDaily(parameter.T2M_MAX, parameter.PRECTOTCORR)
}

export function aggregateDaily(tmax: Record<string, number>, rain: Record<string, number>): WeatherMonth[] {
  const months = new Map<string, { t: number[]; r: number[]; days: number }>()
  for (const [day, value] of Object.entries(tmax)) {
    const month = `${day.slice(0, 4)}-${day.slice(4, 6)}`
    const entry = months.get(month) ?? { t: [], r: [], days: new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)), 0)).getUTCDate() }
    if (value !== FILL && Number.isFinite(value)) entry.t.push(value)
    const r = rain[day]
    if (r !== undefined && r !== FILL && Number.isFinite(r)) entry.r.push(r)
    months.set(month, entry)
  }
  return [...months.entries()]
    .filter(([, e]) => e.t.length >= 20 && e.r.length >= 20)
    .map(([month, e]) => ({ month, tmax: e.t.reduce((a, b) => a + b, 0) / e.t.length, rain: (e.r.reduce((a, b) => a + b, 0) / e.r.length) * e.days }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// ── Statistics ─────────────────────────────────────────────────────────────────────────────────

function ranks(values: readonly number[]) {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(values.length)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1
    i = j + 1
  }
  return out
}

function pearson(a: readonly number[], b: readonly number[]) {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb)
    va += (a[i] - ma) ** 2
    vb += (b[i] - mb) ** 2
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0
}

export interface Correlation {
  rho: number
  /** Two-sided permutation p-value (2,000 shuffles, fixed seed: reproducible). */
  p: number
  n: number
}

/** Spearman rank correlation with a permutation test, which assumes no distribution. */
export function spearman(x: readonly number[], y: readonly number[], permutations = 2000): Correlation | null {
  const n = x.length
  if (n < 8 || y.length !== n) return null
  const rx = ranks(x)
  const ry = ranks(y)
  const rho = pearson(rx, ry)
  const random = seededRandom(20261113)
  const shuffled = [...ry]
  let extreme = 0
  for (let k = 0; k < permutations; k++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (Math.abs(pearson(rx, shuffled)) >= Math.abs(rho) - 1e-12) extreme++
  }
  return { rho, p: (extreme + 1) / (permutations + 1), n }
}

// ── Evidence ───────────────────────────────────────────────────────────────────────────────────

export interface WeatherAnomaly {
  month: string
  tmax: number
  /** °C above (+) or below (−) the same calendar month's mean in the other years. */
  heat: number | null
  /** Rain over this month and the two before it, mm. */
  rain3: number | null
  /** rain3 as a share of the same window's mean in the other years (1 = usual). */
  wetness: number | null
  /** Fire anomaly of the month (spreads): harmonized record, else the satellites' consensus. */
  fire: number | null
}

export interface WeatherEvidence {
  point: { lat: number; lon: number }
  months: WeatherAnomaly[]
  heat: Correlation | null
  dryness: Correlation | null
  /** The same tests inside the fire season only (the four busiest calendar months). */
  seasonHeat: Correlation | null
  seasonDryness: Correlation | null
  /** Unusually busy months that were clearly hotter (≥ +0.5 °C) or drier (≤ 80% of usual rain). */
  busy: { months: string[]; matching: string[] } | null
  /** Unusually quiet months that were clearly cooler (≤ −0.5 °C) or wetter (≥ 125% of usual rain). */
  quiet: { months: string[]; matching: string[] } | null
}

export const HOT = 0.5
export const DRY = 0.8
export const WET = 1.25

const shift = (month: string, delta: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function weatherEvidence(report: BridgeReport, weather: readonly WeatherMonth[], point: { lat: number; lon: number }): WeatherEvidence {
  const byMonth = new Map(weather.map((w) => [w.month, w]))
  const rain3 = (month: string) => {
    const window = [0, -1, -2].map((d) => byMonth.get(shift(month, d)))
    return window.every(Boolean) ? window.reduce((sum, w) => sum + w!.rain, 0) : null
  }
  const usual = (month: string, pick: (m: string) => number | null) => {
    const others = weather.filter((w) => w.month.slice(5, 7) === month.slice(5, 7) && w.month !== month).map((w) => pick(w.month)).filter((v): v is number => v !== null)
    return others.length >= 2 ? others.reduce((a, b) => a + b, 0) / others.length : null
  }
  const anomalies = new Map(report.anomalies.months.map((a) => [a.month, a]))
  const months: WeatherAnomaly[] = weather.map((w) => {
    const a = anomalies.get(w.month)
    const usualT = usual(w.month, (m) => byMonth.get(m)?.tmax ?? null)
    const r3 = rain3(w.month)
    const usualR = usual(w.month, rain3)
    return {
      month: w.month,
      tmax: w.tmax,
      heat: usualT === null ? null : w.tmax - usualT,
      rain3: r3,
      // A dry season has near-zero usual rain: keep the ratio only where it is meaningful.
      wetness: r3 !== null && usualR !== null && usualR >= 5 ? r3 / usualR : null,
      fire: a?.harmonized?.z ?? (a?.consensus && a.consensus.n >= 2 ? a.consensus.z : null),
    }
  })
  const seasonStart = report.evidence.places?.seasonStart ?? null
  const inSeason = (month: string) => seasonStart !== null && (Number(month.slice(5, 7)) - 1 - seasonStart + 12) % 12 < 4
  const test = (list: WeatherAnomaly[], pick: (m: WeatherAnomaly) => number | null) => {
    const pairs = list.filter((m) => m.fire !== null && pick(m) !== null)
    return spearman(pairs.map((m) => pick(m)!), pairs.map((m) => m.fire!))
  }
  const flagged = (kind: 'unusual-high' | 'unusual-low', match: (m: WeatherAnomaly) => boolean) => {
    const list = report.anomalies.months.filter((a) => a.kind === kind).map((a) => months.find((m) => m.month === a.month)).filter((m): m is WeatherAnomaly => !!m && (m.heat !== null || m.wetness !== null))
    return list.length ? { months: list.map((m) => m.month), matching: list.filter(match).map((m) => m.month) } : null
  }
  return {
    point,
    months,
    heat: test(months, (m) => m.heat),
    dryness: test(months, (m) => m.wetness),
    seasonHeat: test(months.filter((m) => inSeason(m.month)), (m) => m.heat),
    seasonDryness: test(months.filter((m) => inSeason(m.month)), (m) => m.wetness),
    busy: flagged('unusual-high', (m) => (m.heat ?? 0) >= HOT || (m.wetness ?? 1) <= DRY),
    quiet: flagged('unusual-low', (m) => (m.heat ?? 0) <= -HOT || (m.wetness ?? 1) >= WET),
  }
}

/** NASA POWER weather for the report's fire centroid, as evidence. Cached for the session. */
export function useWeatherEvidence(report: BridgeReport | null) {
  const centroid = report?.evidence?.centroid ?? null
  const lat = centroid ? Math.round(centroid.lat * 100) / 100 : null
  const lon = centroid ? Math.round(centroid.lon * 100) / 100 : null
  const start = report?.meta.start ?? ''
  const end = report?.meta.endExclusive ?? ''
  const query = useQuery({
    queryKey: ['nasa-power', 'daily', lat, lon, start, end],
    // Three months before the window, so the first months have a full rain window.
    queryFn: ({ signal }) => fetchPowerMonths(lat!, lon!, shift(start.slice(0, 7), -3) + '-01', end, signal),
    enabled: lat !== null && lon !== null && !!start && !!end,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1,
  })
  const evidence = useMemo(() => (query.data && report && lat !== null && lon !== null ? weatherEvidence(report, query.data, { lat, lon }) : null), [query.data, report, lat, lon])
  return { evidence, status: query.status, error: query.error }
}
