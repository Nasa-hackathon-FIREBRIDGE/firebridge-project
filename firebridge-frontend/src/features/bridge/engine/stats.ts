/** Small, dependency-free statistics used by the bridge engine. All functions are pure. */

/** Linear-interpolated quantile (Hyndman & Fan type 7) of an ascending-sorted array. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function quantile(values: readonly number[], p: number): number {
  return quantileSorted([...values].sort((a, b) => a - b), p)
}

export const median = (values: readonly number[]) => quantile(values, 0.5)

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN
}

/** Pearson correlation; null when either series has no variance. */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null
  const ma = mean(a)
  const mb = mean(b)
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < a.length; i++) {
    cov += (a[i] - ma) * (b[i] - mb)
    va += (a[i] - ma) ** 2
    vb += (b[i] - mb) ** 2
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null
}

/** Wilson score interval for a binomial proportion. z = 1.645 gives a 90% interval. */
export function wilson(successes: number, trials: number, z = 1.645): [number, number] | null {
  if (trials <= 0) return null
  const p = successes / trials
  const z2 = z * z
  const centre = (p + z2 / (2 * trials)) / (1 + z2 / trials)
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials)
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Median of clock times in hours that respects the midnight wrap: values are unwrapped
 * around their circular mean before taking order statistics. Returns hours in [0, 24).
 */
export function circularClock(values: readonly number[]): { median: number; p25: number; p75: number } | null {
  if (!values.length) return null
  let sx = 0
  let sy = 0
  for (const hours of values) {
    const angle = (hours / 24) * 2 * Math.PI
    sx += Math.cos(angle)
    sy += Math.sin(angle)
  }
  const centre = ((Math.atan2(sy, sx) / (2 * Math.PI)) * 24 + 24) % 24
  const unwrapped = values.map((hours) => centre + ((((hours - centre + 12) % 24) + 24) % 24) - 12).sort((a, b) => a - b)
  const wrap = (hours: number) => ((hours % 24) + 24) % 24
  return {
    median: wrap(quantileSorted(unwrapped, 0.5)),
    p25: wrap(quantileSorted(unwrapped, 0.25)),
    p75: wrap(quantileSorted(unwrapped, 0.75)),
  }
}
