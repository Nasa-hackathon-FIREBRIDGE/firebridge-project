// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TemporalTreemap } from './TemporalStructure'
import { chartValue, totalOf } from './model'

afterEach(cleanup)
it('labels tiny January, May and December tiles inside the SVG using connected callouts', () => {
  const counts = [1, 42, 162, 110, 1, 63, 70, 89, 98, 124, 199, 1]
  const points = counts.map((count, month) => ({ start: new Date(Date.UTC(2025, month, 1)).toISOString(), endExclusive: new Date(Date.UTC(2025, month + 1, 1)).toISOString(), time: 0, ...chartValue(String(count), 'complete') }))
  render(<TemporalTreemap source={{ id: 'test', label: 'Test source', color: '#55aabb', points, total: totalOf(points) }} />)
  const svg = screen.getByRole('img', { name: 'Monthly composition treemap' })
  for (const month of ['Jan', 'May', 'Dec']) {
    expect(within(svg).getByText(month)).toBeTruthy()
    const callout = within(svg).getByRole('button', { name: new RegExp(`^Inspect ${month} 2025:`) })
    expect(callout.querySelector('path')).toBeTruthy()
  }
  fireEvent.keyDown(within(svg).getByRole('button', { name: /^Inspect May 2025:/ }), { key: 'Enter' })
  expect(within(screen.getByRole('figure', { name: 'Anatomy of a year' })).getByRole('status').textContent).toContain('May 2025')
})
