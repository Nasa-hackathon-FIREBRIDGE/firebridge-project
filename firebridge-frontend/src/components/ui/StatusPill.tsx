import { Activity, Check, CircleAlert, Clock3, Info, MinusCircle, XCircle, type LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

const kinds: Record<string, { tone: string; icon: LucideIcon }> = {
  ready: { tone: 'success', icon: Check }, succeeded: { tone: 'success', icon: Check },
  alive: { tone: 'success', icon: Check }, accepted: { tone: 'success', icon: Check },
  validated: { tone: 'success', icon: Check }, prepared: { tone: 'success', icon: Check },
  partial: { tone: 'partial', icon: CircleAlert }, queued: { tone: 'neutral', icon: Clock3 },
  checking: { tone: 'neutral', icon: Clock3 }, running: { tone: 'active', icon: Activity },
  failed: { tone: 'danger', icon: XCircle }, unavailable: { tone: 'danger', icon: XCircle },
  unsupported: { tone: 'neutral', icon: MinusCircle },
  not_ready: { tone: 'warning', icon: CircleAlert }, not_prepared: { tone: 'warning', icon: CircleAlert },
  missing: { tone: 'warning', icon: CircleAlert },
}

export function StatusPill({ value, className = '', ...props }: Omit<ComponentProps<'span'>, 'children'> & { value: string }) {
  const { tone, icon: Icon } = kinds[value] ?? { tone: 'neutral', icon: Info }
  return <span {...props} className={`ui-status ${className}`} data-status={value} data-tone={tone}>
    <Icon size={14} aria-hidden="true" /><span>{value.replaceAll('_', ' ')}</span>
  </span>
}
