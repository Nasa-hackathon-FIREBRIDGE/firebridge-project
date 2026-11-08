import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'

export default function AnimatedNumber({ value, formatValue }: { value: number; formatValue: (value: number) => string }) {
  const reducedMotion = useReducedMotion()
  const [display, setDisplay] = useState(value)
  useEffect(() => {
    if (reducedMotion !== false) return
    const animation = animate(0, value, { duration: 0.32, ease: [0.2, 0, 0, 1], onUpdate: setDisplay })
    return () => animation.stop()
  }, [value, reducedMotion])
  return formatValue(reducedMotion !== false ? value : display)
}
