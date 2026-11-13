import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'

/** Animated number that renders the exact value for assistive technology and reduced motion. */
export function CountUp({ value, duration = 1.1, format = (v: number) => Math.round(v).toLocaleString('en-US') }: {
  value: number
  duration?: number
  format?: (value: number) => string
}) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced === false ? 0 : value)
  useEffect(() => {
    if (reduced !== false) return
    const controls = animate(0, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setDisplay })
    return () => controls.stop()
  }, [value, duration, reduced])
  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(reduced === false ? display : value)}</span>
    </>
  )
}
