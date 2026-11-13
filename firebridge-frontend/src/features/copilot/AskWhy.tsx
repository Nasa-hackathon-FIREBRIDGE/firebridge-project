import { Sparkles } from 'lucide-react'
import { useCopilot } from './context'

/** "Ask why" on any finding: opens the copilot with the question already asked. Renders
 *  nothing outside a workspace that provides the copilot. */
export function AskWhy({ question, month, label = 'Ask why', className = '' }: { question: string; month?: string; label?: string; className?: string }) {
  const copilot = useCopilot()
  if (!copilot || copilot.available === false) return null
  return (
    <button
      type="button"
      onClick={() => copilot.ask(question, month ? { month } : undefined)}
      title={question}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-ember-400/25 bg-ember-500/10 px-2.5 py-1 text-[11.5px] font-medium text-ember-200 transition-colors hover:border-ember-400/45 hover:bg-ember-500/20 ${className}`}
    >
      <Sparkles size={12} aria-hidden="true" />
      {label}
    </button>
  )
}
