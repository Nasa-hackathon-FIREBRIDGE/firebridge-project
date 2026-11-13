import { useMemo, useState, type ReactNode } from 'react'
import { CloudSun } from 'lucide-react'
import { Banner } from '../../components/ui/Banner'
import { useElementWidth } from '../../hooks/useElementWidth'
import { ApiError } from '../analyses/Feedback'
import { BridgeProgress } from '../bridge/BridgePanel'
import type { BridgeReport, FirePlace } from '../bridge/engine/index.ts'
import { fmtInt, fmtMonth } from '../bridge/format'
import { MAX_BRIDGE_DETECTIONS, useBridgeReport } from '../bridge/useBridgeReport'
import { EvidencePanel } from '../science/Evidence'
import { Chapter, Masthead, Standfirst } from '../story/Story'
import { fmtP, placesCheck, weatherCheck, weeklyCheck } from '../science/checks'
import { DRY, HOT, WET, useWeatherEvidence, type WeatherAnomaly, type WeatherEvidence } from '../science/weather'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Mix two hex colours. */
function mix(a: string, b: string, t: number) {
  const p = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, t)))).join(',')})`
}
const NEUTRAL = '#1a1e27'
const heatColour = (c: number | null) => (c === null ? NEUTRAL : c >= 0 ? mix(NEUTRAL, '#e0482a', c / 3) : mix(NEUTRAL, '#3d7be0', -c / 3))
const rainColour = (w: number | null) => (w === null ? null : w >= 1 ? mix(NEUTRAL, '#2fb3a3', Math.log2(w) / 1.5) : mix(NEUTRAL, '#c07a2c', -Math.log2(w) / 1.5))

function Card({ eyebrow, title, children, aside, n }: { eyebrow: string; title: string; children: ReactNode; aside?: ReactNode; n?: number }) {
  return (
    <Chapter n={n} kicker={eyebrow} title={title} aside={aside}>
      {children}
    </Chapter>
  )
}

function describe(m: WeatherAnomaly) {
  const parts = [`${fmtMonth(m.month, 'long')}`]
  parts.push(m.fire === null ? 'fire not scored' : `fire ${m.fire >= 0 ? '+' : '−'}${Math.abs(m.fire).toFixed(1)} spreads`)
  parts.push(`Tmax ${m.tmax.toFixed(1)} °C${m.heat === null ? '' : ` (${m.heat >= 0 ? '+' : '−'}${Math.abs(m.heat).toFixed(1)} vs usual)`}`)
  if (m.rain3 !== null) parts.push(`rain over 3 months ${Math.round(m.rain3)} mm${m.wetness === null ? '' : ` (${Math.round(m.wetness * 100)}% of usual)`}`)
  return parts.join(' · ')
}

/** Fire anomaly drawn over NASA's heat and rain stripes, one column per month. */
function ClimateStripes({ weather, report }: { weather: WeatherEvidence; report: BridgeReport }) {
  const { ref, width } = useElementWidth<HTMLDivElement>(960)
  const [hover, setHover] = useState<WeatherAnomaly | null>(null)
  const start = report.meta.start.slice(0, 7)
  const months = weather.months.filter((m) => m.month >= start)
  const kinds = useMemo(() => new Map(report.anomalies.months.map((a) => [a.month, a.kind])), [report])
  const LEFT = 78
  const RIGHT = 8
  const FIRE = 92
  const STRIPE = 30
  const GAP = 8
  const height = FIRE + GAP + STRIPE + GAP + STRIPE + 22
  const w = (width - LEFT - RIGHT) / Math.max(1, months.length)
  const mid = FIRE / 2
  const threshold = report.anomalies.threshold
  const bar = (z: number) => (Math.max(-4, Math.min(4, z)) / 4) * (mid - 6)
  const rows = [
    { y: FIRE + GAP, label: 'Heat' },
    { y: FIRE + GAP + STRIPE + GAP, label: 'Rain, 3 mo' },
  ]
  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg width={width} height={height} className="absolute inset-0 block" role="img" aria-label={`Monthly fire anomaly above NASA POWER heat and rain anomalies, ${fmtMonth(months[0]?.month ?? start, 'long')} to ${fmtMonth(months[months.length - 1]?.month ?? start, 'long')}.`}>
          <defs>
            <filter id="stripes-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" /></filter>
            <pattern id="stripes-dry-season" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill={NEUTRAL} />
              <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
            </pattern>
          </defs>
          <text x={0} y={mid - 2} fill="#aab0bc" fontSize="11.5" fontFamily="Inter Variable, sans-serif">Fire</text>
          <text x={0} y={mid + 12} fill="#737a88" fontSize="10" fontFamily="Inter Variable, sans-serif">vs usual</text>
          {rows.map((r) => <text key={r.label} x={0} y={r.y + STRIPE / 2 + 4} fill="#aab0bc" fontSize="11.5" fontFamily="Inter Variable, sans-serif">{r.label}</text>)}
          <line x1={LEFT} x2={width - RIGHT} y1={mid} y2={mid} stroke="rgba(255,255,255,0.12)" />
          {[threshold, -threshold].map((t) => <line key={t} x1={LEFT} x2={width - RIGHT} y1={mid - bar(t)} y2={mid - bar(t)} stroke="rgba(255,255,255,0.07)" strokeDasharray="2 4" />)}
          {months.map((m, i) => {
            const x = LEFT + i * w
            const kind = kinds.get(m.month)
            const strong = kind === 'unusual-high' || kind === 'unusual-low'
            const wet = rainColour(m.wetness)
            return (
              <g key={m.month}>
                <rect x={x} y={rows[0].y} width={w + 0.5} height={STRIPE} fill={heatColour(m.heat)} />
                <rect x={x} y={rows[1].y} width={w + 0.5} height={STRIPE} fill={wet ?? 'url(#stripes-dry-season)'} />
                {m.fire !== null && (
                  <>
                    {strong && <rect x={x + w * 0.15} y={m.fire >= 0 ? mid - bar(m.fire) : mid} width={w * 0.7} height={Math.abs(bar(m.fire))} rx={1.5} fill={m.fire >= 0 ? '#ff7c40' : '#60a5fa'} filter="url(#stripes-glow)" opacity={0.8} />}
                    <rect x={x + w * 0.15} y={m.fire >= 0 ? mid - bar(m.fire) : mid} width={w * 0.7} height={Math.max(1, Math.abs(bar(m.fire)))} rx={1.5} fill={strong ? (m.fire >= 0 ? '#ffc5a3' : '#93c5fd') : m.fire >= 0 ? '#bd390d' : '#2c5aa0'} />
                  </>
                )}
                {m.month.endsWith('-01') && (
                  <>
                    <line x1={x} x2={x} y1={4} y2={height - 18} stroke="rgba(255,255,255,0.08)" />
                    <text x={x + 3} y={height - 5} fill="#737a88" fontSize="10.5" fontFamily="JetBrains Mono Variable, monospace">{m.month.slice(0, 4)}</text>
                  </>
                )}
              </g>
            )
          })}
          {hover && (() => {
            const i = months.indexOf(hover)
            return <rect x={LEFT + i * w - 1} y={1} width={w + 2} height={height - 20} rx={2} fill="none" stroke="#f3f4f7" strokeOpacity={0.7} />
          })()}
        </svg>
        <div
          className="absolute inset-y-0 right-0"
          style={{ left: LEFT }}
          aria-hidden="true"
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const m = months[Math.floor((event.clientX - box.left) / w)] ?? null
            if (m !== hover) setHover(m)
          }}
          onMouseLeave={() => setHover(null)}
        />
      </div>
      <p className="mb-0 mt-3 min-h-5 text-[12.5px] text-fg-2" aria-live="polite">{hover ? describe(hover) : 'Point at a month to read its fire and weather.'}</p>
      <ul className="m-0 mt-2 flex list-none flex-wrap items-center gap-x-5 gap-y-1.5 p-0 text-[11.5px] text-fg-2" aria-label="Colours">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-[2px]" style={{ background: 'linear-gradient(90deg,#3d7be0,#1a1e27,#e0482a)' }} aria-hidden="true" />cooler ↔ hotter than usual</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-[2px]" style={{ background: 'linear-gradient(90deg,#c07a2c,#1a1e27,#2fb3a3)' }} aria-hidden="true" />drier ↔ wetter than usual</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-[2px] bg-ember-200 shadow-[0_0_8px_#ff7c40]" aria-hidden="true" />unusual fire month</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-[2px]" style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0 1.5px, #1a1e27 1.5px 4px)' }} aria-hidden="true" />dry season, no usual rain to compare</li>
      </ul>
    </div>
  )
}

function Highlights({ weather }: { weather: WeatherEvidence }) {
  const notable = weather.months
    .filter((m) => m.fire !== null && Math.abs(m.fire) >= 2)
    .sort((a, b) => Math.abs(b.fire!) - Math.abs(a.fire!))
    .slice(0, 4)
  if (!notable.length) return null
  const verdict = (m: WeatherAnomaly) => {
    const hot = (m.heat ?? 0) >= HOT
    const cool = (m.heat ?? 0) <= -HOT
    const dry = m.wetness !== null && m.wetness <= DRY
    const wet = m.wetness !== null && m.wetness >= WET
    if (m.fire! > 0) return hot || dry ? { text: `${[hot && 'hot', dry && 'dry'].filter(Boolean).join(' and ')}: the weather fits`, tone: 'text-ok' } : { text: 'neither hot nor dry: the weather does not explain it', tone: 'text-ember-300' }
    return cool || wet ? { text: `${[cool && 'cool', wet && 'wet'].filter(Boolean).join(' and ')}: the weather fits`, tone: 'text-ok' } : { text: 'not cooler or wetter: the weather does not explain it', tone: 'text-ember-300' }
  }
  return (
    <ul className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4">
      {notable.map((m) => {
        const v = verdict(m)
        return (
          <li key={m.month} className="border-l border-white/[0.1] pl-4">
            <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3">{fmtMonth(m.month, 'long')}</p>
            <p className={`mb-0 mt-1.5 text-[14px] font-semibold ${m.fire! > 0 ? 'text-ember-200' : 'text-info'}`}>Fire {m.fire! > 0 ? '+' : '−'}{Math.abs(m.fire!).toFixed(1)} spreads</p>
            <p className="mb-0 mt-1 text-[12.5px] text-fg-2">
              {m.heat !== null ? `${m.heat >= 0 ? '+' : '−'}${Math.abs(m.heat).toFixed(1)} °C` : 'heat n/a'} · {m.wetness !== null ? `${Math.round(m.wetness * 100)}% of usual rain` : 'dry season'}
            </p>
            <p className={`mb-0 mt-2 text-[12.5px] font-medium ${v.tone}`}>{v.text}</p>
          </li>
        )
      })}
    </ul>
  )
}

/** One small map: every burning 5 km cell as an ember, sized by fire cell-days, brighter for more years. */
function PlaceMap({ cells, pick, title, sub, bounds, maxYears }: { cells: FirePlace[]; pick: (c: FirePlace) => number; title: string; sub: string; bounds: { x0: number; x1: number; y0: number; y1: number }; maxYears: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>(440)
  const spanX = bounds.x1 - bounds.x0 + 1
  const spanY = bounds.y1 - bounds.y0 + 1
  const scale = Math.min((width - 16) / spanX, 340 / spanY)
  const height = spanY * scale + 16
  const offsetX = (width - spanX * scale) / 2
  const max = Math.max(1, ...cells.map(pick))
  const active = cells.filter((c) => pick(c) > 0).sort((a, b) => a.years - b.years)
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-2">
        <span className="block text-[13.5px] font-medium text-fg">{title}</span>
        <span className="block text-[12px] text-fg-3">{sub}</span>
      </figcaption>
      <div ref={ref} className="w-full rounded-2xl border border-white/[0.06] bg-[#0b0d12]">
        <svg width={width} height={height} className="block" role="img" aria-label={`${title}: ${active.length} burning cells of 5 km`}>
          <defs><filter id={`places-glow-${title.length}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.5" /></filter></defs>
          {cells.map((c) => <circle key={`g${c.cx}:${c.cy}`} cx={offsetX + (c.cx - bounds.x0 + 0.5) * scale} cy={8 + (bounds.y1 - c.cy + 0.5) * scale} r={Math.max(0.8, scale * 0.18)} fill="rgba(255,255,255,0.09)" />)}
          {active.map((c) => {
            const r = Math.max(1.4, Math.sqrt(pick(c) / max) * scale * 1.1)
            const t = maxYears > 1 ? (c.years - 1) / (maxYears - 1) : 1
            const colour = mix('#8f2d0f', '#ffd4b8', t)
            const x = offsetX + (c.cx - bounds.x0 + 0.5) * scale
            const y = 8 + (bounds.y1 - c.cy + 0.5) * scale
            return (
              <g key={`${c.cx}:${c.cy}`}>
                {t > 0.5 && <circle cx={x} cy={y} r={r * 1.8} fill="#ff7c40" opacity={0.35 * t} filter={`url(#places-glow-${title.length})`} />}
                <circle cx={x} cy={y} r={r} fill={colour} opacity={0.6 + 0.4 * t} />
              </g>
            )
          })}
        </svg>
      </div>
    </figure>
  )
}

function FirePlaces({ report }: { report: BridgeReport }) {
  const p = report.evidence.places
  if (!p || !p.cells.length) return null
  const bounds = {
    x0: Math.min(...p.cells.map((c) => c.cx)),
    x1: Math.max(...p.cells.map((c) => c.cx)),
    y0: Math.min(...p.cells.map((c) => c.cy)),
    y1: Math.max(...p.cells.map((c) => c.cy)),
  }
  const maxYears = Math.max(...p.cells.map((c) => c.years))
  const season = `${MONTHS[p.seasonStart]} to ${MONTHS[(p.seasonStart + 3) % 12]}`
  const seasonCells = p.cells.filter((c) => c.season > 0).length
  const offCells = p.cells.filter((c) => c.offSeason > 0).length
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <PlaceMap cells={p.cells} pick={(c) => c.season} title={`Fire season · ${season}`} sub={`${fmtInt(seasonCells)} cells burned in these four months`} bounds={bounds} maxYears={maxYears} />
        <PlaceMap cells={p.cells} pick={(c) => c.offSeason} title="Rest of the year" sub={`${fmtInt(offCells)} cells burned outside the season`} bounds={bounds} maxYears={maxYears} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-fg-2">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-white/20" aria-hidden="true" />burned at some time</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: '#8f2d0f' }} aria-hidden="true" /><span className="size-2.5 rounded-full shadow-[0_0_8px_#ff7c40]" style={{ background: '#ffd4b8' }} aria-hidden="true" />brighter: burned in more years (up to {maxYears})</span>
        </span>
        <span className="text-fg-3">Dot size: fire cell-days · equal-area 5 km cells</span>
      </div>
    </>
  )
}

function WeekRhythm({ report }: { report: BridgeReport }) {
  const w = report.evidence.weekly
  if (!w) return null
  const n = w.counts.reduce((a, b) => a + b, 0)
  const mean = n / 7
  const max = Math.max(...w.counts)
  return (
    <div>
      <div className="flex h-36 items-end gap-2" role="img" aria-label={`Detection clusters by weekday of first detection: ${w.counts.map((c, i) => `${WEEK[i]} ${c}`).join(', ')}. Chi-square ${fmtP(w.p)}.`}>
        {w.counts.map((c, i) => (
          <div key={WEEK[i]} className="relative flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="font-mono text-[10.5px] tabular-nums text-fg-2">{fmtInt(c)}</span>
            <span className={`w-full max-w-14 rounded-t-md ${i === w.quietest || i === w.busiest ? 'bg-ember-gradient' : 'bg-ember-700/70'}`} style={{ height: `${(c / max) * 75}%` }} />
            <span className={`font-mono text-[11px] ${i === w.quietest || i === w.busiest ? 'text-fg' : 'text-fg-3'}`}>{WEEK[i]}</span>
          </div>
        ))}
      </div>
      <p className="mb-0 mt-3 text-[12.5px] leading-relaxed text-fg-2">
        Mean {Math.round(mean)} clusters a day. {w.p < 0.05 ? <>The week is uneven ({fmtP(w.p)}): a pattern weather cannot produce.</> : <>The differences are within what chance produces ({fmtP(w.p)}): no weekly rhythm stands out.</>}
      </p>
    </div>
  )
}

export function DriversView({ report }: { report: BridgeReport }) {
  const weather = useWeatherEvidence(report)
  const checks = [weatherCheck(report, weather.evidence), placesCheck(report), weeklyCheck(report)].filter((c) => c !== null)
  const heat = weather.evidence?.heat
  return (
    <>
      <Card
        n={1}
        eyebrow="Heat, rain and fire · NASA POWER × FIRMS"
        title={heat && heat.p < 0.05 && heat.rho > 0 ? 'Months that were hotter than usual burned more' : 'Did the weather drive the fire?'}
        aside={weather.evidence ? <span className="text-[12px] text-fg-3">Weather at {weather.evidence.point.lat.toFixed(2)}°, {weather.evidence.point.lon.toFixed(2)}° · centre of the fire activity</span> : undefined}
      >
        {weather.status === 'pending' && <p className="m-0 text-[13px] text-fg-2" role="status">Reading NASA POWER daily weather for this area…</p>}
        {weather.status === 'error' && <Banner tone="warning">NASA POWER could not be reached, so the weather comparison is unavailable right now. Everything else on this page comes from the satellite record.</Banner>}
        {weather.evidence && (
          <>
            <p className="m-0 max-w-[64ch] font-serif text-[16.5px] leading-[1.65] text-paper-2">
              Each column is one month. Above: how far fire activity sat from a usual month of the same name (the calendar’s harmonized record). Below: how much hotter and wetter than usual the same month was, from NASA’s MERRA-2 reanalysis. When fire bars rise over red and brown stripes, the weather fits the fire.
            </p>
            <ClimateStripes weather={weather.evidence} report={report} />
            <Highlights weather={weather.evidence} />
          </>
        )}
      </Card>
      <Card n={2} eyebrow="Where it burns" title="The fire season and the rest of the year burn in different places">
        <FirePlaces report={report} />
      </Card>
      <Card n={3} eyebrow="When fires start" title="The working week, seen from orbit">
        <p className="m-0 max-w-[64ch] font-serif text-[16.5px] leading-[1.65] text-paper-2">Weather has no weekdays; people do. Each detection cluster is placed on the local weekday of its first detection.</p>
        <WeekRhythm report={report} />
      </Card>
      <EvidencePanel
        id="drivers-evidence"
        eyebrow="Why and where, checked"
        title="What the drivers say, beside the literature"
        lede="Three questions the satellites alone cannot answer: did the weather set it up, does it return to the same places, and do people leave a rhythm in it?"
        checks={checks}
      />
    </>
  )
}

export function DriversPanel({ analysisId }: { analysisId?: string }) {
  const state = useBridgeReport(analysisId)
  if (!analysisId) return null
  return (
    <section className="relative flex flex-col gap-14 pt-6 font-sans sm:pt-10" aria-labelledby="drivers-heading">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-ember-500/[0.07] blur-[100px]" aria-hidden="true" />
      <header className="relative flex flex-col gap-6">
        <Masthead>
          <CloudSun size={13} aria-hidden="true" /> Fire drivers · NASA POWER × FIRMS
        </Masthead>
        <h2 id="drivers-heading" className="m-0 max-w-[20ch] font-serif text-[clamp(34px,4.6vw,62px)] font-[480] leading-[1.02] tracking-[-0.032em] text-paper">Why and where did it burn?</h2>
        <Standfirst>
          <p>The calendar says when burning was unusual. This page goes further: it sets every month beside NASA’s own weather record, maps the places that burn year after year, and looks for the weekly rhythm only people leave behind.</p>
        </Standfirst>
      </header>
      {state.status === 'loading' && <BridgeProgress state={state} />}
      {state.status === 'error' && <ApiError context="analysis" error={state.error} retry={state.retry} />}
      {state.status === 'too-large' && <Banner tone="warning">This analysis holds {fmtInt(state.total)} detections, above the {fmtInt(MAX_BRIDGE_DETECTIONS)} the in-browser engine processes. Narrow the area or period to read its drivers.</Banner>}
      {state.status === 'ready' && <DriversView report={state.report} />}
    </section>
  )
}
