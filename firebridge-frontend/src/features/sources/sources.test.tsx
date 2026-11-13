// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OverpassRow } from '../bridge/engine/index.ts'
import { PixelScale } from './PixelScale'
import { SkyClock } from './SkyClock'

afterEach(cleanup)

const row = (sensor: OverpassRow['sensor'], year: string, median: number, pass: 'day' | 'night' = 'day'): OverpassRow => ({ sensor, year, pass, n: 40, median, p25: median - 0.1, p75: median + 0.1 })

describe('The 24-hour sky', () => {
  it('places every satellite at its measured hour and names the drift', () => {
    render(<SkyClock rows={[row('aqua', '2020', 13.1), row('aqua', '2026', 15.3), row('terra', '2020', 10.95), row('terra', '2025', 9.15), row('snpp', '2020', 13.05), row('snpp', '2020', 1.4, 'night')]} />)
    const legend = screen.getByRole('list', { name: /Measured daytime overpass/ })
    expect(within(legend).getByText('Aqua').parentElement).toHaveTextContent('13:06 → 15:18')
    expect(within(legend).getByText('Aqua').parentElement).toHaveTextContent('+132 min')
    expect(within(legend).getByText('Terra').parentElement).toHaveTextContent('−108 min')
    expect(screen.getByRole('img', { name: /Fires burn hardest between 13:00 and 18:30/ })).toBeInTheDocument()
  })
})

describe('Pixels to scale', () => {
  it('shows how much of each pixel a 1,000 m² fire fills', () => {
    render(<PixelScale />)
    expect(screen.getByRole('img', { name: /MODIS · one 1 km pixel: .* fills 0\.1% of one pixel/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /VIIRS · 375 m pixels: .* fills 0\.7% of one pixel/ })).toBeInTheDocument()
  })
})
