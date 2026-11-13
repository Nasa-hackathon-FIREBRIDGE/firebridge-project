import type { ComponentProps } from 'react'

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return <div {...props} className={`ui-card ${className}`} />
}

export function BentoCard({ className = '', ...props }: ComponentProps<'div'>) {
  return <Card {...props} className={`ui-bento-card ${className}`} />
}
