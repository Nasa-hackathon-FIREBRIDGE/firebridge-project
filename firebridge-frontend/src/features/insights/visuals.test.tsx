// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmberHorizon } from './EmberHorizon'
import { FleetStreams } from './FleetStreams'
import type { DayCell, MonthBucket, SensorTotal } from './computeInsights'

afterEach(cleanup)

const day = (date: string, total: number | null): DayCell => ({ date, start: `${date}T00:00:00Z`, endExclusive: `${date}T00:00:00Z`, total, bySensor: total ? { snpp: total } : {}, missing: [] })

describe('Ember horizon', () => {
  it('labels the busiest day and sends a clicked day to the map', () => {
    const periods = Array.from({ length: 40 }, (_, i) => day(`2024-07-${String((i % 28) + 1).padStart(2, '0')}`.replace(/-07-/, i < 28 ? '-07-' : '-08-'), i === 10 ? 229 : i % 3))
    const onSelect = vi.fn()
    const { container } = render(<EmberHorizon periods={periods} onSelect={onSelect} />)
    expect(screen.getByRole('img', { name: /the busiest day was .* with 229 detections/ })).toBeInTheDocument()
    const overlay = container.querySelector('[aria-hidden="true"].absolute.inset-0') as HTMLElement
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1100, height: 300, right: 1100, bottom: 300, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.mouseMove(overlay, { clientX: (10.5 / 40) * 1100 })
    fireEvent.click(overlay)
    expect(onSelect).toHaveBeenCalledWith(periods[10])
  })
})

describe('Fleet streams', () => {
  it('names a satellite joining the record', () => {
    const months: MonthBucket[] = Array.from({ length: 12 }, (_, i) => ({ month: `2023-${String(i + 1).padStart(2, '0')}`, total: 10 + i, bySensor: i >= 5 ? { snpp: 10, noaa21: i } : { snpp: 10 + i } }))
    const sensors: SensorTotal[] = [
      { key: 'snpp', label: 'Suomi-NPP', instrument: 'VIIRS', color: '#a78bfa', pixel: '375 m', count: 120, sourceIds: ['a'] },
      { key: 'noaa21', label: 'NOAA-21', instrument: 'VIIRS', color: '#f472b6', pixel: '375 m', count: 50, sourceIds: ['b'] },
    ]
    render(<FleetStreams months={months} sensors={sensors} />)
    expect(screen.getByText(/NOAA-21 joins · Jun 2023/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Satellites' })).toHaveTextContent('71%')
  })
})
