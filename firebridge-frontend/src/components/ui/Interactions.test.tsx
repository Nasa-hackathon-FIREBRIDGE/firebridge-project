// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from './Tooltip'
import { CopyableId } from './CopyableId'
import { Button } from './Button'

// jsdom has no layout engine; actual tooltip positioning is verified in Chrome.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('Supporting interactions', () => {
  it('opens a supporting tooltip on keyboard focus and dismisses with Escape', async () => {
    const user = userEvent.setup()
    render(<Tooltip content="Full release identifier"><Button>Release details</Button></Tooltip>)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Full release identifier')
    expect(screen.getByRole('button', { name: 'Release details' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveFocus()
  })
  it('copies the full identifier from its keyboard-operable abbreviated button', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<CopyableId value="abcdef12-full-identifier" label="analysis ID" />)
    const button = screen.getByRole('button', { name: 'Copy analysis ID: abcdef12-full-identifier' })
    expect(button).toHaveTextContent('abcdef12')
    await user.tab()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'))
    expect(write).toHaveBeenCalledWith('abcdef12-full-identifier')
  })
  it('provides an honest selectable full-value fallback when clipboard access fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Permission denied'))
    render(<CopyableId value="abcdef12-full-identifier" />)
    await user.click(screen.getByRole('button', { name: 'Copy ID: abcdef12-full-identifier' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy unavailable'))
    expect(screen.getByText('abcdef12-full-identifier')).toBeVisible()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })
  it('does not show stale copy success for a different identifier', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const { rerender } = render(<CopyableId value="first-id" />)
    await user.click(screen.getByRole('button', { name: 'Copy ID: first-id' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'))
    rerender(<CopyableId value="second-id" />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: 'Copy ID: second-id' })).toBeVisible()
  })
})
