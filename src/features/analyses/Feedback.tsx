import type { ReactNode } from 'react'
import { StatusPill } from '../../components/ui/StatusPill'
import { EmptyState } from '../../components/ui/EmptyState'
export { FeedbackMessage as ApiError } from '../../components/FeedbackMessage'

export function Status({ value }: { value: string }) {
  return <StatusPill value={value} className="fb-status" />
}
export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState className="fb-empty" description={children} />
}
