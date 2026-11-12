import { useState } from 'react'
import { useCreateExplanation } from '../../hooks/useDataApi'
import { useIntentKey } from '../../hooks/useIntentKey'
import type { ExplanationInput } from '../../services/data.types'
import { ApiErrorMessage, Facts } from './ApiPrimitives'
import { ExplanationResult } from './ExplanationResult'

export function ExplanationRequestPanel({ id }: { id: string }) {
  const mutation = useCreateExplanation()
  const intentKey = useIntentKey()
  const [language, setLanguage] = useState<ExplanationInput['language']>('en')
  const [question, setQuestion] = useState('')
  return <section className="panel api-section"><h2>Request an explanation</h2>
    <p>The server prepares a deterministic factual summary. No external AI provider is called, and a free-text question is not a promise of an answer.</p>
    <form className="api-form" onSubmit={(e) => {
      e.preventDefault()
      const input: ExplanationInput = { language, ...(question.trim() ? { question: question.trim() } : {}) }
      mutation.mutate({ analysisId: id, input, idempotencyKey: intentKey({ id, input }) })
    }}>
      <label>Language<select value={language} onChange={(e) => setLanguage(e.target.value as ExplanationInput['language'])}><option value="en">English</option><option value="fr">French</option></select></label>
      <label>Question (optional)<textarea value={question} maxLength={512} onChange={(e) => setQuestion(e.target.value)} /></label>
      <button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Sending…' : 'Request the summary'}</button>
    </form><ApiErrorMessage operation="write" error={mutation.error} />
    {mutation.data && (
  <div>
    <Facts
      values={{
        'Explanation created': mutation.data.data.explanation_id,
        Job: mutation.data.data.job_id,
      }}
    />

    {mutation.data.warnings.map((warning) => (
      <p key={warning}>{warning}</p>
    ))}

    <ExplanationResult
      id={mutation.data.data.explanation_id}
    />
  </div>
)}
  </section>
}

