import { expect, it } from 'vitest'
import { summarizeCounts } from './nativeCounts'

it('keeps unknown counts distinct from confirmed zeros and lower bounds', () => {
  expect(summarizeCounts([{ count: null, count_status: 'unknown' }]).value).toBeNull()
  expect(summarizeCounts([{ count: '0', count_status: 'unknown' }]).value).toBeNull()
  expect(summarizeCounts([]).value).toBeNull()
  expect(summarizeCounts([{ count: '0', count_status: 'complete' }]).value).toBe(0n)
  expect(summarizeCounts([{ count: '12', count_status: 'lower_bound' }])).toEqual({
    value: 12n,
    lowerBound: true,
  })
})
it('preserves counts beyond JavaScript number precision', () => {
  expect(summarizeCounts([{ count: '9007199254740993' }, { count: '2' }]).value).toBe(
    9007199254740995n,
  )
})
