import type { ReactNode } from 'react'
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="fb-section-heading ui-section-heading">
      <div>
        {eyebrow && <span className="fb-eyebrow">{eyebrow}</span>}
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="fb-section-action">{action}</div>}
    </div>
  )
}
