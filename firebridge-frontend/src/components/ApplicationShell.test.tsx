// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationShell } from './ApplicationShell'
vi.mock('./ChatWidget', () => ({ ChatWidget: () => <span>Demo assistant</span> }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function mount(compact: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: compact && query === '(max-width: 820px)', addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  render(<MemoryRouter initialEntries={['/analyses?analysis=retained#workspace-top']}><ApplicationShell demoControls={null}><button>Workspace action</button></ApplicationShell></MemoryRouter>)
}
it('preserves mobile Escape, modal boundaries and focus restoration', async () => {
  mount(true)
  const menu = screen.getByRole('button', { name: 'Open navigation' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Workspace action' })).toBeVisible()
  fireEvent.click(menu)
  const dialog = screen.getByRole('dialog', { name: 'Application navigation' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(document.getElementById('main-content')).toHaveAttribute('inert')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus())
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(menu).toHaveFocus())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.getElementById('main-content')).not.toHaveAttribute('inert')
  expect(document.body.style.overflow).not.toBe('hidden')
})
it('preserves drawer Tab wrapping and the explicit close action', async () => {
  mount(true)
  const menu = screen.getByRole('button', { name: 'Open navigation' })
  fireEvent.click(menu)
  const dialog = screen.getByRole('dialog')
  const first = within(dialog).getByRole('link', { name: 'FIREBRIDGE home' })
  const navLinks = within(dialog).getAllByRole('link')
  const last = navLinks[navLinks.length - 1]
  last.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(first).toHaveFocus()
  first.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close navigation' }))
  await waitFor(() => expect(menu).toHaveFocus())
})
it('keeps desktop navigation and published/synthetic scope without modal or notifications', () => {
  mount(false)
  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Analysis workspace' })).toHaveAttribute('href', '/analyses')
  expect(screen.getByText(/Test releases can contain synthetic records/)).toBeVisible()
  expect(screen.queryByText('Demo assistant')).not.toBeInTheDocument()
  // The synthetic demonstration and its Preferences page are hidden from the public app.
  expect(screen.queryByText('Demonstration')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Preferences' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sources & credits' })).toHaveAttribute('href', '/sources')
  expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument()
})
