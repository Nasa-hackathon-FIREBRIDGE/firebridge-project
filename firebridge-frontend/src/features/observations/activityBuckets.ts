/**
 * Daily native-record counts grouped into as many bars as fit a card. A saved analysis can span up to
 * 30 years, so one bar per day (thousands of bars) cannot be read; the resolution grows with the
 * period instead. Grouping never invents numbers: a group with any unknown day is a lower bound of
 * its known days, and a group whose days are all unknown stays unknown.
 */
export interface DayCount {
  /** ISO start of the UTC day. */
  start: string
  value: bigint | null
  lowerBound: boolean
}

export type Resolution = 'day' | 'week' | 'month' | 'year'

export interface Bucket extends DayCount {
  /** Short axis label: 06-19 (day/week start), Jun 2024 (month), 2024 (year). */
  label: string
  /** Full description for tooltips and screen readers. */
  title: string
  days: number
}

export function resolutionFor(days: number): Resolution {
  if (days <= 45) return 'day'
  if (days <= 366) return 'week'
  if (days <= 3_660) return 'month'
  return 'year'
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function keyOf(start: string, resolution: Resolution, first: number): string {
  if (resolution === 'day') return start.slice(0, 10)
  if (resolution === 'month') return start.slice(0, 7)
  if (resolution === 'year') return start.slice(0, 4)
  // Weeks are counted from the first day of the period, so every bar holds seven days.
  return String(Math.floor((Date.parse(start) - first) / (7 * 86_400_000)))
}

export function bucketize(rows: readonly DayCount[]): { resolution: Resolution; buckets: Bucket[] } {
  const resolution = resolutionFor(rows.length)
  const first = rows.length ? Date.parse(rows[0].start.slice(0, 10)) : 0
  const groups = new Map<string, DayCount[]>()
  for (const row of rows) {
    const key = keyOf(row.start.slice(0, 10), resolution, first)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const buckets = [...groups.values()].map((group): Bucket => {
    const known = group.filter((row) => row.value !== null)
    const value = known.length ? known.reduce((sum, row) => sum + (row.value as bigint), 0n) : null
    const lowerBound = known.length < group.length || group.some((row) => row.lowerBound)
    const start = group[0].start.slice(0, 10)
    const end = group[group.length - 1].start.slice(0, 10)
    const label =
      resolution === 'year' ? start.slice(0, 4)
        : resolution === 'month' ? MONTH.format(new Date(`${start}T00:00:00Z`))
          : start.slice(5, 10)
    const span = start === end ? start : `${start} to ${end}`
    const count = value === null ? 'unknown' : `${lowerBound ? 'at least ' : ''}${value.toLocaleString('en-US')}`
    return { start: group[0].start, value, lowerBound, label, title: `${span}: ${count} records`, days: group.length }
  })
  return { resolution, buckets }
}

/** Step between shown items so that at most `maximum` are shown, evenly spaced from the first. */
export function labelEvery(count: number, maximum = 12): number {
  return Math.max(1, Math.ceil(count / maximum))
}

const SHORT_MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

/**
 * Where to print axis labels, and what. Ticks fall where people expect them: each January for
 * monthly bars (labelled with the year), the first week of each month for weekly bars (month
 * name), every nth bar for days and years. At most `maximum` ticks, so labels never collide.
 */
export function axisTicks(buckets: readonly Bucket[], resolution: Resolution, maximum = 7): Map<number, string> {
  const date = (bucket: Bucket) => bucket.start.slice(0, 10)
  let candidates: [number, string][]
  if (resolution === 'month') {
    candidates = buckets.flatMap((bucket, i): [number, string][] => (date(bucket).slice(5, 7) === '01' ? [[i, date(bucket).slice(0, 4)]] : []))
  } else if (resolution === 'week') {
    candidates = buckets.flatMap((bucket, i): [number, string][] =>
      i === 0 || date(bucket).slice(0, 7) !== date(buckets[i - 1]).slice(0, 7)
        ? [[i, SHORT_MONTH.format(new Date(`${date(bucket)}T00:00:00Z`))]]
        : [],
    )
  } else {
    candidates = buckets.map((bucket, i) => [i, bucket.label])
  }
  const every = labelEvery(candidates.length, maximum)
  return new Map(candidates.filter((_, i) => i % every === 0))
}
