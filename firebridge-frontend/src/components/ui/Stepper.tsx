import { Check } from 'lucide-react'

export type Step = { id: string; label: string; state: 'complete' | 'current' | 'upcoming'; description?: string }
export function Stepper({ steps, label }: { steps: readonly Step[]; label: string }) {
  return <ol className="ui-stepper" aria-label={label}>{steps.map((step, index) =>
    <li key={step.id} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
      <span className="ui-step-number" aria-hidden="true">{step.state === 'complete' ? <Check size={16} /> : index + 1}</span>
      <div><span className="sr-only">{step.state}: </span><strong>{step.label}</strong>{step.description && <p>{step.description}</p>}</div>
    </li>)}</ol>
}
