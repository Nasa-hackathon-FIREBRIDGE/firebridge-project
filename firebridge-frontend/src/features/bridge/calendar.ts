import type { BridgeReport, Episode, MonthAnomaly } from './engine/index.ts'
import { sensorLabel } from './format'

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const calendarMonthName = (month: string) => MONTH_LONG[Number(month.slice(5, 7)) - 1]

const join = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/** How strongly a flagged month stands out, for ranking. */
export function strength(a: MonthAnomaly) {
  if (a.kind === 'unusual-high' || a.kind === 'unusual-low') return Math.max(Math.abs(a.consensus?.z ?? 0), Math.abs(a.harmonized?.z ?? 0))
  if (a.kind === 'disputed') return Math.abs(a.harmonized?.z ?? 0)
  if (a.kind === 'artifact') return Math.abs(a.raw?.z ?? 0)
  return 0
}

/** Flagged months grouped for the attention list, strongest first. */
export function attention(report: BridgeReport) {
  const flagged = report.anomalies.months.filter((a) => a.kind).sort((a, b) => strength(b) - strength(a))
  return {
    unusual: flagged.filter((a) => a.kind === 'unusual-high' || a.kind === 'unusual-low'),
    disputed: flagged.filter((a) => a.kind === 'disputed'),
    artifacts: flagged.filter((a) => a.kind === 'artifact').sort((a, b) => a.month.localeCompare(b.month)),
  }
}

/** The month the calendar opens on: the strongest unusual month, else the strongest flag. */
export function featuredMonth(report: BridgeReport): string | null {
  const { unusual, disputed, artifacts } = attention(report)
  return unusual[0]?.month ?? disputed[0]?.month ?? artifacts[0]?.month ?? null
}

/** Largest detection cluster overlapping a calendar month. */
export function largestEpisode(report: BridgeReport, month: string): Episode | null {
  const start = `${month}-01`
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10)
  let best: Episode | null = null
  for (const e of report.episodes.all) if (e.start.slice(0, 10) < next && e.end.slice(0, 10) >= start && (!best || e.detections > best.detections)) best = e
  return best
}

export type Tone = 'high' | 'low' | 'disputed' | 'artifact' | 'none' | 'empty'

export interface Verdict {
  tone: Tone
  label: string
  /** One plain sentence on the satellites' testimony. */
  testimony: string
}

const testifying = (a: MonthAnomaly) => a.witnesses.filter((w) => w.state === 'scored')

export function verdict(a: MonthAnomaly | undefined, report: BridgeReport): Verdict {
  if (!a) return { tone: 'empty', label: 'Outside the analysis', testimony: '' }
  const month = calendarMonthName(a.month)
  const scored = testifying(a)
  const n = a.consensus?.n ?? 0
  const missing = a.witnesses.filter((w) => w.state === 'no-record').map((w) => sensorLabel(w.sensor))
  switch (a.kind) {
    case 'unusual-high':
    case 'unusual-low': {
      const high = a.kind === 'unusual-high'
      return {
        tone: high ? 'high' : 'low',
        label: high ? 'Unusually high' : 'Unusually low',
        testimony: `${a.consensus!.agreeing} of ${n} satellites, each compared only with its own past ${month}s, recorded ${high ? 'more' : 'less'} activity than usual.`,
      }
    }
    case 'disputed': {
      if (a.reason === 'unconfirmed')
        return { tone: 'disputed', label: 'Unconfirmed', testimony: `The harmonized record stands out, but fewer than two satellites have enough ${month}s on record to confirm it.` }
      const outlier = a.outlier
      const others = scored.filter((w) => w.sensor !== outlier).map((w) => sensorLabel(w.sensor))
      const low = (a.harmonized?.z ?? 0) < 0
      return {
        tone: 'disputed',
        label: 'Disputed',
        testimony: outlier
          ? `${sensorLabel(outlier)} alone recorded ${low ? 'an unusually quiet' : 'an unusually busy'} ${month}; ${join(others)} did not. The reference record may have missed what the others saw.`
          : `The harmonized record stands out, but the satellites, each against its own past, do not back it.`,
      }
    }
    case 'artifact':
      return a.reason === 'no-record'
        ? { tone: 'artifact', label: 'Missing, not zero', testimony: 'No satellite record exists in the archive for this month. A raw total reads it as zero; FIREBRIDGE leaves it empty.' }
        : {
            tone: 'artifact',
            label: 'Satellite artifact',
            testimony: `Only the raw all-satellite total stands out${missing.length ? `: ${join(missing)} ${missing.length === 1 ? 'has' : 'have'} no record this month` : ''}. The change is in the satellite fleet, not the fire.`,
          }
    default: {
      const record = report.months.find((m) => m.month === a.month)
      if (!record?.bridge && a.witnesses.every((w) => w.state === 'no-record')) return { tone: 'empty', label: 'No record', testimony: 'No satellite record exists in the archive for this month.' }
      if (!a.harmonized && !a.consensus) return { tone: 'none', label: 'Not scored', testimony: `Fewer than ${report.anomalies.minimumYears + 1} years of ${month}s are on record, so this month is shown but not judged.` }
      return { tone: 'none', label: 'Within the usual range', testimony: n ? `${n} satellite${n === 1 ? '' : 's'} testif${n === 1 ? 'ies' : 'y'}; none places this month far from its own usual ${month}.` : `Within the usual range for ${month}.` }
    }
  }
}
