import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>{children}</MotionConfig>
}
