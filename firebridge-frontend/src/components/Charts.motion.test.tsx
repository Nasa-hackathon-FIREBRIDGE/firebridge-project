// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ActivityChart, CalendarChart, SensorBars } from './Charts'

vi.mock('echarts-for-react/esm/core', () => ({ default: ({ option }: { option: { animation: boolean } }) => <div data-testid="chart" data-animation={String(option.animation)} /> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('disables all existing ECharts animation with reduced motion and responds to preference changes', () => {
  const listeners = new Set<() => void>()
  const media = { matches: true, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }
  vi.stubGlobal('matchMedia', () => media)
  render(<><ActivityChart data={[]} /><SensorBars data={[]} /><CalendarChart data={[]} onSelect={() => {}} /></>)
  for (const chart of screen.getAllByTestId('chart')) expect(chart).toHaveAttribute('data-animation', 'false')
  act(() => { media.matches = false; listeners.forEach(fn => fn()) })
  for (const chart of screen.getAllByTestId('chart')) expect(chart).toHaveAttribute('data-animation', 'true')
  cleanup()
  expect(listeners.size).toBe(0)
})
