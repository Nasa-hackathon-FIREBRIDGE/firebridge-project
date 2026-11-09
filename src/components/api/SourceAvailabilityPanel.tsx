import { useAvailability } from '../../hooks/useDataApi'
import { Facts, Limitations, Records, ResourcePanel } from './ApiPrimitives'

export function SourceAvailabilityPanel({
  sourceId,
  scopeKey,
}: {
  sourceId: string
  scopeKey: string
}) {
  const query = useAvailability(sourceId, { scope_key: scopeKey })

  return (
    <ResourcePanel title="Disponibilité et imports de la source" query={query}>
      {(data) => (
        <>
          <Facts values={{
            Source: data.source_id,
            Périmètre: data.scope_key,
            'État du fournisseur': data.provider_status,
            'Complétude d’import': data.ingestion_completeness,
            'Couverture d’observation': data.observation_coverage,
            'Actualisation en retard': data.stale,
            'Motif du retard': data.stale_reason,
          }} />
          <p>
            La complétude d’import indique ce que le système a reçu. La couverture
            d’observation indique ce que le satellite a pu observer : ce sont deux
            informations différentes. Une valeur inconnue reste inconnue.
          </p>

          <h3>Historique de collecte · UTC</h3>
          <Facts values={{
            'Dernière tentative': data.last_attempt_at,
            'Dernier import réussi': data.last_success_at,
            'Interrogé jusqu’au': data.queried_through,
            'Dernière observation reçue': data.latest_observation_at,
            'Publication': data.published_at,
            'Prochaine vérification': data.next_check_at,
          }} />
          <p>
            La date d’une observation est sa date d’acquisition ; elle peut être
            antérieure à la date de son import.
          </p>

          <h3>Lacunes d’import signalées</h3>
          <Records rows={data.gaps} empty="Aucune lacune d’import signalée pour cette sélection." />
          {data.gaps_truncated && (
            <p role="note">L’API indique que cette liste de lacunes est tronquée.</p>
          )}
          <p>L’absence de lacune signalée ne prouve pas que l’inventaire est complet.</p>

          <details>
            <summary>Flux de collecte associés ({data.feeds.length})</summary>
            <Records rows={data.feeds} empty="Aucun flux de collecte associé n’a été renvoyé." />
          </details>
          <Limitations data={data} />
        </>
      )}
    </ResourcePanel>
  )
}
