import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export function Toast({ message, onDismiss }: { message: ReactNode; onDismiss: () => void }) {
  return <div className="ui-toast"><div role="status" aria-live="polite" aria-atomic="true">{message}</div>
    <Button variant="ghost" size="small" aria-label="Dismiss notification" onClick={onDismiss}><X size={16} aria-hidden="true" /></Button>
  </div>
}
