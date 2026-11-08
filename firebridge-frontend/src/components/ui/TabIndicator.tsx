import { useLayoutEffect, useRef } from 'react'

/** Decorative follower only: the owning tablist retains all focus/selection behavior. */
export function TabIndicator() {
  const marker = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const indicator = marker.current
    const strip = indicator?.parentElement
    if (!indicator || !strip) return
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const place = () => {
      const focused = document.activeElement
      const tab = focused instanceof HTMLElement && focused.getAttribute('role') === 'tab' && focused.parentElement === strip
        ? focused : strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!tab) { indicator.hidden = true; return }
      const box = tab.getBoundingClientRect(), parent = strip.getBoundingClientRect()
      indicator.hidden = false
      indicator.style.width = `${box.width}px`
      indicator.style.transform = `translateX(${box.left - parent.left + strip.scrollLeft - strip.clientLeft}px)`
      indicator.style.transitionDuration = media?.matches ? '0ms' : ''
      indicator.dataset.target = tab.id
    }
    place()
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined
    resized?.observe(strip)
    strip.querySelectorAll('[role="tab"]').forEach(tab => resized?.observe(tab))
    const selected = new MutationObserver(place)
    selected.observe(strip, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    strip.addEventListener('focusin', place)
    strip.addEventListener('focusout', place)
    strip.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    media?.addEventListener('change', place)
    return () => {
      resized?.disconnect(); selected.disconnect()
      strip.removeEventListener('focusin', place); strip.removeEventListener('focusout', place)
      strip.removeEventListener('scroll', place); window.removeEventListener('resize', place)
      media?.removeEventListener('change', place)
    }
  }, [])
  return <span ref={marker} className="ui-tab-indicator" aria-hidden="true" />
}
