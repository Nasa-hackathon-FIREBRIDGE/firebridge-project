/** Incomplete source inventory is never a measured zero. Keep bigint precision. */
export function summarizeCounts(
  sources: readonly { count: string | null; count_status?: string }[],
) {
  const known =
    sources.length > 0 &&
    sources.every(
      (source) =>
        source.count !== null && /^\d+$/.test(source.count) && source.count_status !== 'unknown',
    )
  return {
    value: known ? sources.reduce((total, source) => total + BigInt(source.count!), 0n) : null,
    lowerBound: sources.some((source) => source.count_status === 'lower_bound'),
  }
}

/**
 * Value for one period of a chart: the sum of the satellites whose count is known. If any satellite
 * is unknown that period (for example a platform outside its record span), the sum is a lower bound
 * ("at least"); only a period where no satellite is known stays unknown. Requiring every satellite
 * would blank multi-year charts, because some platform is always outside its span.
 */
export function summarizeKnownCounts(
  sources: readonly { count: string | null; count_status?: string }[],
) {
  const known = sources.filter(
    (source) => source.count !== null && /^\d+$/.test(source.count) && source.count_status !== 'unknown',
  )
  return {
    value: known.length ? known.reduce((total, source) => total + BigInt(source.count!), 0n) : null,
    lowerBound: known.length < sources.length || sources.some((source) => source.count_status === 'lower_bound'),
  }
}
