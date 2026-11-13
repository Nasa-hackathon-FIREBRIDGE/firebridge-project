// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TabIndicator } from './TabIndicator'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function mount(reduced = false) {
  let change: () => void = () => {}
  const media = { matches: reduced, addEventListener: (_: string, fn: () => void) => { change = fn }, removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { left: this.id === 'first' ? 24 : this.id === 'second' ? 184 : 12, width: this.id === 'first' ? 140 : 180 } as DOMRect
  })
  const selected = vi.fn()
  const view = render(<div role="tablist"><button role="tab" id="first" aria-selected="true" onClick={selected}>Map</button><button role="tab" id="second" aria-selected="false" onClick={selected}>Evidence</button><TabIndicator /></div>)
  return { ...view, selected, media, change: () => change(), marker: view.container.querySelector('.ui-tab-indicator') as HTMLSpanElement }
}
it('adds no focus target or selection handler and follows focused tabs', () => {
  const { marker, selected } = mount()
  expect(marker).toHaveAttribute('aria-hidden', 'true')
  expect(marker).not.toHaveAttribute('tabindex')
  expect(marker.style.transform).toBe('translateX(12px)')
  act(() => screen.getByRole('tab', { name: 'Evidence' }).focus())
  expect(marker.style.transform).toBe('translateX(172px)')
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
  expect(selected).not.toHaveBeenCalled()
})
it('follows external selection changes and keeps content coordinates during scroll/resize', async () => {
  const { marker } = mount()
  screen.getByRole('tab', { name: 'Map' }).setAttribute('aria-selected', 'false')
  screen.getByRole('tab', { name: 'Evidence' }).setAttribute('aria-selected', 'true')
  await waitFor(() => expect(marker.dataset.target).toBe('second'))
  const list = screen.getByRole('tablist')
  list.scrollLeft = 44
  fireEvent.scroll(list)
  expect(marker.style.transform).toBe('translateX(216px)')
  fireEvent(window, new Event('resize'))
  expect(marker.style.width).toBe('180px')
})
it('places the final indicator immediately and reacts to reduced-motion changes', () => {
  const { marker, media, change } = mount(true)
  expect(marker.style.width).toBe('140px')
  expect(marker.style.transitionDuration).toBe('0ms')
  act(() => screen.getByRole('tab', { name: 'Evidence' }).focus())
  expect(marker.style.transform).toBe('translateX(172px)')
  expect(marker.style.transitionDuration).toBe('0ms')
  media.matches = false
  act(change)
  expect(marker.style.transitionDuration).toBe('')
})
