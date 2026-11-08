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
