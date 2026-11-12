import { useExplanation } from '../../hooks/useDataApi'
import { ResourcePanel, StructuredValue } from './ApiPrimitives'

export function ExplanationResult({ id }: { id: string }) {
  const query = useExplanation(id)

  return (
    <ResourcePanel title="Explanation result" query={query}>
      {(data) => {
        if (['queued', 'running'].includes(data.status)) {
          return (
            <p role="status">
              The explanation is being prepared. A worker must be running
              to process this request.
            </p>
          )
        }

        if (['failed', 'rejected', 'cancelled'].includes(data.status)) {
          return (
            <p role="alert">
              Generation did not complete. Status: {data.status}.
            </p>
          )
        }

        if (
          ['validated', 'template_fallback'].includes(data.status) &&
          data.output !== null
        ) {
          return <StructuredValue value={data.output} />
        }

        return <p>No result is available for this status: {data.status}.</p>
      }}
    </ResourcePanel>
  )
}