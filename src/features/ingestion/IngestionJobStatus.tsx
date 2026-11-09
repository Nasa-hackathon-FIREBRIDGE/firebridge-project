import { type AdminSession, useIngestionJob } from '../../hooks/useIngestion'
import { ApiErrorMessage, Facts } from '../../components/api/ApiPrimitives'

export function IngestionJobStatus({ session, id }: { session: AdminSession; id: string }) {
  const query = useIngestionJob(session, id)
  return (
    <section aria-label="Suivi de la planification">
      <h3>Suivi de la planification</h3>
      <button type="button" className="button button-secondary" disabled={query.isFetching}
        onClick={() => void query.refetch()}>Actualiser la tâche de planification</button>
      {query.isPending && <p role="status">Chargement de la tâche…</p>}
      <ApiErrorMessage error={query.error} />
      {query.data && <Facts values={{ Tâche: query.data.id, État: query.data.status, Étape: query.data.current_stage, Tentative: query.data.attempt, 'Tentatives maximales': query.data.max_attempts }} />}
      {query.data?.current_stage === 'awaiting_fetch_executor' && <p role="status">
        Plan prêt, en attente d’un exécuteur d’import. Aucun téléchargement ni aucune publication ne sont confirmés.
        Utilise « Actualiser la tâche de planification » pour vérifier une éventuelle prise en charge par le pipeline.
      </p>}
      <p>Le statut de cette tâche concerne la préparation de l’import. Même une planification réussie ne prouve pas qu’un téléchargement ou une publication de données a eu lieu.</p>
    </section>
  )
}
