import { useState } from 'react'
import { useCreateExplanation } from '../../hooks/useDataApi'
import { useIntentKey } from '../../hooks/useIntentKey'
import type { ExplanationInput } from '../../services/data.types'
import { ApiErrorMessage, Facts } from './ApiPrimitives'
import { ExplanationResult } from './ExplanationResult'

export function ExplanationRequestPanel({ id }: { id: string }) {
  const mutation = useCreateExplanation()
  const intentKey = useIntentKey()
  const [language, setLanguage] = useState<ExplanationInput['language']>('fr')
  const [question, setQuestion] = useState('')
  return <section className="panel api-section"><h2>Demander une explication</h2>
    <p>Le serveur prépare une synthèse factuelle déterministe. Aucun fournisseur d’IA externe n’est appelé ; une question libre n’est pas une promesse de réponse.</p>
    <form className="api-form" onSubmit={(e) => {
      e.preventDefault()
      const input: ExplanationInput = { language, ...(question.trim() ? { question: question.trim() } : {}) }
      mutation.mutate({ analysisId: id, input, idempotencyKey: intentKey({ id, input }) })
    }}>
      <label>Langue<select value={language} onChange={(e) => setLanguage(e.target.value as ExplanationInput['language'])}><option value="fr">Français</option><option value="en">English</option></select></label>
      <label>Question (facultative)<textarea value={question} maxLength={512} onChange={(e) => setQuestion(e.target.value)} /></label>
      <button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Envoi…' : 'Demander la synthèse'}</button>
    </form><ApiErrorMessage operation="write" error={mutation.error} />
    {mutation.data && (
  <div>
    <Facts
      values={{
        'Explication créée': mutation.data.data.explanation_id,
        Tâche: mutation.data.data.job_id,
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

