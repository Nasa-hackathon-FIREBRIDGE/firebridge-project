import { useId, type ReactNode } from 'react'
import { CalendarDays } from 'lucide-react'
import { Button } from './Button'
import { Input } from './Field'
import { Popover } from './Popover'

/** Presentation mirror: the original named native inputs remain visible and own FormData. */
export function DateRangePicker({ start, end, onStartChange, onEndChange, disabled, children, triggerLabel }: {
  start: string; end: string; onStartChange: (value: string) => void; onEndChange: (value: string) => void
  disabled?: boolean; children: ReactNode; triggerLabel: string
}) {
  const noteId = useId()
  return <div className="fw-date-range">
    {children}
    <p id={noteId} className="fw-date-note">{start || 'YYYY-MM-DD'} → {end || 'YYYY-MM-DD'} · end excluded · UTC</p>
    <Popover label={triggerLabel} trigger={<Button size="small" disabled={disabled} aria-describedby={noteId}><CalendarDays size={16} aria-hidden="true" />{triggerLabel}</Button>}>
      <h3>UTC interval</h3><p>YYYY-MM-DD · end excluded · UTC</p>
      <Input label="Start date in date picker" type="date" value={start} disabled={disabled} onChange={event => onStartChange(event.target.value)} />
      <Input label="Exclusive end date in date picker" type="date" value={end} disabled={disabled} onChange={event => onEndChange(event.target.value)} />
      <p>Changes update the visible fields. The existing form or filter action still controls the request.</p>
    </Popover>
  </div>
}
