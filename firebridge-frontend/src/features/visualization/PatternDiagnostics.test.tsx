// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { YearSimilarity } from './PatternDiagnostics'
import { chartValue, totalOf } from './model'

afterEach(cleanup)
it('does not present a single-year self-correlation as a comparison between years', () => {
  const points = [1, 2, 3, 4].map((n) => ({ start: `2024-0${n}-01`, endExclusive: `2024-0${n + 1}-01`, time: 0, ...chartValue(String(n), 'complete') }))
  render(<YearSimilarity source={{ id: 'aqua', label: 'Aqua', color: '#53d5ee', points, total: totalOf(points) }} />)
  expect(screen.queryByRole('img', { name: 'Seasonal similarity between years' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Download SVG: Similarity between years' }).hasAttribute('disabled')).toBe(true)
})
