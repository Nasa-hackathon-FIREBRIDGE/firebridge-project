import { Link } from 'react-router-dom'
import { ArrowRight, Database, Library, RefreshCw, Ruler, Sigma } from 'lucide-react'
import { HISTORICAL_MAX_WINDOW_DAYS } from '@firebridge/contracts/analysis-limits'
import { useCatalog } from '../hooks/useCatalog'
import { Reveal } from '../components/ui/Reveal'
import { FeedbackMessage } from '../components/FeedbackMessage'
import { SourcesSection } from './catalog/SourcesSection'
import { ReleasesSection } from './catalog/ReleasesSection'
import { formatCount, formatDate, groupSources } from './catalog/describe'

function SectionTitle({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 max-w-2xl">
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ember-300">{eyebrow}</p>
      <h2 id={id} className="m-0 text-[clamp(24px,3vw,34px)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">{title}</h2>
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

export default function CatalogPage() {
  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useCatalog()
  const latest = data?.releases.reduce((max, r) => (r.published_at > max ? r.published_at : max), '')
  const satellites = data ? groupSources(data.sources).filter((g) => g.key !== 'other').length : 0
  const metric = data?.metrics?.[0]

  return (
    <div className="relative overflow-x-clip">
      <section className="relative isolate">
        <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(70%_60%_at_30%_20%,black,transparent)]" aria-hidden="true" />
        <div className="mx-auto max-w-[1180px] px-5 pb-12 pt-12 sm:px-8 lg:pt-16">
          <p className="m-0 inline-flex items-center gap-2 rounded-full border border-ember-400/25 bg-ember-500/[0.08] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-200">
            <Database size={13} aria-hidden="true" /> Data catalogue
          </p>
          <h1 className="mb-0 mt-6 max-w-3xl text-[clamp(34px,4.8vw,56px)] font-semibold leading-[1.04] tracking-[-0.04em] text-fg">
            What the server holds <span className="text-ember-gradient">right now</span>.
          </h1>
          <p className="mt-6 max-w-2xl font-sans text-[17px] leading-relaxed text-fg-2">
            The satellite sources FIREBRIDGE reads, and the frozen data releases behind every analysis. A release never changes once published, so a saved analysis always shows the same numbers.
          </p>
          <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-6 border-t border-white/[0.07] pt-7 sm:grid-cols-4">
            <Stat value={data ? String(satellites) : '—'} label="satellites" />
            <Stat value={data ? String(data.sources.length) : '—'} label="source streams" />
            <Stat value={data ? String(data.releases.length) : '—'} label="published releases" />
            <Stat value={latest ? formatDate(latest) : '—'} label="latest publication" />
          </dl>
          <p className="mb-0 mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[12px] text-fg-3">
            <span>Live from the FIREBRIDGE API{data ? ` · scope ${data.scope_key}` : ''}{dataUpdatedAt ? ` · checked ${clock(dataUpdatedAt)} UTC` : ''}</span>
            <button type="button" onClick={() => { void refetch() }} disabled={isFetching} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-sans text-[12px] text-ember-300 enabled:hover:text-ember-200 disabled:opacity-50">
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
          </p>
        </div>
      </section>

      <div className="mx-auto flex max-w-[1180px] flex-col gap-20 px-5 pb-24 sm:px-8">
        {isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading the published catalogue">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="ui-skeleton h-44 rounded-2xl" />)}
          </div>
        ) : isError ? (
          <FeedbackMessage context="catalogue" error={error} retry={() => { void refetch() }} />
        ) : (
          <>
            <section aria-labelledby="sources-heading">
              <Reveal>
                <SectionTitle eyebrow="01 · Sources" id="sources-heading" title={`${plural(satellites, 'satellite')}, ${plural(data.sources.length, 'source stream')}.`}>
                  A source stream is one satellite’s records from one product collection and processing level. Streams are never merged silently: collections and processing levels stay separate, so a count always says where it came from.
                </SectionTitle>
              </Reveal>
              <SourcesSection sources={data.sources} />
            </section>

            <section aria-labelledby="releases-heading">
              <Reveal>
                <SectionTitle eyebrow="02 · Releases" id="releases-heading" title="Frozen snapshots, never edited.">
                  A release is a validated, checksummed snapshot of records. New data creates a new release instead of changing an old one, and a failed update leaves the previous release readable. Open one to see its sources, its history and every stored partition.
                </SectionTitle>
              </Reveal>
              <ReleasesSection releases={data.releases} aliases={data.release_aliases ?? []} />
            </section>

            <section aria-labelledby="limits-heading" className="grid gap-4 md:grid-cols-2">
              <h2 id="limits-heading" className="sr-only">What is measured and the limits</h2>
              <div className="card p-6">
                <Sigma size={18} className="text-ember-300" aria-hidden="true" />
                <h3 className="mb-0 mt-3 text-[17px] font-semibold text-fg">What is measured</h3>
                {metric ? (
                  <p className="mb-0 mt-2 font-sans text-[14px] leading-relaxed text-fg-2">
                    {metric.description} (version {metric.version}). It needs {metric.requires_masks ? 'fire masks' : 'no fire masks'} and {metric.requires_model ? 'a fitted model' : 'no model'}: a count of what the satellites recorded, not of fires or burned area.
                  </p>
                ) : (
                  <p className="mb-0 mt-2 font-sans text-[14px] text-fg-2">The server does not describe its metrics.</p>
                )}
              </div>
              <div className="card p-6">
                <Ruler size={18} className="text-ember-300" aria-hidden="true" />
                <h3 className="mb-0 mt-3 text-[17px] font-semibold text-fg">Limits per analysis</h3>
                <ul className="mb-0 mt-2 flex list-none flex-col gap-1.5 p-0 font-sans text-[14px] text-fg-2" aria-label="Limits per analysis">
                  {data.limits && <li>Study area up to <strong className="font-semibold text-fg">{formatCount(data.limits.max_aoi_area_km2)} km²</strong> and {formatCount(data.limits.max_aoi_vertices)} outline points</li>}
                  <li>Period up to <strong className="font-semibold text-fg">{formatCount(HISTORICAL_MAX_WINDOW_DAYS)} days</strong>, about 30 years</li>
                  {data.limits?.max_points_per_page && <li>Map pages of up to {formatCount(data.limits.max_points_per_page)} detections</li>}
                </ul>
              </div>
            </section>

            <Reveal className="relative overflow-hidden rounded-3xl border border-ember-400/20 p-8 sm:p-10">
              <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_100%_0%,rgba(255,95,31,0.18),transparent_60%)]" aria-hidden="true" />
              <h2 className="m-0 text-[clamp(22px,2.6vw,30px)] font-semibold leading-tight tracking-[-0.03em]">How these records were made</h2>
              <p className="mb-0 mt-3 max-w-xl font-sans text-[15px] text-fg-2">Follow a detection from NASA’s servers through the audit, the index and your analysis, or see every source and licence.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/evidence" className="ui-button ui-button--primary group">Data & methods <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></Link>
                <Link to="/sources" className="ui-button"><Library size={15} aria-hidden="true" /> Sources & credits</Link>
              </div>
            </Reveal>
          </>
        )}
      </div>
    </div>
  )
}
