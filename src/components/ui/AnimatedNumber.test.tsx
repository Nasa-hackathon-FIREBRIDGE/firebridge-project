// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import AnimatedNumber from './AnimatedNumber'

const preference = vi.hoisted(() => ({ reduced: false }))
vi.mock('motion/react', async importOriginal => ({ ...await importOriginal<typeof import('motion/react')>(), useReducedMotion: () => preference.reduced }))
afterEach(cleanup)

it('finishes immediately at the actual value if reduced motion is enabled during interpolation', async () => {
  const formatValue = (value: number) => String(Math.round(value))
  const { rerender } = render(<p data-testid="number"><AnimatedNumber value={100} formatValue={formatValue} /></p>)
  await waitFor(() => expect(Number(screen.getByTestId('number').textContent)).toBeLessThan(100))
  preference.reduced = true
  rerender(<p data-testid="number"><AnimatedNumber value={123} formatValue={formatValue} /></p>)
  expect(screen.getByTestId('number')).toHaveTextContent('123')
})
