import { useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowRight, ChevronRight, Globe2, RotateCcw, Search, X } from 'lucide-react'
import { fitForSaving, type AreaGeometry } from './geo'
import { describe, fmtKm2, search, zoneFor, type CountryFeature, type PlaceFeature, type PlaceLevel } from './places'
import type { PlacePicker as Controller } from './usePlacePicker'

/** A place ready to become a study area: what the area form needs, already valid for the server. */
export interface PickedPlace {
  geometry: AreaGeometry
  name: string
  provenance: string
  timezone: string
}

const glass = 'border border-white/10 bg-ink-900/85 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.9)] backdrop-blur-md'
const LEVEL_WORDS: Record<PlaceLevel, [one: string, many: string]> = { region: ['region', 'regions'], province: ['province', 'provinces'], forest: ['forest or park', 'forests and parks'] }

/** The quiet bar that replaces the drawing tools while a zone is chosen on the map. */
export function PlacePicker({ picker, maxAreaKm2 = 250_000, onUse, onClose }: {
  picker: Controller
  maxAreaKm2?: number
  onUse: (place: PickedPlace) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null)
  const { country, level, selected } = picker
  const countryName = country?.properties.name ?? ''

  const matches = useMemo<(CountryFeature | PlaceFeature)[]>(
    () => (country ? search(picker.places, query, (p) => [p.properties.name]) : search(picker.countries, query, (c) => [c.properties.name, c.properties.name_fr, c.properties.name_ar])),
    [country, picker.places, picker.countries, query],
  )

  const levels = country
    ? ([['region', 'Regions', country.properties.regions], ['province', 'Provinces', country.properties.provinces], ['forest', 'Forests & parks', null]] as const).filter(([, , count]) => count !== 0)
    : []

  const pick = (item: CountryFeature | PlaceFeature) => {
    setQuery('')
    if (!country) picker.chooseCountry(item as CountryFeature)
    else picker.select(item as PlaceFeature)
  }

  const use = () => {
    if (!selected || !country) return
    const geometry = fitForSaving(selected.geometry)
    if (!geometry) {
      setProblem({ id: selected.properties.id, text: 'This shape could not be prepared for analysis. Try another place.' })
      return
    }
    const whole = selected.properties.level === 'country'
    onUse({
      geometry,
      name: whole ? countryName : `${selected.properties.name}, ${countryName}`,
      provenance: `${selected.properties.source} · ${selected.properties.source_id}`,
      timezone: zoneFor(country.properties, selected.geometry),
    })
  }

  const hint = (() => {
    if (picker.countriesStatus === 'loading') return 'Loading the world map…'
    if (!country) return 'Click a country on the map, or search for it.'
    if (level === 'country') return picker.status === 'loading' ? `Loading ${countryName}…` : ''
    const [one, many] = LEVEL_WORDS[level]
    switch (picker.status) {
      case 'loading':
        return `Loading the ${many} of ${countryName}…`
      case 'none':
        return level === 'forest' ? `No named forests or parks were found for ${countryName}.` : `No ${many} are published for ${countryName}.`
      case 'unprepared':
        return `Forests and parks aren't prepared for ${countryName} yet. Pick a region or province instead.`
      default:
        return selected ? '' : `Click a ${one} on the map, or search.`
    }
  })()
  const failed = picker.countriesStatus === 'error' || picker.status === 'error'
  const tooLarge = !!selected && selected.properties.area_km2 > maxAreaKm2
  const issue = problem && problem.id === selected?.properties.id ? problem.text : ''

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (query) setQuery('')
    else onClose()
  }

  return (
    <>
      {picker.hover && (
        <div
          className={`pointer-events-none absolute z-[13] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg px-2.5 py-1.5 font-sans text-[12px] ${glass}`}
          style={{ left: picker.hover.x, top: picker.hover.y - 14 }}
          aria-hidden="true"
        >
          <strong className="font-semibold text-fg">{picker.hover.name}</strong>
          <span className="ml-2 text-fg-3">{picker.hover.country ? 'Click to open' : picker.hover.area !== undefined ? fmtKm2(picker.hover.area) : ''}</span>
        </div>
      )}
      <section
        aria-label="Choose a zone"
        onKeyDown={onKeyDown}
        className={`absolute bottom-[40px] left-1/2 z-[12] max-sm:bottom-[62px] flex w-[min(720px,calc(100%-28px))] -translate-x-1/2 flex-col gap-2 rounded-2xl p-2.5 font-sans ${glass}`}
      >
        {selected && country && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ember-400/25 bg-gradient-to-br from-ember-500/[0.12] to-transparent px-3 py-2" role="status">
            <div className="min-w-0 flex-1 max-sm:basis-full">
              <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ember-300">{describe(selected.properties, countryName)}</p>
              <p className="m-0 flex min-w-0 items-baseline gap-2 text-[14.5px] font-semibold text-fg">
                <span className="truncate" dir="auto">{selected.properties.level === 'country' ? countryName : selected.properties.name}</span>
                {!tooLarge && <span className="shrink-0 font-normal tabular-nums text-fg-2">{fmtKm2(selected.properties.area_km2)}</span>}
              </p>
              {tooLarge && (
                <p className="m-0 text-[12px] text-fg-2">
                  Too large to analyse as one area: {fmtKm2(selected.properties.area_km2)}, and the limit is {fmtKm2(maxAreaKm2)}. Pick one of its regions instead.
                </p>
              )}
            </div>
            {!tooLarge && (
              <button type="button" onClick={use} className="inline-flex items-center justify-center gap-1.5 max-sm:w-full whitespace-nowrap rounded-xl border-0 bg-gradient-to-br from-flare to-ember-500 px-3.5 py-2 text-[13px] font-semibold text-[#1a0802] shadow-[0_8px_24px_-10px_rgb(255_124_64/0.9)] hover:brightness-110">
                Use this area <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1 text-[13px]">
            <button type="button" onClick={() => picker.chooseCountry(null)} disabled={!country}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 py-1 font-medium text-fg-2 enabled:hover:text-fg disabled:cursor-default">
              <Globe2 size={14} className="text-ember-300" aria-hidden="true" /> <span className="max-sm:sr-only">World</span>
            </button>
            {country && (
              <>
                <ChevronRight size={13} className="shrink-0 text-fg-3" aria-hidden="true" />
                <span className="truncate font-semibold text-fg" dir="auto">{countryName}</span>
              </>
            )}
          </nav>

          <div className="relative ml-auto w-[220px] min-w-0 max-sm:flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches[0]) pick(matches[0])
              }}
              aria-label={country ? `Search the ${level === 'country' ? 'regions' : LEVEL_WORDS[level][1]} of ${countryName}` : 'Search a country'}
              placeholder={country ? `Search ${level === 'country' || level === 'region' ? 'regions' : LEVEL_WORDS[level][1]}…` : 'Search a country…'}
              className="!m-0 !min-h-0 w-full rounded-full border border-white/10 bg-ink-950/60 py-1.5 pl-8 pr-3 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus:border-ember-400/50"
            />
            {matches.length > 0 && (
              <ul role="listbox" aria-label="Matching places" className={`absolute bottom-full right-0 z-10 m-0 mb-2 w-full min-w-[240px] list-none overflow-hidden rounded-xl p-1 ${glass}`}>
                {matches.map((item) => (
                  <li key={item.properties.id} role="option" aria-selected="false">
                    <button type="button" onClick={() => pick(item)} className="flex w-full items-baseline justify-between gap-3 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left text-[12.5px] text-fg hover:bg-white/[0.07]">
                      <span className="truncate" dir="auto">{item.properties.name}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-fg-3">{fmtKm2(item.properties.area_km2)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" onClick={onClose} aria-label="Stop choosing a zone" title="Done"
            className="grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-fg-3 hover:bg-white/[0.07] hover:text-fg">
            <X size={16} />
          </button>
        </div>

        {(country || hint || failed || issue) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {country && (
              <div role="radiogroup" aria-label="Show" className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-white/10 bg-ink-950/60 p-[3px]">
                {levels.map(([key, label, count]) => (
                  <button key={key} type="button" role="radio" aria-checked={level === key} onClick={() => picker.chooseLevel(key)}
                    className={`whitespace-nowrap rounded-full border-0 px-2.5 py-1 text-[12px] font-medium transition-colors ${level === key ? 'bg-gradient-to-br from-flare to-ember-500 text-[#1a0802]' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
                    {label === 'Forests & parks' ? <>Forests<span className="max-sm:hidden"> &amp; parks</span></> : label}
                    {count ? <span className={`ml-1 font-mono text-[10px] max-sm:hidden ${level === key ? 'text-[#1a0802]/70' : 'text-fg-3'}`}>{count}</span> : null}
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={level === 'country'} onClick={() => picker.chooseLevel('country')}
                  className={`whitespace-nowrap rounded-full border-0 px-2.5 py-1 text-[12px] font-medium transition-colors ${level === 'country' ? 'bg-gradient-to-br from-flare to-ember-500 text-[#1a0802]' : 'bg-transparent text-fg-2 hover:text-fg'}`}>
                  Whole country
                </button>
              </div>
            )}
            {(hint || failed || issue) && (
              <p className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-2 px-1 text-[12px] leading-snug text-fg-2 max-sm:basis-full" role="status">
                {failed ? (country ? `The boundaries of ${countryName} couldn't be loaded.` : "The country outlines couldn't be loaded.") : issue || hint}
                {failed && (
                  <button type="button" onClick={picker.retry} className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent p-0 text-[12px] font-medium text-ember-300 hover:text-ember-200">
                    <RotateCcw size={12} aria-hidden="true" /> Try again
                  </button>
                )}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  )
}
