import { lazy, Suspense, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { Card } from './Card'

const AnimatedNumber = lazy(() => import('./AnimatedNumber'))

export type StatCardProps = {
  label: string
  value: number | string
  context?: ReactNode
  trend?: ReactNode
  animate?: boolean
  formatValue?: (value: number) => string
}
const formatNumber = (value: number) => value.toLocaleString()

export function StatCard({ label, value, context, trend, animate = false, formatValue = formatNumber }: StatCardProps) {
  const reducedMotion = useReducedMotion()
  const formatted = typeof value === 'number' ? formatValue(value) : value
  return <Card className="ui-stat">
    <dl><dt>{label}</dt><dd><span className="sr-only">{formatted}</span><span aria-hidden="true">
      {animate && reducedMotion === false && typeof value === 'number' && Number.isFinite(value)
        ? <Suspense fallback={formatted}><AnimatedNumber value={value} formatValue={formatValue} /></Suspense>
        : formatted}
    </span></dd></dl>
    {context && <p className="ui-stat-context">{context}</p>}
    {trend && <div className="ui-stat-trend">{trend}</div>}
  </Card>
}
