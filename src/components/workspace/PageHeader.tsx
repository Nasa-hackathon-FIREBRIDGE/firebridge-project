import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: ReactNode
}) {
  return <header className="platform-page-header ui-page-header">
    <div><span className="platform-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {action && <div className="platform-page-actions">{action}</div>}
  </header>
}
