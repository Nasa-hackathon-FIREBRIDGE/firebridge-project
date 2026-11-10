import type { ExplainerRefs } from '../../services/explainer.service'
import { fmtDate, fmtMonth } from '../bridge/format'

/** Where the workspace can take the user. Provided by the analysis workspace. */
export interface CopilotNav {
  openSection: (id: string, anchor?: string) => void
  showInterval: (start: string, endExclusive: string) => void
  focusMonth: (month: string) => void
}

export interface CopilotAction {
  key: string
  label: string
  kind: 'calendar' | 'map' | 'section'
  run: () => void
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** Sections of the analysis an answer can point to: [tab, element to bring into view, label]. */
export const SECTION_TARGETS: Record<string, [string, string | undefined, string]> = {
  calendar: ['fire-calendar', undefined, 'Open the fire calendar'],
  gap: ['sensor-bridge', 'bridge-act-1', 'Open the VIIRS–MODIS gap'],
  regime: ['sensor-bridge', 'bridge-act-2', 'Open the overpass drift'],
  replay: ['sensor-bridge', 'bridge-act-4', 'Open the withheld-satellite test'],
  rehearsal: ['sensor-bridge', 'bridge-act-5', 'Open the handover rehearsal'],
  bridge: ['sensor-bridge', 'bridge-act-6', 'Open the harmonized record'],
  episodes: ['analysis-overview', 'episodes-heading', 'Open the fire episodes'],
  overview: ['analysis-overview', undefined, 'Open the overview'],
}

/** Turn what an answer is about into things the user can do: the AI points at the evidence. */
export function actionsFor(refs: ExplainerRefs | undefined, nav: CopilotNav, limit = 4): CopilotAction[] {
  if (!refs) return []
  const out: CopilotAction[] = []
  for (const month of refs.months.slice(0, 2)) out.push({ key: `m:${month}`, label: `${fmtMonth(month, 'long')} in the calendar`, kind: 'calendar', run: () => nav.focusMonth(month) })
  for (const day of refs.days.slice(0, 1)) out.push({ key: `d:${day}`, label: `${fmtDate(day)} on the map`, kind: 'map', run: () => nav.showInterval(day, nextDay(day)) })
  for (const e of refs.episodes.slice(0, 2)) {
    const label = e.start === e.end ? fmtDate(e.start) : `${fmtDate(e.start)} – ${fmtDate(e.end)}`
    out.push({ key: `e:${e.start}`, label: `${label} on the map`, kind: 'map', run: () => nav.showInterval(e.start, nextDay(e.end)) })
  }
  for (const section of refs.sections) {
    const target = SECTION_TARGETS[section]
    if (!target || (section === 'calendar' && refs.months.length)) continue
    out.push({ key: `s:${section}`, label: target[2], kind: 'section', run: () => nav.openSection(target[0], target[1]) })
  }
  return out.slice(0, limit)
}
