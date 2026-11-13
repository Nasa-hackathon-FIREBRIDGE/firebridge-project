import { AlertCircle, FlaskConical, Info, TriangleAlert } from 'lucide-react'
import type { ComponentProps } from 'react'

const icons = { info: Info, synthetic: FlaskConical, warning: TriangleAlert, error: AlertCircle }
export function Banner({ tone = 'info', title, children, className = '', role, ...props }: Omit<ComponentProps<'div'>, 'title'> & {
  tone?: keyof typeof icons; title?: string
}) {
  const Icon = icons[tone]
  return <div {...props} className={`ui-banner ${className}`} data-tone={tone} role={role ?? (tone === 'error' ? 'alert' : 'note')}>
    <Icon size={18} aria-hidden="true" /><div className="ui-banner-content">{title && <strong>{title}</strong>}{children}</div>
  </div>
}
