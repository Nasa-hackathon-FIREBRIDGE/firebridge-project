import { describe, expect, it } from 'vitest'
import { aggregateDaily, spearman } from './weather'

describe('NASA POWER aggregation', () => {
  it('builds monthly means and totals and skips fill values and short months', () => {
    const tmax: Record<string, number> = {}
    const rain: Record<string, number> = {}
    for (let d = 1; d <= 31; d++) {
      const day = `202207${String(d).padStart(2, '0')}`
      tmax[day] = d === 5 ? -999 : 30
      rain[day] = 2
    }
    for (let d = 1; d <= 10; d++) {
      tmax[`202208${String(d).padStart(2, '0')}`] = 31
      rain[`202208${String(d).padStart(2, '0')}`] = 0
    }
    const months = aggregateDaily(tmax, rain)
    expect(months).toHaveLength(1)
    expect(months[0].month).toBe('2022-07')
    expect(months[0].tmax).toBe(30)
    // Mean daily rain times the days of the month.
    expect(months[0].rain).toBeCloseTo(62, 6)
  })
})

describe('Spearman with a permutation test', () => {
  it('detects a monotone relation and rejects noise', () => {
    const x = Array.from({ length: 30 }, (_, i) => i)
    const strong = spearman(x, x.map((v) => v * v + 3))!
    expect(strong.rho).toBeCloseTo(1, 6)
    expect(strong.p).toBeLessThan(0.001)
    const noise = spearman(x, x.map((v) => ((v * 7919) % 31) - 15))!
    expect(Math.abs(noise.rho)).toBeLessThan(0.4)
    expect(noise.p).toBeGreaterThan(0.05)
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeNull()
  })

  it('is reproducible', () => {
    const x = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
    const y = [2, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4]
    expect(spearman(x, y)).toEqual(spearman(x, y))
  })
})
