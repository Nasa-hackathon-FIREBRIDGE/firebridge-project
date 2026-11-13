import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BookOpen, Boxes, CloudSun, Code2, Flame, Library, Map, MapPinned, MessagesSquare, Sparkles, type LucideIcon } from 'lucide-react'
import { Reveal } from '../components/ui/Reveal'
import {
  BOUNDARIES,
  DEVELOPMENT_AI,
  FIRE_DOCUMENTATION,
  FIRE_PRODUCTS,
  IMAGERY,
  LANGUAGE_MODELS,
  NRT_PRODUCTS,
  OUR_CODE,
  PIPELINE_REPO,
  SOFTWARE,
  WEATHER,
  type Citation,
} from './methods/facts'
import { REFERENCES, type Reference } from '../features/science/references'

const AI_LIMITS = [
  'Create data. Every fire record comes from NASA FIRMS and every weather value from NASA POWER, and every number on the site is computed by code from those records.',
  'Make media. No AI image, video, voice or music generators were used. The logo and illustrations are SVG written as code.',
  'Run unchecked. In the product, AI only puts computed facts into words, and every number it writes is checked against them.',
]

/** The published science the analysis pages cite beside their own results. */
const LITERATURE: Citation[] = (Object.values(REFERENCES) as Reference[]).map((ref) =>
  ref.url?.startsWith('https://doi.org/') ? { name: ref.short, role: ref.full, doi: ref.url.replace('https://doi.org/', '') } : { name: ref.short, role: ref.full, href: ref.url },
)

const TEAM_ROLE = [
  'Set the goals and the design direction, and directed every AI session.',
  'Reviewed the results, rejected what did not work, and decided what to keep and deploy.',
  'Checked changes with automated tests and in the running app before deployment.',
]

function Group({ id, icon: Icon, eyebrow, title, intro, children }: { id: string; icon: LucideIcon; eyebrow: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 lg:grid-cols-[17rem_1fr] lg:gap-10">
      <Reveal>
        <span className="grid size-10 place-items-center rounded-xl border border-ember-400/20 bg-ember-500/10 text-ember-300">
          <Icon size={18} aria-hidden="true" />
        </span>
        <p className="mb-2 mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ember-300">{eyebrow}</p>
        <h2 id={id} className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-fg">{title}</h2>
        {intro && <p className="mb-0 mt-3 font-sans text-[14px] leading-relaxed text-fg-2">{intro}</p>}
      </Reveal>
      <Reveal delay={0.05}>{children}</Reveal>
    </section>
  )
}

function CitationList({ items, label }: { items: Citation[]; label: string }) {
  return (
    <ul className="card m-0 list-none divide-y divide-white/[0.05] p-0" aria-label={label}>
      {items.map((item) => (
        <li key={item.name} className="flex flex-col gap-1.5 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="m-0 font-sans text-[14.5px] font-semibold leading-snug text-fg">
              {item.href ? (
                <a href={item.href} target="_blank" rel="noreferrer" className="text-fg no-underline hover:text-ember-200">
                  {item.name} <ArrowUpRight size={12} className="inline text-fg-3" aria-hidden="true" />
                </a>
              ) : item.name}
            </p>
            <p className="m-0 mt-1 font-sans text-[13px] leading-relaxed text-fg-2">{item.role}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {item.doi && (
              <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-ember-300 no-underline hover:text-ember-200 hover:underline">
                doi:{item.doi}
              </a>
            )}
            {(item.licence ?? item.tag) && <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10.5px] text-fg-2">{item.licence ?? item.tag}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function SourcesPage() {
  return (
    <div className="relative overflow-x-clip">
      <section className="relative isolate">
        <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(70%_60%_at_30%_20%,black,transparent)]" aria-hidden="true" />
        <div className="mx-auto max-w-[1100px] px-5 pb-12 pt-12 sm:px-8 lg:pt-16">
          <p className="m-0 inline-flex items-center gap-2 rounded-full border border-ember-400/25 bg-ember-500/[0.08] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-200">
            <Library size={13} aria-hidden="true" /> Sources & credits
          </p>
          <h1 className="mb-0 mt-6 max-w-3xl text-[clamp(34px,4.8vw,56px)] font-semibold leading-[1.04] tracking-[-0.04em] text-fg">
            Everything FIREBRIDGE <span className="text-ember-gradient">stands on</span>.
          </h1>
          <p className="mt-6 max-w-2xl font-sans text-[17px] leading-relaxed text-fg-2">
            Every dataset, map layer, model and library used to build and run FIREBRIDGE, with its licence. NASA data is used factually and does not imply NASA endorsement of this project.
          </p>
        </div>
      </section>

      <div className="mx-auto flex max-w-[1100px] flex-col gap-20 px-5 pb-24 sm:px-8">
        <Group
          id="fire-data"
          icon={Flame}
          eyebrow="Satellite fire data"
          title="NASA active-fire products"
          intro="Fire detections come from NASA’s Fire Information for Resource Management System (FIRMS), part of NASA’s Earth Science Data and Information System (ESDIS). Analyses read the standard-quality records below."
        >
          <div className="flex flex-col gap-4">
            <CitationList items={FIRE_PRODUCTS} label="Standard-quality fire products" />
            <CitationList items={NRT_PRODUCTS} label="Near-real-time fire products" />
            <CitationList items={FIRE_DOCUMENTATION} label="FIRMS services and documentation" />
          </div>
        </Group>

        <Group id="weather" icon={CloudSun} eyebrow="Weather" title="NASA weather beside the fire" intro="The Fire drivers page and the calendar set every month beside NASA’s weather record for the same place. Only the centre of the analysis’s fire activity is sent to NASA POWER.">
          <CitationList items={WEATHER} label="Weather data" />
        </Group>

        <Group id="literature" icon={BookOpen} eyebrow="Published science" title="The literature each result is checked against" intro="Every analysis page sets its results beside these published findings and agency records. Each DOI was checked to resolve at doi.org, and each link to respond, on 13 Nov 2026.">
          <CitationList items={LITERATURE} label="Cited literature" />
        </Group>

        <Group id="imagery" icon={Map} eyebrow="Imagery & maps" title="Basemaps" intro="Background imagery gives geographic context only. Its acquisition date can differ from the fire records drawn on top.">
          <CitationList items={IMAGERY} label="Basemaps" />
        </Group>

        <Group id="boundaries" icon={MapPinned} eyebrow="Boundaries" title="Places you can pick" intro="Countries, regions and forests in the place picker. Boundaries are reference shapes, not statements about sovereignty.">
          <CitationList items={BOUNDARIES} label="Boundary datasets" />
        </Group>

        <Group id="models" icon={MessagesSquare} eyebrow="Language models" title="The explanation copilot" intro="The copilot reaches open-weight models through Groq’s hosted API. They write sentences around facts computed by FIREBRIDGE; they never calculate the numbers.">
          <CitationList items={LANGUAGE_MODELS} label="Language models" />
        </Group>

        <Group id="ai-use" icon={Sparkles} eyebrow="How we used AI" title="AI tools behind FIREBRIDGE" intro="The 2026 Space Apps rules ask every team to describe how it used AI, which the rules call “SI”. Beyond the copilot above, these tools helped build the project.">
          <div className="flex flex-col gap-4">
            <CitationList items={DEVELOPMENT_AI} label="AI development tools" />
            <div className="card grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
              <div>
                <h3 className="m-0 font-sans text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-3">What AI did not do</h3>
                <ul className="mb-0 mt-3 flex list-none flex-col gap-2.5 p-0" aria-label="What AI did not do">
                  {AI_LIMITS.map((line) => {
                    const [lead, ...rest] = line.split('. ')
                    return <li key={line} className="font-sans text-[13.5px] leading-relaxed text-fg-2"><strong className="font-semibold text-fg">{lead}.</strong> {rest.join('. ')}</li>
                  })}
                </ul>
              </div>
              <div>
                <h3 className="m-0 font-sans text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-3">What the team did</h3>
                <ul className="mb-0 mt-3 flex list-none flex-col gap-2.5 p-0" aria-label="What the team did">
                  {TEAM_ROLE.map((line) => <li key={line} className="font-sans text-[13.5px] leading-relaxed text-fg-2">{line}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </Group>

        <Group id="our-code" icon={Code2} eyebrow="Our code" title="Our own code, in the open" intro="FIREBRIDGE’s own code is public, so every step on the Data & methods page can be read and rerun.">
          <CitationList items={OUR_CODE} label="FIREBRIDGE repositories" />
        </Group>

        <Group id="software" icon={Boxes} eyebrow="Open-source software" title="Libraries and tools" intro="Licences as declared by each installed package. Thank you to every maintainer.">
          <div className="gap-3 sm:columns-2">
            {SOFTWARE.map((group) => (
              <div key={group.title} className="card mb-3 break-inside-avoid p-5">
                <h3 className="m-0 font-sans text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-3">{group.title}</h3>
                <ul className="mb-0 mt-3 flex list-none flex-col gap-1.5 p-0" aria-label={group.title}>
                  {group.items.map(([name, licence]) => (
                    <li key={name} className="flex items-baseline justify-between gap-3 font-sans text-[13.5px]">
                      <span className="text-fg">{name}</span>
                      <span className="font-mono text-[11px] text-fg-3">{licence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Group>

        <Reveal className="relative overflow-hidden rounded-3xl border border-ember-400/20 p-8 sm:p-10">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_100%_0%,rgba(255,95,31,0.18),transparent_60%)]" aria-hidden="true" />
          <h2 className="m-0 text-[clamp(22px,2.6vw,30px)] font-semibold leading-tight tracking-[-0.03em]">How the data is processed</h2>
          <p className="mb-0 mt-3 max-w-xl font-sans text-[15px] text-fg-2">Follow the records from NASA’s servers to your calendar, step by step. The data pipeline’s code is public under the MIT licence.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/evidence" className="ui-button ui-button--primary group">
              Data & methods <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <a href={PIPELINE_REPO} target="_blank" rel="noreferrer" className="ui-button">
              Data pipeline code <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
