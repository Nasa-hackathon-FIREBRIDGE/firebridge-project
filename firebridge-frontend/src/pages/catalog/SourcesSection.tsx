import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { CatalogSource } from '../../services/catalog.service'
import { availabilityLabel, groupSources, isRaw, streamDetail, streamTitle, type SatelliteGroup } from './describe'

function Stream({ source }: { source: CatalogSource }) {
  const raw = isRaw(source)
  return (
    <li>
      <details className="group/stream rounded-xl border border-white/[0.06] bg-white/[0.02] transition-colors open:bg-white/[0.035] hover:border-white/[0.12]">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block font-sans text-[13.5px] font-medium text-fg">{streamTitle(source)}</span>
            <span className="block truncate font-sans text-[12px] text-fg-3">{streamDetail(source)}</span>
          </span>
          {raw && <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-fg-3">input</span>}
          <ChevronDown size={14} className="shrink-0 text-fg-3 transition-transform group-open/stream:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-white/[0.05] px-3.5 py-3 font-sans text-[12.5px]">
          <dt className="text-fg-3">Source ID</dt><dd className="m-0 break-all font-mono text-[11.5px] text-fg-2">{source.source_id}</dd>
          <dt className="text-fg-3">Product</dt><dd className="m-0 text-fg-2">{source.product}</dd>
          <dt className="text-fg-3">Collection</dt><dd className="m-0 text-fg-2">{source.collection}</dd>
          <dt className="text-fg-3">Processing</dt><dd className="m-0 text-fg-2">{source.processing_stream}</dd>
          <dt className="text-fg-3">Availability</dt><dd className="m-0 text-fg-2">{availabilityLabel(source.availability_status)}</dd>
        </dl>
      </details>
    </li>
  )
}

/** Satellites of one instrument family share a row: MODIS (1 km) first, then VIIRS (375 m). */
function families(groups: SatelliteGroup[]) {
  const byInstrument = new Map<string, SatelliteGroup[]>()
  for (const group of groups) byInstrument.set(group.instrument, [...(byInstrument.get(group.instrument) ?? []), group])
  return [...byInstrument].map(([instrument, members]) => ({ instrument, pixel: members[0].pixel, members }))
}

/** Source streams grouped by satellite: one card per satellite, each stream explained in words. */
export function SourcesSection({ sources }: { sources: CatalogSource[] }) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const groups = groupSources(sources)
    .map((group) => ({
      ...group,
      streams: needle
        ? group.streams.filter((s) => [group.label, group.instrument, s.product, s.source_id, streamTitle(s)].some((v) => v?.toLowerCase().includes(needle)))
        : group.streams,
    }))
    .filter((group) => group.streams.length > 0)

  return (
    <div>
      <label className="mb-5 flex w-full max-w-sm items-center gap-2 rounded-xl border border-white/10 bg-ink-850 px-3 py-2 text-fg-3 focus-within:border-ember-400/50">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search catalogue sources"
          placeholder="Satellite, product or source…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="!w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-[13.5px] text-fg outline-none placeholder:text-fg-3"
        />
      </label>
      {groups.length === 0 ? (
        <p className="m-0 font-sans text-[14px] text-fg-2">{sources.length ? 'No source matches this search.' : 'No sources are published in this catalogue yet.'}</p>
      ) : (
        <div className="flex flex-col gap-8" role="group" aria-label="Sources by satellite">
          {families(groups).map(({ instrument, pixel, members }) => (
            <div key={instrument}>
              <p className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">{instrument} · {pixel} pixels</p>
              <ul className={`m-0 grid list-none gap-4 p-0 ${members.length >= 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2'}`} aria-label={`${instrument} satellites`}>
                {members.map((group) => (
                  <li key={group.key} className="card relative overflow-hidden p-5">
                    <span className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-20 blur-2xl" style={{ background: group.color }} aria-hidden="true" />
                    <div className="relative flex items-center gap-3">
                      <span className="size-3 rounded-full" style={{ background: group.color, boxShadow: `0 0 14px ${group.color}` }} aria-hidden="true" />
                      <h3 className="m-0 text-[17px] font-semibold text-fg">{group.label}</h3>
                      <span className="ml-auto font-mono text-[11px] text-fg-3">{group.streams.length} stream{group.streams.length === 1 ? '' : 's'}</span>
                    </div>
                    <ul className="relative m-0 mt-4 flex list-none flex-col gap-2 p-0" aria-label={`${group.label} source streams`}>
                      {group.streams.map((source) => <Stream key={source.source_id} source={source} />)}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
