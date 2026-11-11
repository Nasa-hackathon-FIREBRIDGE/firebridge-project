import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CloudDownload,
  CloudRain,
  Database,
  EyeOff,
  GitCompareArrows,
  Grid3x3,
  Hourglass,
  Library,
  Lock,
  MessagesSquare,
  Radio,
  Satellite,
  Scissors,
  ShieldCheck,
  Telescope,
  type LucideIcon,
} from 'lucide-react'
import { Reveal } from '../components/ui/Reveal'
import { ArchiveBars } from './methods/ArchiveBars'
import {
  ARCHIVE,
  ARCHIVE_GIB,
  ARCHIVE_TOTAL_ROWS,
  AUDIT_DATE,
  AUDITED_WINDOWS,
  EMPTY_WINDOWS,
  INDEXED_WINDOWS,
  INVALID_FRP_VALUES,
  MAX_ANALYSIS_DAYS,
  MOROCCO_2020_BEFORE_SECONDS,
  MOROCCO_2020_SECONDS,
  PIPELINE_REPO,
  UNLABELLED_MODIS_WINDOWS,
  millions,
  monthYear,
  usedRows,
} from './methods/facts'

type Status = 'done' | 'experimental' | 'live'

interface Step {
  icon: LucideIcon
  kicker: string
  title: string
  text: string
  status: Status
  figure: string
  figureLabel: string
  detail: string[]
}

const count = (value: number) => value.toLocaleString('en-US')

const steps: Step[] = [
  {
    icon: CloudDownload,
    kicker: 'Download',
    title: 'Collected from NASA FIRMS, five days at a time',
    text: 'Each satellite’s entire fire record was requested for the whole planet in slices of at most five days, and saved exactly as NASA sent it.',
    status: 'done',
    figure: count(AUDITED_WINDOWS),
    figureLabel: 'worldwide five-day windows',
    detail: [
      'Before downloading, the FIRMS availability service is asked what exists. The target is frozen at the last complete UTC day, so a half-collected day is never treated as complete.',
      'Standard-quality files come first. The near-real-time tail is added only after the standard period ends, so the two never overlap.',
      'Requests stay under 20 per ten minutes and pause whenever NASA signals a limit. A ledger records every window, so an interrupted download resumes where it stopped.',
      'The original response bytes are kept (gzip) with a SHA-256 checksum, next to a Parquet copy of every row.',
    ],
  },
  {
    icon: ShieldCheck,
    kicker: 'Check',
    title: 'Nothing is silently fixed or dropped',
    text: 'Every file is verified before it counts. Problems stay visible instead of being patched or thrown away.',
    status: 'done',
    figure: '0',
    figureLabel: `failed files in the audit of ${AUDIT_DATE}`,
    detail: [
      'Columns, satellite names, coordinates and dates are validated. A malformed window stops loudly rather than disappearing.',
      `${INVALID_FRP_VALUES} invalid fire radiative power values are kept as they arrived and flagged. Their analytical value is left empty, never set to zero.`,
      `${EMPTY_WINDOWS} windows came back empty. They are recorded as empty answers, not as proof that nothing burned.`,
      `${UNLABELLED_MODIS_WINDOWS} early MODIS windows carry no collection label. They are held for review instead of guessed.`,
      'MODIS Collections 6 and 6.1 remain separate sources, and near-real-time records are never relabelled as standard.',
    ],
  },
  {
    icon: Grid3x3,
    kicker: 'Index',
    title: 'Filed by place, so a request reads only what it needs',
    text: 'The archive is re-filed into regional pieces ordered by location, without changing a single value.',
    status: 'done',
    figure: count(INDEXED_WINDOWS),
    figureLabel: 'standard-history windows indexed',
    detail: [
      'Each five-day window is copied into regional Parquet shards in spatial order, so a reader can skip everything outside an area.',
      'Native values, duplicates and row identifiers are kept exactly. Publication requires a full row-by-row comparison with the audited input.',
      'A catalogue pins the checksum of every shard and of the original file it came from.',
    ],
  },
  {
    icon: Scissors,
    kicker: 'Prepare',
    title: 'Your area is cut from the archive on demand',
    text: 'When you draw an area and pick dates, only the matching records are pulled from the archive and clipped to your exact shape.',
    status: 'done',
    figure: `${MOROCCO_2020_SECONDS} s`,
    figureLabel: `northern Morocco, full year 2020 (was ${MOROCCO_2020_BEFORE_SECONDS} s)`,
    detail: [
      'Indexes skip files and row groups outside your dates and bounding box. PostGIS then applies your exact polygon, including holes and the antimeridian.',
      'Selected records are normalised and de-duplicated. One malformed required field rejects the whole result rather than leaving a silent gap.',
      'Analyses use standard-quality records only. Recent near-real-time records stay out instead of being mixed in.',
      `One analysis can span up to ${count(MAX_ANALYSIS_DAYS)} days, about 30 years.`,
    ],
  },
  {
    icon: Lock,
    kicker: 'Pin',
    title: 'Every result is frozen, so every view agrees',
    text: 'Your analysis is saved against one immutable data release. The map, calendar, exports and explanation all read that same release.',
    status: 'done',
    figure: 'SHA-256',
    figureLabel: 'fingerprint on every input file',
    detail: [
      'All partitions and the release are published in one database transaction. A failed job publishes nothing, and the previous release stays readable.',
      'The analysis stores its release ID once, so newer data never changes a saved result.',
      'The Data & provenance tab of every analysis lists its inputs, validation status and checksums.',
    ],
  },
  {
    icon: GitCompareArrows,
    kicker: 'Compare',
    title: 'Sensor differences measured, a common scale estimated',
    text: 'Native counts per satellite always stay visible. Beside them, an Aqua-equivalent record estimates what one reference satellite would have seen.',
    status: 'experimental',
    figure: '5 km',
    figureLabel: 'equal-area cells (EASE-Grid 2.0)',
    detail: [
      'Daytime detections of presumed vegetation fires (FIRMS type 0) are placed on 5 km equal-area cells by local solar day. One active cell on one day is the unit.',
      'Aqua MODIS is the reference while it passes within 30 minutes of its original afternoon time. Years after its orbit drifted are estimated from VIIRS instead of trusted.',
      'Three models are tested, from a simple count ratio to an FRP-aware Poisson model. The complex one is used only when a bootstrap test shows it beats the simpler ones on withheld periods.',
      'Each estimate is checked by hiding Aqua, predicting it from VIIRS and revealing the real record. A rehearsed “Aqua goes dark” switch counts false alarms.',
      'This runs in your browser (fb-bridge 1.1.0). It has not been independently validated, and the server still reports a harmonized response as unsupported.',
    ],
  },
  {
    icon: MessagesSquare,
    kicker: 'Explain',
    title: 'A language model puts the facts into words. It never computes them.',
    text: 'The copilot answers questions about an analysis in English, French or Arabic, using only facts calculated from its pinned release.',
    status: 'live',
    figure: 'Every number',
    figureLabel: 'checked against the analysis facts',
    detail: [
      'Facts are computed in code from the analysis and its sensor-bridge report. The model only writes the sentences around them.',
      'Every number in an answer is matched against those facts. An unsupported number is flagged and the answer repaired; if every model is at its limit, the facts are shown on their own.',
      'Models: Qwen3.8 27B first, then gpt-oss-120b and gpt-oss-20b, served through Groq. ALLaM 2 7B handles housekeeping and never writes answers.',
      'Its instructions state that missing data is never zero, that the harmonized record is an estimate rather than ground truth, and that these data are not fire counts, burned area or causes.',
    ],
  },
]

const limits: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: EyeOff, title: 'No fire is not the same as not seen', text: 'Fire masks and cloud flags are not ingested yet, so the pipeline cannot tell a clear-sky “no fire” from a missed look. Observation coverage is reported as unknown.' },
  { icon: Telescope, title: 'Harmonization is not independently evaluated', text: 'The Aqua-equivalent record is tested inside each analysis, but not yet in a separate region or against an external reference.' },
  { icon: Hourglass, title: 'Standard records stop in mid-2026', text: 'NASA replaces near-real-time fire records with standard-quality ones after a few months. Each analysis shows the exact end per satellite; newer records are archived but left out.' },
  { icon: CloudRain, title: 'Weather and reports are not published yet', text: 'Pipelines for ERA5 weather and dated reports exist, but no release covers the saved analyses yet. That is why they show as Partial.' },
  { icon: Radio, title: 'A snapshot, not a live feed', text: 'The download plan ends on 6 Nov 2026. Automatic updates stay switched off until a policy for reconciling new data is in place.' },
  { icon: Satellite, title: 'Landsat is archived, not used', text: 'FIRMS Landsat 8 and 9 detections cover only the United States and Canada, so analyses leave them out.' },
]

const statusLabel: Record<Status, string> = { done: 'In production', experimental: 'Experimental · not independently validated', live: 'Live · language model' }
const statusTone: Record<Status, string> = {
  done: 'border-ok/25 bg-ok/[0.07] text-ok',
  experimental: 'border-warn/30 bg-warn/[0.08] text-warn',
  live: 'border-snpp/30 bg-snpp/[0.08] text-snpp',
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ember-300">{eyebrow}</p>
      <h2 className="m-0 text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">{title}</h2>
      {children && <p className="mt-4 font-sans text-[15.5px] leading-relaxed text-fg-2">{children}</p>}
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dd className="m-0 font-display text-[28px] font-semibold leading-none tracking-tight text-fg tabular-nums">{value}</dd>
      <dt className="font-sans text-[12.5px] text-fg-3">{label}</dt>
    </div>
  )
}

function StepCard({ step, index }: { step: Step; index: number }) {
  const Icon = step.icon
  return (
    <Reveal as="li" delay={0.04} className="relative grid grid-cols-[2.75rem_1fr] gap-x-4 sm:gap-x-6">
      <div className="relative flex flex-col items-center">
        <span className={`relative z-10 grid size-11 place-items-center rounded-xl border ${step.status === 'done' ? 'border-ember-400/25 bg-ember-500/10 text-ember-300' : step.status === 'experimental' ? 'border-warn/30 bg-warn/10 text-warn' : 'border-snpp/30 bg-snpp/10 text-snpp'}`}>
          <Icon size={20} aria-hidden="true" />
        </span>
        {index < steps.length - 1 && <span className="mt-2 w-px flex-1 bg-gradient-to-b from-ember-400/40 to-white/[0.05]" aria-hidden="true" />}
      </div>
      <article className="card mb-5 p-5 sm:p-6" aria-labelledby={`step-${index}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">
            {String(index + 1).padStart(2, '0')} · {step.kicker}
          </span>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium ${statusTone[step.status]}`}>{statusLabel[step.status]}</span>
        </div>
        <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_11rem]">
          <div>
            <h3 id={`step-${index}`} className="m-0 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-fg">{step.title}</h3>
            <p className="mb-0 mt-2 font-sans text-[14.5px] leading-relaxed text-fg-2">{step.text}</p>
          </div>
          <div className="lg:text-right">
            <p className="m-0 font-display text-[26px] font-semibold leading-none tracking-tight text-fg tabular-nums">{step.figure}</p>
            <p className="m-0 mt-1.5 font-sans text-[12px] leading-snug text-fg-3">{step.figureLabel}</p>
          </div>
        </div>
        <details className="group mt-4 border-t border-white/[0.06] pt-3">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 font-sans text-[13px] font-medium text-ember-300 hover:text-ember-200 [&::-webkit-details-marker]:hidden">
            How it works
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="mb-0 mt-3 flex list-none flex-col gap-2.5 p-0">
            {step.detail.map((line) => (
              <li key={line} className="relative pl-4 font-sans text-[13.5px] leading-relaxed text-fg-2 before:absolute before:left-0 before:top-[0.6em] before:size-1.5 before:rounded-full before:bg-ember-400/60">
                {line}
              </li>
            ))}
          </ul>
        </details>
      </article>
    </Reveal>
  )
}

export default function EvidencePage() {
  const first = ARCHIVE.reduce((earliest, platform) => (platform.first < earliest ? platform.first : earliest), ARCHIVE[0].first)
  return (
    <div className="relative overflow-x-clip">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative isolate">
        <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(70%_60%_at_30%_20%,black,transparent)]" aria-hidden="true" />
        <div className="mx-auto max-w-[1100px] px-5 pb-14 pt-12 sm:px-8 lg:pt-16">
          <p className="m-0 inline-flex items-center gap-2 rounded-full border border-ember-400/25 bg-ember-500/[0.08] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-200">
            <Database size={13} aria-hidden="true" /> Data & methods
          </p>
          <h1 className="mb-0 mt-6 max-w-3xl text-[clamp(34px,4.8vw,58px)] font-semibold leading-[1.04] tracking-[-0.04em] text-fg">
            From a satellite pass to <span className="text-ember-gradient">your fire calendar</span>.
          </h1>
          <p className="mt-6 max-w-2xl font-sans text-[17px] leading-relaxed text-fg-2">
            Every detection in FIREBRIDGE comes from NASA FIRMS. Here is the whole journey: how the records were collected, checked, filed and cut to your area, and what is still missing before they can say more.
          </p>
          <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-6 border-t border-white/[0.07] pt-7 sm:grid-cols-4">
            <Stat value={millions(usedRows)} label="MODIS & VIIRS records archived" />
            <Stat value={monthYear(first)} label="earliest record (Terra)" />
            <Stat value="0" label={`failed files in ${count(AUDITED_WINDOWS)} audited`} />
            <Stat value={`${MOROCCO_2020_SECONDS} s`} label="to prepare Morocco · 2020" />
          </dl>
          <p className="mb-0 mt-5 font-sans text-[12px] text-fg-3">
            Figures from the archive audit of {AUDIT_DATE}. Code and receipts:{' '}
            <a href={PIPELINE_REPO} target="_blank" rel="noreferrer" className="text-fg-2 underline decoration-white/20 underline-offset-2 hover:text-fg">
              FIREBRIDGE data pipeline <ArrowUpRight size={11} className="inline" aria-hidden="true" />
            </a>
          </p>
        </div>
      </section>

      <div className="mx-auto flex max-w-[1100px] flex-col gap-24 px-5 pb-24 sm:px-8">
        {/* ── The archive ──────────────────────────────────────────────────── */}
        <section aria-labelledby="archive-heading">
          <Reveal>
            <SectionTitle eyebrow="01 · The archive" title={<span id="archive-heading">Every NASA FIRMS hotspot since November 2000.</span>}>
              {millions(ARCHIVE_TOTAL_ROWS)} rows across seven satellites, {ARCHIVE_GIB} GiB compressed. Each row is one hot pixel seen at one satellite pass. It is not one fire: a single fire front can light up dozens of pixels.
            </SectionTitle>
          </Reveal>
          <Reveal delay={0.05} className="card p-3 sm:p-5">
            <ArchiveBars />
            <p className="mx-3 mb-1 mt-4 font-sans text-[12px] leading-relaxed text-fg-3">
              Records per satellite, from zero. Dates combine standard and near-real-time files; analyses read only the standard ones. VIIRS counts more because its 375 m pixels are smaller than MODIS’s 1 km, not because more burned.
            </p>
          </Reveal>
        </section>

        {/* ── The journey ──────────────────────────────────────────────────── */}
        <section aria-labelledby="journey-heading">
          <Reveal>
            <SectionTitle eyebrow="02 · From orbit to your screen" title={<span id="journey-heading">Seven steps, each one checkable.</span>}>
              The first five steps run in production. The last two are where science meets interpretation, and they are labelled as such.
            </SectionTitle>
          </Reveal>
          <ol className="m-0 list-none p-0">
            {steps.map((step, index) => <StepCard key={step.kicker} step={step} index={index} />)}
          </ol>
        </section>

        {/* ── Honest limits ────────────────────────────────────────────────── */}
        <section aria-labelledby="limits-heading">
          <Reveal>
            <SectionTitle eyebrow="03 · Honest limits" title={<span id="limits-heading">What the pipeline does not do yet.</span>}>
              These gaps decide what the numbers can and cannot support. They are shown in every analysis too, wherever they apply.
            </SectionTitle>
          </Reveal>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {limits.map(({ icon: Icon, title, text }, index) => (
              <Reveal as="li" key={title} delay={index * 0.05} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-white/[0.12]">
                <Icon size={18} className="text-ember-300" aria-hidden="true" />
                <h3 className="mb-0 mt-3 text-[15.5px] font-semibold text-fg">{title}</h3>
                <p className="mb-0 mt-1.5 font-sans text-[13.5px] leading-relaxed text-fg-2">{text}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* ── Next ─────────────────────────────────────────────────────────── */}
        <Reveal className="relative overflow-hidden rounded-3xl border border-ember-400/20 p-8 sm:p-10">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_100%_0%,rgba(255,95,31,0.18),transparent_60%)]" aria-hidden="true" />
          <h2 className="m-0 text-[clamp(22px,2.6vw,30px)] font-semibold leading-tight tracking-[-0.03em]">Check it yourself.</h2>
          <p className="mb-0 mt-3 max-w-xl font-sans text-[15px] text-fg-2">Every figure above has a source. The live catalogue shows what the server holds right now, and the credits list every dataset and library with its licence.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/catalog" className="ui-button ui-button--primary group">
              Live data catalogue <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <Link to="/sources" className="ui-button">
              <Library size={15} aria-hidden="true" /> Sources & credits
            </Link>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
