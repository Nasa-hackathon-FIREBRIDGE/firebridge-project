import type { CSSProperties } from 'react'

export function Skeleton({ width = '100%', height = 24, label = 'Loading' }: {
  width?: CSSProperties['width']; height?: CSSProperties['height']; label?: string
}) {
  return <span className="ui-skeleton" role="status" style={{ width, height }}><span className="sr-only">{label}</span></span>
}
