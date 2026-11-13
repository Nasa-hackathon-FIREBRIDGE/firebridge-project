import { useRef, type CSSProperties, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, ArrowUpRight, Clock3, Satellite } from 'lucide-react'
import { useCatalog } from '../hooks/useCatalog'
import { useWorkspaceAnalyses, useWorkspaceAreas } from '../hooks/useWorkspace'
import { apiKeys } from '../services/api.keys'
import { areas as areasService } from '../services/areas.service'
import { AreaShape } from '../components/AreaShape'
import { StatusPill } from '../components/ui/StatusPill'
import { Reveal } from '../components/ui/Reveal'
import { LogoMark } from '../components/brand/Logo'
import { SENSORS, TIMELINE_SENSORS } from '../lib/sensors'
import { ARCHIVE, ARCHIVE_TOTAL_ROWS, AUDIT_DATE, MOROCCO_2020_SECONDS } from './methods/facts'
import { EarthGlobe, type GlobeCounts, type GlobePin } from './home/EarthGlobe'
import { MiniDial, MiniFleet, MiniPixels } from './home/ChallengeLenses'
import { BridgeTimeline } from './home/BridgeTimeline'

const ease = [0.16, 1, 0.3, 1] as const
const CHALLENGE = 'https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/'
const DISPLAY: CSSProperties = { fontVariationSettings: '"opsz" 32' }

/** Questions an analysis answers, each opening the tab that answers it. */
const QUESTIONS = [
  { tab: 'fire-calendar', q: 'When was burning unusual, and do the satellites agree?', a: 'Each satellite judged against its own past; a month glows only when they agree.' },
  { tab: 'fire-drivers', q: 'Why and where did it burn?', a: 'Every month beside NASA’s weather record, the places that burn again, the weekly rhythm.' },
  { tab: 'sensor-bridge', q: 'How much of the difference is the satellite?', a: 'Pixel size, the hour of the pass and orbit drift, separated from the fire.' },
  { tab: 'source-comparison', q: 'When does each satellite look, and what can it see?', a: 'Measured overpass times on a 24-hour sky, and pixels drawn to scale.' },
  { tab: 'analysis-overview', q: 'Does the result hold up?', a: 'Each finding set beside published fire science, with sources.' },
]

const PRINCIPLES = [
  ['100 detections', '100 separate fires', 'One fire front lights up many pixels.'],
  ['More VIIRS than MODIS', 'more burning', 'Smaller pixels see smaller fires.'],
  ['No detections', 'no fire', 'Clouds, smoke and gaps between passes hide fires.'],
  ['A missing record', 'zero', 'Missing stays missing, and is shown as missing.'],
  ['High radiative power', 'burned area', 'It is heat at the moment of the pass.'],
  ['A correlation with weather', 'a cause', 'Weather is context, never proof.'],
] as const

const fmt = (value: number) => value.toLocaleString('en-US')
const millions = (value: number) => `${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)} M`

function formatInterval(start: string, endExclusive: string) {
  const s = new Date(`${start.slice(0, 10)}T00:00:00Z`)
  const e = new Date(Date.parse(`${endExclusive.slice(0, 10)}T00:00:00Z`) - 86_400_000)
  const f = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return `${start} → ${endExclusive}`
  if (s.getUTCMonth() === 0 && s.getUTCDate() === 1 && e.getUTCMonth() === 11 && e.getUTCDate() === 31 && s.getUTCFullYear() === e.getUTCFullYear()) return `Full year ${s.getUTCFullYear()}`
  return `${f(s)} – ${f(e)}`
}

type Geometry = { type: string; coordinates: unknown } | null | undefined
/** A rough centre for a saved area: the mean of its outer ring, enough to place a pin on the globe. */
function centreOf(geometry: Geometry): [number, number] | null {
  if (!geometry) return null
  const ring = geometry.type === 'Polygon' ? (geometry.coordinates as number[][][])[0] : geometry.type === 'MultiPolygon' ? (geometry.coordinates as number[][][][])[0]?.[0] : null
  if (!ring?.length) return null
  const lon = ring.reduce((sum, p) => sum + p[0], 0) / ring.length
  const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
}

/** A night sky of fixed stars: the same field on every visit. */
const STARS = (() => {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: 150 }, () => ({ x: random() * 100, y: random() * 100, r: 0.4 + random() * 1.1, o: 0.15 + random() * 0.55, d: 2 + random() * 5 }))
})()

/** The stars, a quarter of them softly twinkling. */
function Stars() {
  return (
    <svg className="pointer-events-none absolute inset-0 -z-10 h-full w-full" aria-hidden="true">
      {STARS.map((s, i) => (
        <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#f4ede3" opacity={s.o} className={i % 4 === 0 ? 'motion-safe:animate-[twinkle_var(--d)_ease-in-out_infinite]' : undefined} style={{ '--d': `${s.d}s` } as CSSProperties} />
      ))}
    </svg>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-ember-300">
      <span className="h-px w-8 bg-current opacity-60" aria-hidden="true" />
      {children}
    </p>
  )
}

function Title({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return (
    <h2 className={`m-0 font-serif text-[clamp(32px,4.2vw,58px)] font-[470] leading-[1.03] tracking-[-0.035em] text-paper ${center ? 'mx-auto max-w-[20ch] text-center' : 'max-w-[20ch]'}`} style={DISPLAY}>
      {children}
    </h2>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const catalog = useCatalog()
  const analyses = useWorkspaceAnalyses('')
  const areas = useWorkspaceAreas()
  const rows = (analyses.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((row) => ['ready', 'partial'].includes(row.status))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const areaById = new Map((areas.data?.pages.flatMap((page) => page.items) ?? []).map((area) => [area.id, area]))
  // One analysis per place, full calendar years first.
  const seenAreas = new Set<string>()
  const featured = [...rows]
    .sort((a, b) => Number(b.start_date.endsWith('01-01')) - Number(a.start_date.endsWith('01-01')))
    .filter((row) => (seenAreas.has(row.area_id) ? false : (seenAreas.add(row.area_id), true)))
    .slice(0, 6)
  // The areas list pages six at a time; read each featured analysis's area directly (same cache as the workspace).
  const areaQueries = useQueries({
    queries: featured.filter((row) => !areaById.has(row.area_id)).map((row) => ({
      queryKey: apiKeys.area(row.area_id),
      queryFn: ({ signal }: { signal: AbortSignal }) => areasService.get(row.area_id, signal),
      staleTime: 5 * 60_000,
    })),
  })
  for (const query of areaQueries) if (query.data) areaById.set(query.data.id, query.data)
  const example = featured[0]
  const pins: GlobePin[] = featured.flatMap((row) => {
    const area = areaById.get(row.area_id)
    const centre = centreOf(area?.geometry as Geometry)
    if (!centre) return []
    const name = area?.name ?? 'Saved area'
    return [{ id: row.id, lon: centre[0], lat: centre[1], label: name.length > 24 ? `${name.slice(0, 23)}…` : name }]
  })
  const exampleHref = (tab: string) => (example ? `/analyses?analysis=${encodeURIComponent(example.id)}#${tab}` : '/analyses')

  // The globe reports detections; the counters update in place without re-rendering the page.
  const viirsCount = useRef<HTMLSpanElement>(null)
  const modisCount = useRef<HTMLSpanElement>(null)
  const ratioText = useRef<HTMLSpanElement>(null)
  const onCounts = (counts: GlobeCounts) => {
    if (viirsCount.current) viirsCount.current.textContent = fmt(counts.viirs)
    if (modisCount.current) modisCount.current.textContent = fmt(counts.modis)
    if (ratioText.current) ratioText.current.textContent = counts.modis ? `${(counts.viirs / counts.modis).toFixed(1)}×` : '—'
  }

  const aqua = ARCHIVE.find((p) => p.key === 'aqua')!
  const snpp = ARCHIVE.find((p) => p.key === 'snpp')!

  return (
    <div className="relative overflow-x-clip font-sans">
      <style>{'@keyframes twinkle { 0%, 100% { opacity: 0.15 } 50% { opacity: 0.85 } }'}</style>

      {/* ── Hero: the Earth under five fire satellites ─────────────────────── */}
      <section className="relative isolate overflow-hidden" aria-labelledby="home-title">
        <Stars />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[70%] bg-[radial-gradient(60%_55%_at_50%_70%,rgba(255,95,31,0.16),transparent_70%)]" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex max-w-[1080px] flex-col items-center px-5 pt-10 text-center sm:px-8 lg:pt-14">
          <motion.a
            href={CHALLENGE}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 rounded-full border border-ember-400/30 bg-ink-950/60 py-1 pl-1.5 pr-3 text-[12.5px] text-ember-100 no-underline backdrop-blur transition-colors hover:border-ember-400/60"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <span className="rounded-full bg-ember-gradient px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-950">NASA Space Apps 2026</span>
            Harmonization of MODIS and VIIRS hot spots
            <ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
          </motion.a>
          <motion.h1
            id="home-title"
            className="mb-0 mt-6 font-serif text-[clamp(38px,4.8vw,68px)] font-[480] leading-[1] tracking-[-0.042em] text-paper"
            style={DISPLAY}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.08, ease }}
          >
            MODIS is going dark.{' '}
            <br />
            <span className="text-ember-gradient">The fire record doesn’t have to.</span>
          </motion.h1>
          <motion.p
            className="mx-auto mb-0 mt-5 max-w-[58ch] text-[clamp(15.5px,1.25vw,18px)] leading-[1.6] text-paper-2"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.16, ease }}
          >
            For 26 years NASA’s MODIS satellites have recorded Earth’s fires; since 2012 VIIRS has flown beside them, seeing the same fires through other pixels at other hours. Both MODIS satellites now drift toward the end of their missions. FIREBRIDGE bridges the two into one comparable fire history for any place on Earth, and shows its evidence.
          </motion.p>
          <motion.div
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.24, ease }}
          >
            <Link to="/analyses" className="ui-button ui-button--primary ui-button--large group">
              Pick a place on Earth
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            {example ? (
              <Link to={`/analyses?analysis=${encodeURIComponent(example.id)}`} className="ui-button ui-button--large backdrop-blur">
                <Satellite size={16} aria-hidden="true" />
                Open a live analysis
              </Link>
            ) : (
              <Link to="/dashboard" className="ui-button ui-button--large">Browse saved analyses</Link>
            )}
          </motion.div>
        </div>

        <motion.div
          className="relative mx-auto -mt-[6%] w-full max-w-[1180px] px-2 [mask-image:linear-gradient(to_bottom,black_70%,transparent)] sm:-mt-[15%]"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, delay: 0.15, ease }}
        >
          <EarthGlobe
            pins={pins}
            onOpenPin={(id) => navigate(`/analyses?analysis=${encodeURIComponent(id)}`)}
            onCounts={onCounts}
            label="Illustration: the Earth turning under the five fire satellites on their sun-synchronous orbits. Terra flies the 10:30 plane; Aqua, Suomi-NPP, NOAA-20 and NOAA-21 the 13:30 plane. Fires flash as each satellite's scan swath passes; VIIRS records the small fires that MODIS misses. Glowing rings mark places already analysed; drag to turn the Earth."
          />
          {/* Left: the challenge, counted live in the illustration. */}
          <div className="pointer-events-none absolute left-[1.5%] top-[34%] hidden w-[220px] text-left lg:block">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-3">Same fires, counted live</p>
            <p className="m-0 mt-3 flex items-baseline gap-2">
              <span ref={viirsCount} className="font-serif text-[40px] font-[440] leading-none tracking-[-0.03em] tabular-nums text-paper" style={DISPLAY}>0</span>
              <span className="text-[12.5px] text-fg-2">VIIRS detections</span>
            </p>
            <p className="m-0 mt-2 flex items-baseline gap-2">
              <span ref={modisCount} className="font-serif text-[40px] font-[440] leading-none tracking-[-0.03em] tabular-nums text-paper" style={DISPLAY}>0</span>
              <span className="text-[12.5px] text-fg-2">MODIS detections</span>
            </p>
            <p className="m-0 mt-3 text-[12.5px] leading-relaxed text-fg-2">
              <span ref={ratioText} className="font-semibold text-ember-200">—</span> as many from VIIRS. Its 375 m pixels catch the small fires that MODIS’s 1 km pixels miss.
            </p>
            <p className="m-0 mt-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-fg-3">Illustration · regions approximate</p>
          </div>
          {/* Right: the real archive behind it. */}
          <div className="absolute right-[1.5%] top-[34%] hidden w-[220px] text-left lg:block">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-3">In the real archive</p>
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {TIMELINE_SENSORS.map((key) => {
                const sensor = SENSORS[key]
                const rowsCount = ARCHIVE.find((p) => p.key === key)?.rows ?? 0
                return (
                  <li key={key} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="flex items-center gap-2 text-fg-2">
                      <span className="size-2 rounded-full" style={{ background: sensor.color, boxShadow: `0 0 10px ${sensor.color}` }} aria-hidden="true" />
                      <span className="text-fg">{sensor.label}</span>
                      <span className="font-mono text-[10px] text-fg-3">{sensor.overpass}</span>
                    </span>
                    <span className="font-mono text-[11.5px] tabular-nums text-paper">{millions(rowsCount)}</span>
                  </li>
                )
              })}
            </ul>
            <p className="m-0 mt-3 text-[12px] leading-relaxed text-fg-3">NASA FIRMS detections per satellite, archived and audited {AUDIT_DATE}.</p>
          </div>
        </motion.div>

        {/* Phone and tablet: the two read-outs under the Earth. */}
        <div className="relative z-10 mx-auto -mt-[14%] grid max-w-[640px] gap-6 px-5 pb-6 sm:grid-cols-2 lg:hidden">
          <p className="m-0 text-[13px] leading-relaxed text-fg-2">Watch the swaths: VIIRS records the small fires that MODIS misses. In the real archive, Suomi-NPP alone holds <strong className="text-paper">{millions(snpp.rows)}</strong> detections against <strong className="text-paper">{millions(aqua.rows)}</strong> for Aqua.</p>
          <p className="m-0 text-[13px] leading-relaxed text-fg-3">Illustration: fire regions approximate, orbit altitudes exaggerated. Drag to turn the Earth; glowing rings are places already analysed.</p>
        </div>
      </section>

      {/* ── The archive, in four numbers ───────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-[1180px] px-5 sm:px-8" aria-label="The archive in numbers">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-8 border-y border-white/[0.07] py-8 lg:grid-cols-4">
          {[
            [fmt(ARCHIVE_TOTAL_ROWS), 'NASA FIRMS fire detections in the archive'],
            ['5', 'satellites, two instruments, since November 2000'],
            [`${MOROCCO_2020_SECONDS} s`, 'to prepare a full year of northern Morocco'],
            [catalog.data ? String(catalog.data.releases.length) : '—', 'published, checksummed data releases'],
          ].map(([value, text]) => (
            <div key={text} className="flex min-w-0 flex-col gap-2 lg:border-l lg:border-white/[0.07] lg:pl-6 lg:first:border-l-0 lg:first:pl-0">
              <dd className="m-0 font-serif text-[clamp(26px,2.8vw,40px)] font-[440] leading-none tracking-[-0.03em] tabular-nums text-paper" style={DISPLAY}>{value}</dd>
              <dt className="order-last text-[12.5px] leading-snug text-fg-3">{text}</dt>
            </div>
          ))}
        </dl>
      </section>

      <div className="mx-auto flex max-w-[1180px] flex-col gap-32 px-5 pb-24 pt-28 sm:px-8">
        {/* ── The challenge: three ways to miscount one fire ──────────────── */}
        <section aria-labelledby="lenses-title">
          <Reveal className="flex flex-col gap-5">
            <Kicker>The challenge</Kicker>
            <div id="lenses-title"><Title>The same fire, counted three different ways.</Title></div>
            <p className="m-0 max-w-[62ch] text-[16.5px] leading-[1.65] text-paper-2">
              The 2026 challenge asks for one consistent record of fire activity across MODIS and VIIRS. Add their detections naively and three things change the count that have nothing to do with fire.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-0">
            {[
              { n: '01', title: 'Pixel size', big: '≈ 7×', unit: 'VIIRS pixels in one MODIS pixel', text: 'MODIS sees the ground in 1 km pixels, VIIRS in 375 m. The white dot is a 1,000 m² fire at true size: it fills 0.1% of a MODIS pixel but 0.7% of a VIIRS pixel, so VIIRS records more and smaller fires.', art: <MiniPixels /> },
              { n: '02', title: 'Hour of the pass', big: '+2 h', unit: 'Aqua’s afternoon pass, drifting later', text: 'Terra passes near 10:30, Aqua and VIIRS near 13:30, and fires burn hardest between 13:00 and 18:30. Aqua’s orbit is no longer maintained: its pass has drifted later since 2022, toward the end of the day’s burning.', art: <MiniDial /> },
              { n: '03', title: 'The changing fleet', big: '5', unit: 'satellites, three joining after 2012', text: 'A raw total jumps whenever a satellite joins (Suomi-NPP in 2012, NOAA-20 in 2018, NOAA-21 in 2023) without a single extra fire.', art: <MiniFleet /> },
            ].map((lens, index) => (
              <Reveal key={lens.n} delay={index * 0.08} className="flex flex-col gap-5 md:border-l md:border-white/[0.07] md:px-8 md:first:border-l-0 md:first:pl-0">
                <p className="m-0 font-mono text-[11px] tracking-[0.2em] text-ember-300">{lens.n} · {lens.title.toUpperCase()}</p>
                <div className="flex h-[200px] items-center">{lens.art}</div>
                <p className="m-0 flex items-baseline gap-3">
                  <span className="whitespace-nowrap font-serif text-[44px] font-[440] leading-none tracking-[-0.03em] text-paper" style={DISPLAY}>{lens.big}</span>
                  <span className="text-[13px] leading-snug text-fg-2">{lens.unit}</span>
                </p>
                <p className="m-0 text-[14px] leading-[1.65] text-fg-2">{lens.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── The bridge ───────────────────────────────────────────────────── */}
        <section aria-labelledby="bridge-title">
          <Reveal className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-end">
            <div className="flex flex-col gap-5">
              <Kicker>The answer</Kicker>
              <div id="bridge-title"><Title>Fourteen years of flying together are the bridge.</Title></div>
            </div>
            <p className="m-0 max-w-[56ch] text-[16px] leading-[1.65] text-paper-2">
              Since 2012 MODIS and VIIRS have watched the same places on the same afternoons. FIREBRIDGE learns from those years, place by place, how many fires Aqua would have recorded from what VIIRS saw. It proves it by hiding Aqua and predicting it, and carries the record on as MODIS fades.
            </p>
          </Reveal>
          <Reveal delay={0.08} className="mt-12">
            <BridgeTimeline />
          </Reveal>
        </section>

        {/* ── Questions an analysis answers ────────────────────────────────── */}
        <section aria-labelledby="questions-title">
          <Reveal className="flex flex-col gap-5">
            <Kicker>What you can ask</Kicker>
            <div id="questions-title"><Title>Draw a place. Then ask it five questions.</Title></div>
            <p className="m-0 max-w-[62ch] text-[16px] leading-[1.65] text-paper-2">
              {example ? 'Each question opens a real analysis already on the server, at the page that answers it.' : 'Each question is a page of every analysis.'}
            </p>
          </Reveal>
          <ol className="m-0 mt-12 list-none p-0">
            {QUESTIONS.map((item, index) => (
              <Reveal as="li" key={item.tab} delay={index * 0.05}>
                <Link
                  to={exampleHref(item.tab)}
                  className="group grid grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-t border-white/[0.07] py-7 no-underline transition-colors hover:bg-[linear-gradient(90deg,rgba(255,95,31,0.07),transparent_70%)] sm:grid-cols-[4.5rem_minmax(0,1.3fr)_minmax(0,1fr)_auto]"
                >
                  <span className="font-serif text-[clamp(30px,3vw,44px)] font-[300] italic leading-none text-transparent [-webkit-text-stroke:1px_rgba(255,160,112,0.6)] group-hover:[-webkit-text-stroke:1px_rgba(255,160,112,1)]" style={DISPLAY} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="font-serif text-[clamp(19px,2vw,27px)] font-[460] leading-[1.2] tracking-[-0.02em] text-paper transition-colors group-hover:text-ember-100" style={DISPLAY}>{item.q}</span>
                  <span className="col-span-3 col-start-2 text-[13.5px] leading-relaxed text-fg-3 sm:col-span-1 sm:col-start-auto">{item.a}</span>
                  <ArrowRight size={20} className="col-start-3 row-start-1 text-fg-3 transition-[transform,color] group-hover:translate-x-1 group-hover:text-ember-300 sm:col-start-4" aria-hidden="true" />
                </Link>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ── Places on the globe ──────────────────────────────────────────── */}
        <section aria-labelledby="places-title">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex flex-col gap-5">
              <Kicker>Live on the server</Kicker>
              <div id="places-title"><Title>The places glowing on the Earth above.</Title></div>
              <p className="m-0 max-w-[60ch] text-[16px] leading-[1.65] text-paper-2">Each analysis is pinned to an immutable data release, so its map, calendar, exports and explanation always agree.</p>
            </div>
            <Link to="/dashboard" className="group inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-4 py-2 text-[13px] font-medium text-fg-2 no-underline transition-colors hover:border-white/25 hover:text-fg">
              All analyses <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </Reveal>
          <div className="mt-10 grid gap-x-10 md:grid-cols-2">
            {analyses.isPending ? (
              Array.from({ length: 4 }, (_, index) => <div key={index} className="ui-skeleton my-3 h-[76px] rounded-2xl" />)
            ) : featured.length ? (
              featured.map((row, index) => {
                const area = areaById.get(row.area_id)
                return (
                  <Reveal key={row.id} delay={index * 0.05}>
                    <Link to={`/analyses?analysis=${encodeURIComponent(row.id)}`} className="group flex items-center gap-5 border-t border-white/[0.07] py-5 no-underline">
                      <span className="grid size-[64px] shrink-0 place-items-center rounded-full border border-ember-400/25 bg-[radial-gradient(circle,rgba(255,95,31,0.14),transparent_70%)] text-ember-200 transition-colors group-hover:border-ember-400/60">
                        <AreaShape geometry={area?.geometry} size={44} label={`Outline of ${area?.name ?? 'study area'}`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-[20px] font-[470] tracking-[-0.02em] text-paper transition-colors group-hover:text-ember-100" style={DISPLAY}>{area?.name ?? 'Saved study area'}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-fg-3">
                          <Clock3 size={12} aria-hidden="true" />
                          {formatInterval(row.start_date, row.end_date_exclusive)}
                        </span>
                      </span>
                      <StatusPill value={row.status} />
                      <ArrowRight size={16} className="shrink-0 text-fg-3 transition-[transform,color] group-hover:translate-x-1 group-hover:text-ember-300" aria-hidden="true" />
                    </Link>
                  </Reveal>
                )
              })
            ) : (
              <p className="col-span-full m-0 border-t border-white/[0.07] py-8 text-fg-2">
                {analyses.isError ? 'Saved analyses are unavailable right now.' : 'No ready analyses yet.'}{' '}
                <Link to="/analyses" className="text-ember-300">Be the first to run one.</Link>
              </p>
            )}
          </div>
        </section>

        {/* ── Honest by design ─────────────────────────────────────────────── */}
        <section aria-labelledby="honest-title" className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Reveal className="flex flex-col gap-5">
            <Kicker>Honest by design</Kicker>
            <div id="honest-title"><Title>What a detection is not.</Title></div>
            <p className="m-0 max-w-[48ch] text-[16px] leading-[1.65] text-paper-2">
              Every number is computed from the saved result, checked against published science, and labelled with what it cannot say. Missing data is shown as missing, never as zero.
            </p>
          </Reveal>
          <ul className="m-0 list-none p-0">
            {PRINCIPLES.map(([claim, not, why], index) => (
              <Reveal as="li" key={claim} delay={index * 0.04} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 border-t border-white/[0.07] py-4">
                <span className="font-serif text-[18px] font-[470] tracking-[-0.015em] text-paper" style={DISPLAY}>{claim}</span>
                <span className="font-mono text-[18px] leading-none text-ember-300" aria-label="is not">≠</span>
                <span className="text-[15px] text-fg-3 line-through decoration-ember-400/50">{not}</span>
                <span className="col-span-3 text-[13px] text-fg-2">{why}</span>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* ── Call to action ───────────────────────────────────────────────── */}
        <Reveal className="relative isolate overflow-hidden rounded-[32px] border border-ember-400/20 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_120%_at_50%_120%,rgba(255,95,31,0.32),transparent_60%),radial-gradient(50%_80%_at_50%_-20%,rgba(255,181,71,0.08),transparent_60%)]" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 -z-10 h-px bg-[linear-gradient(90deg,transparent,#ff7c40,transparent)]" aria-hidden="true" />
          <h2 className="m-0 mx-auto max-w-[18ch] font-serif text-[clamp(32px,4.4vw,60px)] font-[480] leading-[1.02] tracking-[-0.04em] text-paper" style={DISPLAY}>
            Pick a place on Earth. <span className="text-ember-gradient">See its fire history.</span>
          </h2>
          <p className="mx-auto mb-0 mt-5 max-w-[52ch] text-[16px] leading-relaxed text-paper-2">Free and public, with no sign-in. Draw an area and get a reproducible, evidence-linked analysis in seconds.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/analyses" className="ui-button ui-button--primary ui-button--large group">
              Open the workspace
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <Link to="/evidence" className="ui-button ui-button--large">How the data is processed</Link>
          </div>
        </Reveal>
      </div>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-5 py-8 text-[12.5px] text-fg-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="flex items-center gap-3">
            <LogoMark size={26} />
            FIREBRIDGE · NASA Space Apps Challenge 2026
          </span>
          <span>Data: NASA FIRMS active-fire products (MODIS, VIIRS) and NASA POWER. For exploration and historical comparison, not an emergency warning system.</span>
        </div>
      </footer>
    </div>
  )
}
