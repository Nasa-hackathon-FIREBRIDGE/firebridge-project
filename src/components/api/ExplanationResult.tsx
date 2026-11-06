import { useExplanation } from '../../hooks/useDataApi'
import { ResourcePanel, StructuredValue } from './ApiPrimitives'

export function ExplanationResult({ id }: { id: string }) {
  const query = useExplanation(id)

  return (
    <ResourcePanel title="Résultat de l’explication" query={query}>
      {(data) => {
        if (['queued', 'running'].includes(data.status)) {
          return (
            <p role="status">
              Explication en préparation. Le worker doit être lancé
              pour traiter cette demande.
            </p>
          )
        }

        if (['failed', 'rejected', 'cancelled'].includes(data.status)) {
          return (
            <p role="alert">
              La génération n’a pas abouti. État : {data.status}.
            </p>
          )
        }

        if (
          ['validated', 'template_fallback'].includes(data.status) &&
          data.output !== null
        ) {
          return <StructuredValue value={data.output} />
        }

        return <p>Aucun résultat disponible pour cet état : {data.status}.</p>
      }}
    </ResourcePanel>
  )
}