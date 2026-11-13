import { useId, type ComponentProps, type ReactNode } from 'react'

type FieldProps = { label: string; hint?: string; error?: string }

function FieldFrame({ id, label, hint, error, children }: FieldProps & { id: string; children: ReactNode }) {
  return <div className="ui-field"><label htmlFor={id}>{label}</label>{children}
    {hint && <span id={`${id}-hint`} className="ui-hint">{hint}</span>}
    {error && <span id={`${id}-error`} className="ui-field-error">{error}</span>}
  </div>
}
function description(id: string, hint?: string, error?: string, extra?: string) {
  return [extra, hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
}

export function Input({ label, hint, error, id: suppliedId, className = '', 'aria-describedby': describedBy, ...props }: ComponentProps<'input'> & FieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  return <FieldFrame {...{ id, label, hint, error }}><input {...props} id={id} className={`ui-input ${className}`}
    aria-invalid={error ? true : props['aria-invalid']} aria-describedby={description(id, hint, error, describedBy)} /></FieldFrame>
}

export function Select({ label, hint, error, id: suppliedId, className = '', 'aria-describedby': describedBy, ...props }: ComponentProps<'select'> & FieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  return <FieldFrame {...{ id, label, hint, error }}><select {...props} id={id} className={`ui-input ${className}`}
    aria-invalid={error ? true : props['aria-invalid']} aria-describedby={description(id, hint, error, describedBy)} /></FieldFrame>
}
