import { useEffect, useRef, useState } from 'react'

/** Measured content width of an element, for charts drawn in pixels (text stays legible at any
 *  width, unlike a scaled viewBox). Falls back to `fallback` where ResizeObserver is missing. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}
