import { useId, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from './Button'

export function CopyableId({ value, label = 'ID', shortLength = 8 }: { value: string; label?: string; shortLength?: number }) {
  const [copyState, setCopyState] = useState({ value: '', message: '' })
  const feedback = copyState.value === value ? copyState.message : ''
  const feedbackId = useId()
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState({ value, message: 'Copied' })
    } catch {
      setCopyState({ value, message: 'Copy unavailable. Select and copy the full ID below.' })
    }
  }
  return <span className="ui-copyable-id">
    <Button variant="ghost" size="small" aria-label={`Copy ${label}: ${value}`} aria-describedby={feedbackId} onClick={() => { void copy() }}>
      <code>{value.slice(0, Math.max(1, shortLength))}</code>{feedback === 'Copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </Button><span id={feedbackId} className="ui-hint" role="status">{feedback}</span>
    {feedback.startsWith('Copy unavailable') && <code className="ui-copy-fallback">{value}</code>}
  </span>
}
