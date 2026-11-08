// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Card, BentoCard } from './Card'
import { Banner } from './Banner'
import { Skeleton } from './Skeleton'
import { EmptyState } from './EmptyState'
import { StatusPill } from './StatusPill'
import { Stepper } from './Stepper'
import { Toast } from './Toast'
import { Button } from './Button'

afterEach(cleanup)
describe('Content primitives', () => {
  it.each([Card, BentoCard])('preserves supplied card semantics and content', Component => {
    render(<Component role="region" aria-label="Saved areas"><h2>Areas</h2></Component>)
    expect(screen.getByRole('region', { name: 'Saved areas' })).toContainElement(screen.getByRole('heading', { name: 'Areas' }))
  })
  it.each(['info', 'synthetic', 'warning', 'error'] as const)('renders a %s banner with visible supporting text', tone => {
    render(<Banner tone={tone} title="Dataset identity">Synthetic, not NASA observations</Banner>)
    const banner = screen.getByRole(tone === 'error' ? 'alert' : 'note')
    expect(banner).toHaveTextContent('Dataset identity')
    expect(banner).toHaveTextContent('Synthetic, not NASA observations')
    expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
  it.each(['ready', 'succeeded', 'partial', 'queued', 'running', 'failed', 'unsupported', 'not_ready', 'unknown_state'])('shows both icon and exact label for %s', value => {
    const { container } = render(<StatusPill value={value} />)
    expect(screen.getByText(value.replaceAll('_', ' '))).toBeVisible()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('[data-status]')).toHaveAttribute('data-status', value)
  })
  it('reserves skeleton dimensions and exposes a loading status', () => {
    render(<Skeleton width={180} height={48} label="Loading areas" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading areas')
    expect(screen.getByRole('status')).toHaveStyle({ width: '180px', height: '48px' })
  })
  it('renders an empty state with an operable action', async () => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<EmptyState title="No area" description="Define a study area." action={<Button onClick={action}>Define</Button>} />)
    expect(screen.getByRole('heading', { name: 'No area' })).toBeVisible()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(action).toHaveBeenCalledOnce()
  })
  it('keeps a presentational stepper non-interactive with an announced current step', () => {
    render(<Stepper label="Analysis setup" steps={[
      { id: 'area', label: 'Define area', state: 'complete' },
      { id: 'interval', label: 'Choose interval', state: 'current', description: 'UTC, end excluded' },
      { id: 'run', label: 'Run analysis', state: 'upcoming' },
    ]} />)
    expect(screen.getByRole('list', { name: 'Analysis setup' })).toBeVisible()
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('complete')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('exposes toast content as a live status with keyboard dismissal', async () => {
    const dismiss = vi.fn()
    const user = userEvent.setup()
    render(<Toast message="Copied" onDismiss={dismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(dismiss).toHaveBeenCalledOnce()
  })
})
