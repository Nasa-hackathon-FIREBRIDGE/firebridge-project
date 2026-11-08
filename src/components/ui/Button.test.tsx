// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

afterEach(cleanup)
describe('Button', () => {
  it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)('keeps %s a named keyboard-operable native button', async variant => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<Button variant={variant} onClick={action}>Run</Button>)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus()
    await user.keyboard('{Enter} ')
    expect(action).toHaveBeenCalledTimes(2)
  })
  it('does not submit forms by default', async () => {
    const submit = vi.fn(event => event.preventDefault())
    render(<form onSubmit={submit}><Button>Inspect</Button></form>)
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(submit).not.toHaveBeenCalled()
  })
  it('supports an explicit submit button', async () => {
    const submit = vi.fn(event => event.preventDefault())
    render(<form onSubmit={submit}><Button type="submit" size="large">Save</Button></form>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(submit).toHaveBeenCalledOnce()
  })
  it('blocks activation while loading and retains its accessible name', async () => {
    const action = vi.fn()
    render(<Button loading onClick={action}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(button)
    expect(action).not.toHaveBeenCalled()
  })
  it('connects a visible disabled reason while retaining other descriptions', async () => {
    const action = vi.fn()
    const { rerender } = render(<><span id="context">Context</span><Button disabled disabledReason="Select an area first" aria-describedby="context" onClick={action}>Run</Button></>)
    const button = screen.getByRole('button', { name: 'Run' })
    expect(button).toHaveAccessibleDescription('Context Select an area first')
    await userEvent.click(button)
    expect(action).not.toHaveBeenCalled()
    rerender(<Button disabledReason="Select an area first">Run</Button>)
    expect(screen.queryByText('Select an area first')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
