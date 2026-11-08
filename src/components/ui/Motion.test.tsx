// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useContext } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MotionConfigContext } from 'motion/react'
import { MotionProvider } from './MotionProvider'
import { StatCard } from './StatCard'

vi.mock('motion/react', async importOriginal => ({ ...await importOriginal<typeof import('motion/react')>(), useReducedMotion: () => true }))
afterEach(cleanup)
describe('Motion and StatCard', () => {
  it('sets the application Motion reduced-motion policy to user', () => {
    function Probe() { const config = useContext(MotionConfigContext); return <p>{config.reducedMotion}</p> }
    render(<MotionProvider><Probe /></MotionProvider>)
    expect(screen.getByText('user')).toBeVisible()
  })
  it('immediately presents the final value under reduced motion even when animation is requested', () => {
    render(<StatCard label="Loaded records" value={1234} animate formatValue={value => value.toLocaleString('en-US')} context="Loaded selection only" />)
    expect(screen.getByText('Loaded records')).toBeVisible()
    expect(screen.getAllByText('1,234')).toHaveLength(2)
    expect(screen.getByText('Loaded selection only')).toBeVisible()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText(/trend/i)).not.toBeInTheDocument()
  })
  it('renders a supplied trend/context without inventing one and preserves unavailable values', () => {
    render(<StatCard label="Records" value="Unavailable" trend="Provided context" />)
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getByText('Provided context')).toBeVisible()
  })
})
