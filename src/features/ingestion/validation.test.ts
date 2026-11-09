import { afterEach, expect, it, vi } from 'vitest'
import { validateIngestionPlan } from './validation'

const budget = { max_chunks: 3, max_bytes: 1000000 }
afterEach(() => vi.restoreAllMocks())

it('accepts bounded historical UTC windows and an optional automatic refresh window', () => {
  expect(validateIngestionPlan('2024-01-17T00:00:00Z', '2024-01-20T00:00:00Z', budget)).toBeNull()
  expect(validateIngestionPlan('', '', budget, true)).toBeNull()
})

it.each([
  ['2024-01-17T00:00:00Z', ''],
  ['', '2024-01-20T00:00:00Z'],
  ['2024-01-20T00:00:00Z', '2024-01-17T00:00:00Z'],
  ['2024-01-17T00:00:00Z', '2024-01-17T00:00:00Z'],
  ['2024-02-30T00:00:00Z', '2024-03-05T00:00:00Z'],
  ['2024-01-17T24:00:00Z', '2024-01-20T00:00:00Z'],
  ['2024-01-17T00:00:00', '2024-01-20T00:00:00'],
])('rejects an invalid or incomplete interval: %s to %s', (start, end) => {
  expect(validateIngestionPlan(start, end, budget, true)).toBeInstanceOf(Error)
})

it('rejects future windows and invalid resource budgets before a request is created', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-09T00:00:00Z'))
  expect(validateIngestionPlan('2026-11-08T00:00:00Z', '2026-11-10T00:00:00Z', budget)).toBeInstanceOf(Error)
  for (const invalid of [{ max_chunks: 0, max_bytes: 1 }, { max_chunks: 1.5, max_bytes: 1 }, { max_chunks: 367, max_bytes: 1 }, { max_chunks: 1, max_bytes: NaN }, { max_chunks: 1, max_bytes: 1_000_000_000_001 }]) {
    expect(validateIngestionPlan('', '', invalid, true)).toBeInstanceOf(Error)
  }
})
