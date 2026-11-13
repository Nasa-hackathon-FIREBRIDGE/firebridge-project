import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A horizontally scrolling strip (tab bar, chip row) that tells you what is hidden. Reports whether
 * content is cut off at either end, scrolls by most of a screenful, turns a vertical mouse wheel
 * into horizontal scrolling while there is room to scroll, and can bring a child into view
 * without moving the page vertically.
 */
export function useScrollOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges((previous) => {
        const next = { start: el.scrollLeft > 2, end: max > 2 && el.scrollLeft < max - 2 }
        return previous.start === next.start && previous.end === next.end ? previous : next
      })
    }
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      const room = event.deltaY > 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1
      if (max <= 0 || !room) return // let the page scroll once the strip is at its end
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    for (const child of el.children) observer?.observe(child)
    return () => {
      el.removeEventListener('scroll', update)
      el.removeEventListener('wheel', wheel)
      observer?.disconnect()
    }
  }, [])

  const scroll = useCallback((direction: -1 | 1) => {
    const el = ref.current
    el?.scrollBy?.({ left: direction * el.clientWidth * 0.7, behavior: 'smooth' })
  }, [])

  /** Bring a child into horizontal view only; the page itself does not scroll. */
  const reveal = useCallback((child: HTMLElement | null) => {
    const el = ref.current
    if (!el || !child) return
    const left = child.offsetLeft - 24
    const right = child.offsetLeft + child.offsetWidth + 24 - el.clientWidth
    if (el.scrollLeft > left) el.scrollTo?.({ left, behavior: 'smooth' })
    else if (el.scrollLeft < right) el.scrollTo?.({ left: right, behavior: 'smooth' })
  }, [])

  return { ref, edges, scroll, reveal }
}
