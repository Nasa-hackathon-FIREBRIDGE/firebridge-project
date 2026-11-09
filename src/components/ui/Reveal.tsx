import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/** Fades and lifts content into view once. Respects reduced-motion via MotionConfig. */
export function Reveal({ children, delay = 0, y = 22, className = '', as = 'div' }: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'article'
}) {
  const Component = motion[as]
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.75, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Component>
  )
}
