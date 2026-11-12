import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, History, Layers } from 'lucide-react'
import { useRelease } from '../../hooks/useDataApi'
import { useCursorPage } from '../../hooks/useCursorPage'
import { sensorMeta } from '../../lib/sensors'
import type { ReleaseAlias } from '../../services/catalog.service'
import type { Detail, ReleaseSummary } from '../../services/data.types'
import { CopyableId } from '../../components/ui/CopyableId'
import { FeedbackMessage } from '../../components/FeedbackMessage'
import { ALIAS_INFO, describeChange, formatBytes, formatCount, formatDate, lastDayBefore, releaseTitle, seriesSource } from './describe'

function ordinal(n: number): string {
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

function Validation({ status }: { status?: string }) {
  const ok = status === 'validated' || status === 'accepted'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${ok ? 'border-ok/25 bg-ok/[0.07] text-ok' : 'border-white/10 text-fg-3'}`}>
      {ok ? <CheckCircle2 size={11} aria-hidden="true" /> : <CircleDashed size={11} aria-hidden="true" />}
      {status ?? 'unknown'}
    </span>
  )
}

function SourceDot({ source }: { source: string }) {
  const meta = sensorMeta(source)
  return <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} title={meta.label} aria-hidden="true" />
}

function ReleaseCard({ release, alias, selected, onInspect }: { release: ReleaseSummary; alias?: ReleaseAlias; selected: boolean; onInspect: () => void }) {
  const detail = useRelease(release.id, { membership: 'partitions', limit: 1 })
  const data = detail.data?.data
  const counts = data?.partition_counts?.[0] as { partitions?: number; row_count?: string } | undefined
  const info = alias ? ALIAS_INFO[alias.alias] : undefined
  const generation = alias ? Number(alias.generation) : NaN
  return (
    <article
      className={`card flex flex-col gap-4 p-5 transition-[border-color,transform] duration-300 ${selected ? '!border-ember-400/45' : 'hover:-translate-y-0.5 hover:border-white/[0.14]'}`}
      aria-labelledby={`release-${release.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-3">{alias?.alias.replaceAll('_', ' ') ?? release.dataset_kind}</p>
          <h3 id={`release-${release.id}`} className="m-0 mt-1 text-[18px] font-semibold leading-snug text-fg">{releaseTitle(release.name, alias?.alias)}</h3>
        </div>
        {detail.isPending ? <span className="ui-skeleton h-5 w-20 rounded-full" /> : <Validation status={data?.validation_status} />}
      </div>
      {info && <p className="m-0 font-sans text-[13.5px] leading-relaxed text-fg-2">{info.text}</p>}
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.06] pt-4">
        <div>
          <dt className="font-sans text-[11.5px] text-fg-3">Published</dt>
          <dd className="m-0 mt-0.5 font-sans text-[13.5px] text-fg">{formatDate(release.published_at)}</dd>
        </div>
        <div>
          <dt className="font-sans text-[11.5px] text-fg-3">Observations up to</dt>
          <dd className="m-0 mt-0.5 font-sans text-[13.5px] text-fg">{lastDayBefore(release.observation_cutoff)}</dd>
        </div>
        <div>
          <dt className="font-sans text-[11.5px] text-fg-3">Records</dt>
          <dd className="m-0 mt-0.5 font-sans text-[13.5px] text-fg">
            {detail.isPending ? '…' : counts ? `${formatCount(counts.row_count)} in ${formatCount(counts.partitions)} daily partitions` : 'Prepared per analysis'}
          </dd>
        </div>
        <div>
          <dt className="font-sans text-[11.5px] text-fg-3">Version</dt>
          <dd className="m-0 mt-0.5 font-sans text-[13.5px] text-fg">{Number.isFinite(generation) ? `${ordinal(generation)} generation` : '—'}</dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-3">
        <CopyableId value={release.id} label="release ID" />
        <button type="button" onClick={onInspect} aria-pressed={selected} className={`inline-flex items-center gap-1.5 rounded-lg border-0 px-3 py-1.5 font-sans text-[13px] font-medium ${selected ? 'bg-ember-500/20 text-ember-100' : 'bg-white/[0.05] text-fg hover:bg-white/[0.09]'}`}>
          {selected ? 'Inspecting' : 'Look inside'} <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

function Explorer({ release, alias }: { release: ReleaseSummary; alias?: ReleaseAlias }) {
  const [membership, setMembership] = useState<'partitions' | 'assets'>('partitions')
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-[18px] font-semibold text-fg">{releaseTitle(release.name, alias?.alias)}</h3>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg border border-white/[0.08] p-0.5">
          {(['partitions', 'assets'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={membership === value}
              onClick={() => setMembership(value)}
              className={`rounded-md border-0 px-3 py-1 font-sans text-[12.5px] ${membership === value ? 'bg-white/10 text-fg' : 'bg-transparent text-fg-3 hover:text-fg-2'}`}
            >
              {value === 'partitions' ? 'Daily partitions' : 'Source files'}
            </button>
          ))}
        </div>
      </div>
      <ExplorerPage key={`${release.id}:${membership}`} id={release.id} membership={membership} />
    </div>
  )
}

function ExplorerPage({ id, membership }: { id: string; membership: 'partitions' | 'assets' }) {
  const page = useCursorPage()
  const query = useRelease(id, { membership, limit: 10, cursor: page.cursor })
  if (query.isError) return <div className="mt-4"><FeedbackMessage context="catalogue" error={query.error} retry={() => { void query.refetch() }} /></div>
  const data = query.data?.data
  if (!data) return <div className="mt-5 flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="ui-skeleton h-11 rounded-xl" />)}</div>
  const sources = [...new Set(data.source_composition.map((row) => String(row.source_id)))]
  const items = data.membership.items
  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[16rem_1fr]">
      <div className="flex flex-col gap-5">
        <section aria-label="Sources in this release">
          <h4 className="m-0 flex items-center gap-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-3"><Layers size={13} aria-hidden="true" /> Sources</h4>
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
            {sources.map((source) => (
              <li key={source} className="flex items-center gap-2 font-sans text-[13px] text-fg-2">
                <SourceDot source={source} />
                <span className="min-w-0 truncate" title={source}>{sensorMeta(source).label}</span>
                <span className="ml-auto truncate font-mono text-[10.5px] text-fg-3">{source.replace(/-standard$/, '')}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="What changed">
          <h4 className="m-0 flex items-center gap-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-3"><History size={13} aria-hidden="true" /> What changed</h4>
          {data.change_summary.length
            ? <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">{data.change_summary.map((change, i) => <li key={i} className="font-sans text-[13px] leading-relaxed text-fg-2">{describeChange(change)}</li>)}</ul>
            : <p className="m-0 mt-2.5 font-sans text-[13px] text-fg-3">No revision recorded for this release.</p>}
        </section>
      </div>
      <section aria-label={membership === 'partitions' ? 'Daily partitions' : 'Source files'}>
        {items.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-white/10 p-5 font-sans text-[13.5px] text-fg-2">
            {membership === 'partitions'
              ? 'This release lists no stored partitions: it is a catalogue of the archive, and records are prepared separately for each analysis.'
              : 'No source files are listed for this release.'}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {items.map((item, index) => <MemberRow key={String(item.partition_id ?? item.asset_id ?? index)} item={item} membership={membership} />)}
          </ul>
        )}
        {(items.length > 0 || !page.first) && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" disabled={page.first} onClick={page.back} className="inline-flex items-center gap-1 rounded-lg border-0 bg-white/[0.05] px-3 py-1.5 font-sans text-[12.5px] text-fg enabled:hover:bg-white/[0.09] disabled:opacity-35"><ArrowLeft size={13} aria-hidden="true" /> Previous</button>
            <button type="button" disabled={!data.membership.next_cursor} onClick={() => data.membership.next_cursor && page.next(data.membership.next_cursor)} className="inline-flex items-center gap-1 rounded-lg border-0 bg-white/[0.05] px-3 py-1.5 font-sans text-[12.5px] text-fg enabled:hover:bg-white/[0.09] disabled:opacity-35">Next <ArrowRight size={13} aria-hidden="true" /></button>
          </div>
        )}
      </section>
    </div>
  )
}

function MemberRow({ item, membership }: { item: Detail; membership: 'partitions' | 'assets' }) {
  const source = membership === 'partitions' ? seriesSource(item.series_key) : String(item.source_id ?? '')
  const sha = typeof item.sha256 === 'string' ? item.sha256 : ''
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-sans text-[13px] text-fg">
        <SourceDot source={source} />
        <span className="whitespace-nowrap">{sensorMeta(source).label}</span>
        <span className="whitespace-nowrap font-mono text-[10.5px] text-fg-3">{membership === 'partitions' ? formatDate(String(item.partition_key)) : String(item.role ?? '').replaceAll('_', ' ')}</span>
      </span>
      <span className="text-right font-mono text-[12px] tabular-nums text-fg-2 sm:text-left">
        {membership === 'partitions' ? `${formatCount(item.row_count)} rows` : formatBytes(item.byte_size)}
      </span>
      <span className="justify-self-start"><Validation status={typeof item.validation_status === 'string' ? item.validation_status : undefined} /></span>
      {sha ? <CopyableId value={sha} label="SHA-256 checksum" shortLength={10} /> : <span />}
    </li>
  )
}

/** Release cards plus an explorer of the selected release's contents. */
export function ReleasesSection({ releases, aliases }: { releases: ReleaseSummary[]; aliases: ReleaseAlias[] }) {
  const [selectedId, setSelectedId] = useState('')
  const explorer = useRef<HTMLDivElement>(null)
  const aliasOf = (id: string) => aliases.find((a) => a.release_id === id)
  // Policies people choose between first, then the archive catalogue, then anything unnamed.
  const ORDER = ['standard_only', 'best_available', 'historical_archive']
  const rank = (r: ReleaseSummary) => {
    const position = ORDER.indexOf(aliasOf(r.id)?.alias ?? '')
    return position === -1 ? ORDER.length : position
  }
  const ordered = [...releases].sort((a, b) => rank(a) - rank(b))
  const selected = ordered.find((r) => r.id === selectedId) ?? ordered[0]
  if (!selected) return <p className="m-0 font-sans text-[14px] text-fg-2">No release has been published yet.</p>
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {ordered.map((release) => (
          <ReleaseCard
            key={release.id}
            release={release}
            alias={aliasOf(release.id)}
            selected={release.id === selected.id}
            onInspect={() => {
              setSelectedId(release.id)
              explorer.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
            }}
          />
        ))}
      </div>
      <div ref={explorer} className="scroll-mt-20">
        <Explorer key={selected.id} release={selected} alias={aliasOf(selected.id)} />
      </div>
    </div>
  )
}
