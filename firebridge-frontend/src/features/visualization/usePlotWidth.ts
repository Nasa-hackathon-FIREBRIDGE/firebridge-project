import { useLayoutEffect, useState } from 'react'

/** Measure the card content rather than guessing from the viewport or scaling tiny SVG text. */
export function usePlotWidth(fallback = 640) {
  const [element, ref] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const next = Math.floor(element.clientWidth)
      if (next > 0) setWidth((current) => current === next ? current : next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return { ref, width }
}
