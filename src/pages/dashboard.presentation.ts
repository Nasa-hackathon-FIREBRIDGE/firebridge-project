/** Display helpers only. No API/filter/aggregation behavior is defined here. */
export function utcDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

/** Never turn the exclusive boundary into an inclusive day. */
export function formatAnalysisInterval(start: string, endExclusive: string) {
  return { label: `${start.slice(0, 10)} → ${endExclusive.slice(0, 10)}`, note: 'end excluded · UTC', exact: `${utcDate(start)} → ${utcDate(endExclusive)} · end excluded` }
}

export function relativeJobTime(value: string, now = Date.now()) {
  const difference = Date.parse(value) - now
  if (!Number.isFinite(difference)) return 'Date unavailable'
  const minute = 60_000, hour = 60 * minute, day = 24 * hour
  const [unit, scale] = Math.abs(difference) >= day ? ['day', day] as const : Math.abs(difference) >= hour ? ['hour', hour] as const : ['minute', minute] as const
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }).format(Math.round(difference / scale), unit)
}

/** Only affirmative metadata labels qualify; unmarked releases are never called real. */
export function isExplicitSyntheticRelease(name: string) {
  return /^\s*(?:synthetic(?:[\s_-]+test)?|test[\s_-]+only)\b/i.test(name)
}
