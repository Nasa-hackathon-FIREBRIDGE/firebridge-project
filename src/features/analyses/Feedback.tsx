import type { ReactNode } from 'react'
export { FeedbackMessage as ApiError } from '../../components/FeedbackMessage'

export function Status({ value }: { value: string }) {
  return (
    <span className="fb-status" data-status={value}>
      {value.replaceAll('_', ' ')}
    </span>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="fb-empty">{children}</p>
}
