import { isRecord } from '../../lib/api.validation'
import { StructuredValue } from './ApiPrimitives'

export function FactualExplanation({ status, output }: { status: string; output: unknown }) {
  if (['queued', 'running'].includes(status)) {
    return <p role="status">Explication en préparation. Le worker traite la demande ; le résultat s’actualise automatiquement.</p>
  }
  if (['failed', 'rejected', 'cancelled'].includes(status)) {
    return <p role="alert">La génération n’a pas abouti. État : {status}. Aucun résultat validé n’est disponible pour cette demande.</p>
  }
  if (!['validated', 'template_fallback'].includes(status) || !isRecord(output)) {
    return <p>Aucun résultat disponible pour cet état : {status}.</p>
  }
  const findings = Array.isArray(output.findings) ? output.findings.filter(isRecord) : []
  const citations = Array.isArray(output.citations) ? output.citations.filter(isRecord) : []
  const limitations = Array.isArray(output.limitations)
    ? [...new Set(output.limitations.filter((value): value is string => typeof value === 'string'))]
    : []

  return (
    <div className="api-stack">
      <p>Cette synthèse est produite à partir des faits enregistrés avec l’analyse. Elle ne constitue ni une prédiction ni une confirmation d’incendies uniques.</p>
      {typeof output.summary === 'string' && <h3>{output.summary}</h3>}
      {findings.length > 0 && (
        <section aria-label="Constats de l’explication">
          <h3>Constats</h3>
          <ul>{findings.map((finding, index) => (
            <li key={typeof finding.fact_id === 'string' ? finding.fact_id : index}>
              <p>{typeof finding.text === 'string' ? finding.text : 'Constat sans description textuelle.'}</p>
              {typeof finding.source_id === 'string' && <small>Source : <code>{finding.source_id}</code></small>}
            </li>
          ))}</ul>
        </section>
      )}
      {citations.length > 0 && (
        <section aria-label="Sources citées">
          <h3>Sources citées</h3>
          <ul>{citations.map((citation, index) => (
            <li key={typeof citation.id === 'string' ? citation.id : index}>
              {typeof citation.citation === 'string' && <p>{citation.citation}</p>}
              <p>{[citation.product, citation.collection].filter((value) => typeof value === 'string').join(' · ')}</p>
              {typeof citation.source_id === 'string' && <code>{citation.source_id}</code>}
            </li>
          ))}</ul>
        </section>
      )}
      {limitations.length > 0 && (
        <section aria-label="Limites de l’explication"><h3>Limites</h3>
          <ul>{limitations.map((value) => <li key={value}>{value.replaceAll('_', ' ').toLowerCase()}</li>)}</ul>
        </section>
      )}
      <details><summary>Détails structurés de la réponse</summary><StructuredValue value={output} /></details>
    </div>
  )
}
