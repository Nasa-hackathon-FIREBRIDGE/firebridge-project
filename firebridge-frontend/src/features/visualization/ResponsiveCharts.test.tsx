// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DistributionPlot } from './DistributionPlot'
import { PairedSourcePlot } from './PairedSourcePlot'
import { chartValue, totalOf, type ChartSource } from './model'

const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
afterEach(() => {
  cleanup(); vi.unstubAllGlobals()
  if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
})
function source(id: string, rows: [string, string | null, string][]): ChartSource {
  const points = rows.map(([key, count, state]) => ({ start: `${key}-01`, endExclusive: new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5)), 1)).toISOString(), time: 0, ...chartValue(count, state) }))
  return { id, label: id, color: '#55ccbb', points, total: totalOf(points) }
}

it('recomputes boxplot geometry when its card narrows and grows, retaining every month', () => {
  let width = 320
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  let resize = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect = disconnect })
  const data = source('aqua', [['2024-01', '1', 'complete'], ['2024-02', '5', 'complete'], ['2024-03', '10', 'complete'], ['2024-04', '100', 'complete']])
  const view = render(<DistributionPlot sources={[data]} />)
  const svg = screen.getByRole('img', { name: 'Distribution of monthly detections by source' })
  for (const next of [320, 760, 254, 490]) {
    act(() => { width = next; resize() })
    expect(svg.getAttribute('viewBox')?.split(' ')[2]).toBe(String(next))
    const dots = svg.querySelectorAll('circle')
    expect(dots).toHaveLength(4)
    for (const dot of dots) expect(Number(dot.getAttribute('cx'))).toBeLessThan(next)
  }
  view.unmount()
  expect(disconnect).toHaveBeenCalled()
})

it('pairs exact full months, retains verified zeros and leaves missing months unpaired', () => {
  const a = source('aqua', [['2024-01', '0', 'complete'], ['2024-02', '4', 'complete'], ['2025-01', '8', 'complete']])
  const b = source('terra', [['2024-01', '5', 'complete'], ['2024-02', null, 'unknown'], ['2025-01', '2', 'complete']])
  render(<PairedSourcePlot sources={[a, b]} />)
  fireEvent.change(screen.getByLabelText('Source comparison year'), { target: { value: '2024' } })
  const svg = screen.getByRole('img', { name: 'Paired monthly source counts' })
  const january = within(svg).getByRole('img', { name: /Jan 2024 · A 0 · B 5 records/ })
  expect(within(svg).queryByRole('img', { name: /^Feb 2024/ })).toBeNull()
  fireEvent.focus(january)
  expect(screen.getByRole('status').textContent).toContain('aqua: 0 · terra: 5')
  fireEvent.change(screen.getByLabelText('Source comparison year'), { target: { value: '2025' } })
  expect(within(svg).getByRole('img', { name: /Jan 2025 · A 8 · B 2 records/ })).toBeTruthy()
  expect(screen.getByRole('status').textContent).not.toContain('aqua: 0')
})
