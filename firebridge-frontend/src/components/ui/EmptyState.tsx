import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ title, description, action, icon = <Inbox size={24} aria-hidden="true" />, className = '' }: {
  title?: string; description: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string
}) {
  return <div className={`ui-empty ${className}`}>
    <span className="ui-empty-icon" aria-hidden="true">{icon}</span><div>
      {title && <h3>{title}</h3>}<div className="ui-empty-description">{description}</div>{action && <div className="ui-empty-action">{action}</div>}
    </div>
  </div>
}
