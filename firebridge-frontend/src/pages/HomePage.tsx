import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  Layers2,
  MapPinned,
  Satellite,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { useCatalog } from '../hooks/useCatalog'
import { useWorkspaceAnalyses, useWorkspaceAreas } from '../hooks/useWorkspace'
import { AreaShape } from '../components/AreaShape'
import { StatusPill } from '../components/ui/StatusPill'
import { Reveal } from '../components/ui/Reveal'
import { LogoMark } from '../components/brand/Logo'
import { OrbitGlobe } from './home/OrbitGlobe'
import { PixelComparison } from './home/PixelComparison'
import { SensorTimeline } from './home/SensorTimeline'

const ease = [0.16, 1, 0.3, 1] as const

const steps = [
  { icon: MapPinned, title: 'Draw your area', text: 'Sketch a polygon on satellite imagery or reopen a saved study area.' },
  { icon: CalendarRange, title: 'Pick a period', text: 'Choose any UTC interval. Standard archives cover decades of records.' },
  { icon: Zap, title: 'Prepared in seconds', text: 'Regional indexes narrow the archive read. Morocco · 2020 was ready in 4.7 s.' },
  { icon: Sparkles, title: 'Explore & explain', text: 'Map, calendar, per-satellite counts, provenance and exports, all from one pinned release.' },
]

const principles = [
  { claim: '100 detections', truth: 'are 100 satellite detections, not necessarily 100 separate fires.' },
  { claim: 'More VIIRS than MODIS', truth: 'is a difference in recorded detections, not automatically more burning.' },
  { claim: 'No points returned', truth: 'is not proof of no fire or of a clear-sky observation.' },
  { claim: 'A missing partition', truth: 'is missing information, never a zero.' },
  { claim: 'High fire radiative power', truth: 'is a measurement at observation time, not burned hectares.' },
  { claim: 'Hot, dry, windy weather', truth: 'is context, not independent confirmation of an incident.' },
]

function formatInterval(start: string, endExclusive: string) {
  const s = new Date(`${start.slice(0, 10)}T00:00:00Z`)
  const e = new Date(Date.parse(`${endExclusive.slice(0, 10)}T00:00:00Z`) - 86_400_000)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return `${start} → ${endExclusive}`
  if (s.getUTCMonth() === 0 && s.getUTCDate() === 1 && e.getUTCMonth() === 11 && e.getUTCDate() === 31 && s.getUTCFullYear() === e.getUTCFullYear()) return `Full year ${s.getUTCFullYear()}`
  return `${fmt(s)} – ${fmt(e)}`
}

function Stat({ value, label, loading }: { value: string | number; label: string; loading?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dd className="m-0 font-display text-[28px] font-semibold leading-none tracking-tight text-fg tabular-nums">
        {loading ? <span className="inline-block h-7 w-10 rounded-md ui-skeleton" /> : value}
      </dd>
      <dt className="text-[12.5px] text-fg-3">{label}</dt>
    </div>
  )
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ember-300">{eyebrow}</p>
      <h2 className="m-0 text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">{title}</h2>
      {children && <p className="mt-4 text-[15.5px] leading-relaxed text-fg-2">{children}</p>}
    </div>
  )
}

export default function HomePage() {
  const catalog = useCatalog()
  const analyses = useWorkspaceAnalyses('')
  const areas = useWorkspaceAreas()
  const rows = (analyses.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((row) => ['ready', 'partial'].includes(row.status))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const areaById = new Map((areas.data?.pages.flatMap((page) => page.items) ?? []).map((area) => [area.id, area]))
  // Prefer full-year historical examples for the showcase.
  const seenAreas = new Set<string>()
  const featured = [...rows]
    .sort((a, b) => Number(b.start_date.endsWith('01-01')) - Number(a.start_date.endsWith('01-01')))
    .filter((row) => (seenAreas.has(row.area_id) ? false : (seenAreas.add(row.area_id), true)))
    .slice(0, 3)
  const example = featured[0]

  return (
    <div className="relative overflow-x-clip">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative isolate">
        <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(70%_60%_at_60%_30%,black,transparent)]" aria-hidden="true" />
        <div className="mx-auto grid max-w-[1320px] items-center gap-10 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <motion.a
              href="https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/"
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-2 rounded-full border border-ember-400/25 bg-ember-500/[0.08] py-1 pl-1.5 pr-3 text-[12.5px] text-ember-200 no-underline transition-colors hover:border-ember-400/45"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
            >
              <span className="rounded-full bg-ember-gradient px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-950">Space Apps 2026</span>
              MODIS &amp; VIIRS Hot Spots challenge
              <ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
            </motion.a>
            <motion.h1
              className="mb-0 mt-6 text-[clamp(38px,5.4vw,66px)] font-semibold leading-[1.02] tracking-[-0.04em] text-fg"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.08, ease }}
            >
              A consistent fire history across <span className="text-ember-gradient">changing satellites</span>.
            </motion.h1>
            <motion.p
              className="mt-6 max-w-xl text-[17px] leading-relaxed text-fg-2"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.16, ease }}
            >
              FIREBRIDGE turns 26 years of NASA MODIS and VIIRS active-fire records into an explorable, reproducible calendar of burning activity for any place, while keeping every sensor difference visible.
            </motion.p>
            <motion.div
              className="mt-8 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.24, ease }}
            >
              <Link to="/analyses" className="ui-button ui-button--primary ui-button--large group">
                Start an analysis
                <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
              {example ? (
                <Link to={`/analyses?analysis=${encodeURIComponent(example.id)}`} className="ui-button ui-button--large">
                  <Satellite size={16} aria-hidden="true" />
                  Open a live example
                </Link>
              ) : (
                <Link to="/dashboard" className="ui-button ui-button--large">Browse saved analyses</Link>
              )}
            </motion.div>
            <motion.dl
              className="mt-12 grid max-w-xl grid-cols-2 gap-6 border-t border-white/[0.07] pt-7 sm:grid-cols-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              <Stat value="5" label="satellites" />
              <Stat value="26 yrs" label="of fire records" />
              <Stat value={catalog.data?.sources.length ?? '—'} label="source streams" loading={catalog.isPending} />
              <Stat value={catalog.data?.releases.length ?? '—'} label="published releases" loading={catalog.isPending} />
            </motion.dl>
          </div>
          <motion.div
            className="relative mx-auto w-full max-w-[560px]"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, delay: 0.1, ease }}
          >
            <OrbitGlobe />
          </motion.div>
        </div>
      </section>

      <div className="mx-auto flex max-w-[1320px] flex-col gap-28 px-5 pb-24 sm:px-8">
        {/* ── The problem ─────────────────────────────────────────────────── */}
        <section className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <SectionTitle eyebrow="The problem" title={<>Same fire. Different satellite. <span className="text-fg-3">Different count.</span></>}>
              VIIRS sees the ground in 375 m pixels; MODIS in 1 km pixels. A single fire front lights up many more VIIRS pixels, and small fires can be invisible to MODIS. Comparing 2010 with 2020 by adding detections mixes real change with sensor change.
            </SectionTitle>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {[
                ['Resolution', 'MODIS 1 km · VIIRS 375 m'],
                ['Overpass time', 'Terra ~10:30 · Aqua & VIIRS ~13:30 local'],
                ['Record span', 'MODIS since 2000 · VIIRS since 2012'],
              ].map(([label, value]) => (
                <li key={label} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <span className="text-[13px] text-fg-3">{label}</span>
                  <span className="font-mono text-[12.5px] text-fg">{value}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1} className="card p-5 sm:p-7">
            <PixelComparison />
            <p className="mb-0 mt-5 flex items-start gap-2.5 text-[13.5px] leading-relaxed text-fg-2">
              <ScanSearch size={17} className="mt-0.5 shrink-0 text-ember-300" aria-hidden="true" />
              Illustrative 3 × 3 km scene. More detections from a finer sensor do not mean more burning. FIREBRIDGE keeps each record native and labelled so the difference stays visible.
            </p>
          </Reveal>
        </section>

        {/* ── Timeline ─────────────────────────────────────────────────────── */}
        <section>
          <Reveal>
            <SectionTitle eyebrow="Five satellites, one history" title="Twenty-six years of observation, with a fourteen-year bridge.">
              MODIS and VIIRS have flown together since 2012. That overlap is what lets FIREBRIDGE compare sensors over the same places and dates, and it underpins the proposed Aqua-equivalent harmonization.
            </SectionTitle>
          </Reveal>
          <Reveal delay={0.05} className="card px-5 pb-6 pt-8 sm:px-8">
            <SensorTimeline />
            <p className="mb-0 mt-5 text-[12px] text-fg-3">Approximate active-fire record spans. Each analysis exposes the archive availability it actually used.</p>
          </Reveal>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section>
          <Reveal>
            <SectionTitle eyebrow="How it works" title="From a place on the map to traceable evidence." />
          </Reveal>
          <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <Reveal as="li" key={title} delay={index * 0.08} className="group card relative overflow-hidden p-6 transition-transform duration-300 hover:-translate-y-1">
                <span className="pointer-events-none absolute -right-6 -top-10 font-display text-[120px] font-semibold leading-none text-white/[0.025]" aria-hidden="true">{index + 1}</span>
                <span className="grid size-11 place-items-center rounded-xl border border-ember-400/20 bg-ember-500/10 text-ember-300 transition-colors group-hover:bg-ember-500/20">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3 className="mb-0 mt-5 text-[17px] font-semibold text-fg">{title}</h3>
                <p className="mb-0 mt-2 text-[13.5px] leading-relaxed text-fg-2">{text}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ── Live analyses ────────────────────────────────────────────────── */}
        <section>
          <Reveal className="flex flex-wrap items-end justify-between gap-4">
            <SectionTitle eyebrow="Live on the server" title="Jump into a real analysis." >
              Each one is pinned to an immutable data release, so the map, calendar, exports and explanation always agree.
            </SectionTitle>
            <Link to="/dashboard" className="ui-button mb-10">
              All analyses <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {analyses.isPending
              ? Array.from({ length: 3 }, (_, index) => <div key={index} className="ui-skeleton h-[188px] rounded-2xl" />)
              : featured.length
                ? featured.map((row, index) => {
                    const area = areaById.get(row.area_id)
                    return (
                      <Reveal key={row.id} delay={index * 0.08}>
                        <Link
                          to={`/analyses?analysis=${encodeURIComponent(row.id)}`}
                          className="group card flex h-full flex-col gap-4 p-5 no-underline transition-[transform,border-color] duration-300 hover:-translate-y-1 hover:border-ember-400/30"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="grid size-16 place-items-center overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900 text-fg-3">
                              <AreaShape geometry={area?.geometry} size={64} label={`Outline of ${area?.name ?? 'study area'}`} />
                            </span>
                            <StatusPill value={row.status} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="m-0 line-clamp-2 text-[16px] font-semibold leading-snug text-fg">{area?.name ?? 'Saved study area'}</h3>
                            <p className="mb-0 mt-1.5 flex items-center gap-1.5 text-[13px] text-fg-2">
                              <Clock3 size={13} aria-hidden="true" />
                              {formatInterval(row.start_date, row.end_date_exclusive)}
                            </p>
                          </div>
                          <span className="mt-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-ember-300">
                            Open in workspace
                            <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
                          </span>
                        </Link>
                      </Reveal>
                    )
                  })
                : (
                  <div className="card col-span-full flex flex-col items-center gap-3 p-10 text-center">
                    <Layers2 size={26} className="text-ember-300" aria-hidden="true" />
                    <p className="m-0 text-fg-2">{analyses.isError ? 'Saved analyses are unavailable right now.' : 'No ready analyses yet. Be the first to run one.'}</p>
                    <Link to="/analyses" className="ui-button ui-button--primary">Start an analysis</Link>
                  </div>
                )}
          </div>
        </section>

        {/* ── Honest by design ─────────────────────────────────────────────── */}
        <section className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal>
            <SectionTitle eyebrow="Honest by design" title="What the data can and cannot say.">
              FIREBRIDGE computes every number from the saved result and discloses what is missing. The explanation never invents incidents, causes, burned area or confirmations.
            </SectionTitle>
            <div className="flex flex-col gap-2.5 text-[13.5px] text-fg-2">
              {[
                [ShieldCheck, 'Immutable, versioned releases with checksums'],
                [FileSearch, 'Provenance for every record and export'],
                [Database, 'Missing sources shown as missing, never as zero'],
              ].map(([Icon, text]) => {
                const I = Icon as typeof ShieldCheck
                return (
                  <span key={text as string} className="flex items-center gap-2.5">
                    <I size={16} className="text-ok" aria-hidden="true" />
                    {text as string}
                  </span>
                )
              })}
            </div>
          </Reveal>
          <div className="grid gap-3 sm:grid-cols-2">
            {principles.map((item, index) => (
              <Reveal key={item.claim} delay={index * 0.05} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-white/[0.12]">
                <p className="m-0 flex items-center gap-2 font-display text-[16px] font-semibold text-fg">
                  <CheckCircle2 size={16} className="shrink-0 text-ember-300" aria-hidden="true" />
                  {item.claim}
                </p>
                <p className="mb-0 mt-2 text-[13.5px] leading-relaxed text-fg-2">{item.truth}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <Reveal className="relative overflow-hidden rounded-3xl border border-ember-400/20 p-8 sm:p-12">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_100%_0%,rgba(255,95,31,0.22),transparent_60%),radial-gradient(60%_100%_at_0%_100%,rgba(255,181,71,0.10),transparent_60%)]" aria-hidden="true" />
          <div className="absolute inset-0 -z-10 bg-grid opacity-60 [mask-image:linear-gradient(90deg,transparent,black)]" aria-hidden="true" />
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-xl">
              <h2 className="m-0 text-[clamp(26px,3vw,36px)] font-semibold leading-tight tracking-[-0.03em]">Pick a place. See its fire history.</h2>
              <p className="mb-0 mt-3 text-[15.5px] text-fg-2">Free and public, with no sign-in. Draw an area and get a reproducible, evidence-linked analysis in seconds.</p>
            </div>
            <Link to="/analyses" className="ui-button ui-button--primary ui-button--large group">
              Open the workspace
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </div>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-4 px-5 py-8 text-[12.5px] text-fg-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="flex items-center gap-3">
            <LogoMark size={26} />
            FIREBRIDGE · NASA Space Apps Challenge 2026
          </span>
          <span>Data: NASA FIRMS active-fire products (MODIS, VIIRS). For exploration and historical comparison, not an emergency warning system.</span>
        </div>
      </footer>
    </div>
  )
}
