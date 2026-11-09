import { useExplanation } from '../../hooks/useDataApi'
import { ResourcePanel } from './ApiPrimitives'
import { FactualExplanation } from './FactualExplanation'

export function ExplanationResult({ id }: { id: string }) {
  const query = useExplanation(id)

  return (
    <ResourcePanel title="Résultat de l’explication" query={query}>
      {(data) => <FactualExplanation status={data.status} output={data.output} />}
    </ResourcePanel>
  )
}
