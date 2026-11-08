import { useId, type ComponentProps } from 'react'
import { LoaderCircle } from 'lucide-react'

export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'small' | 'medium' | 'large'
  loading?: boolean
  disabledReason?: string
}

export function Button({ variant = 'secondary', size = 'medium', loading = false, disabled,
  disabledReason, className = '', children, type = 'button', 'aria-describedby': describedBy, ...props }: ButtonProps) {
  const reasonId = useId()
  const blocked = disabled || loading
  const reason = blocked ? disabledReason : undefined
  const button = <button {...props} type={type} disabled={blocked} aria-busy={loading || undefined}
    aria-describedby={[describedBy, reason ? reasonId : undefined].filter(Boolean).join(' ') || undefined}
    className={`ui-button ui-button--${variant} ui-button--${size} ${className}`}>
    {loading && <LoaderCircle className="ui-spinner" size={16} aria-hidden="true" />}{children}
  </button>
  return reason ? <span className="ui-control-stack">{button}<span id={reasonId} className="ui-hint">{reason}</span></span> : button
}
