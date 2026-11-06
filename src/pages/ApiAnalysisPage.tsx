import { useState } from 'react'
import { useAnalysis, useCreateAnalysis } from '../hooks/useFirebridge'
import { useIntentKey } from '../hooks/useIntentKey'
import { ApiErrorMessage, Facts } from '../components/api/ApiPrimitives'
import { uuidPattern } from '../components/api/format'
import { CalendarPanel, DetectionsPanel, ProvenancePanel, SummaryPanel } from '../components/api/NativePanels'
import { CellPanel, ComparisonPanel, CoveragePanel, ReportsPanel, WeatherPanel } from '../components/api/ContextPanels'
import { ExplanationRequestPanel } from '../components/api/ExplanationRequestPanel'

const panels = {
  summary: { label: 'Résumé', component: SummaryPanel },
  detections: { label: 'Détections', component: DetectionsPanel },
  calendar: { label: 'Calendrier', component: CalendarPanel },
  provenance: { label: 'Provenance', component: ProvenancePanel },
  coverage: { label: 'Couverture', component: CoveragePanel },
  cell: { label: 'Cellule', component: CellPanel },
  comparison: { label: 'Comparaison', component: ComparisonPanel },
  weather: { label: 'Météo', component: WeatherPanel },
  reports: { label: 'Rapports', component: ReportsPanel },
  explanation: { label: 'Explication', component: ExplanationRequestPanel },
}
export default function ApiAnalysisPage() {
  const [id, setId] = useState('')
  return <div className="page-content api-workspace"><header className="page-heading"><p className="eyebrow">FIREBRIDGE API</p><h1>Consulter une analyse</h1><p>Résultats servis par le backend. La base choisie côté serveur détermine les données : en local, elle peut contenir des jeux de test synthétiques.</p></header>
    <section className="panel api-section"><h2>Choisir une analyse enregistrée</h2>
      <form className="api-form" onSubmit={(e) => { e.preventDefault(); setId(String(new FormData(e.currentTarget).get('analysis')).trim()) }}>
        <label>Identifiant d’analyse<input name="analysis" required pattern={uuidPattern} placeholder="UUID de l’analyse" /></label><button className="button button-primary">Ouvrir l’analyse</button>
      </form><CreateAnalysis onCreated={setId} />
    </section>
    {id ? <AnalysisResults key={id} id={id} /> : <p>Ouvrir une analyse existante ou en créer une sur une zone déjà enregistrée.</p>}
  </div>
}
function CreateAnalysis({ onCreated }: { onCreated: (id: string) => void }) {
  const mutation = useCreateAnalysis()
  const intentKey = useIntentKey()
  return <details><summary>Créer une analyse native sur une zone existante</summary>
    <form className="api-form" onSubmit={(e) => {
      e.preventDefault()
      const values = new FormData(e.currentTarget)
      const input = { area_id: String(values.get('area')).trim(), start_date: String(values.get('start')), end_date_exclusive: String(values.get('end')) }
      mutation.mutate({ input, idempotencyKey: intentKey(input) }, { onSuccess: (result) => onCreated(result.id) })
    }}>
      <label>Zone enregistrée (UUID)<input name="area" required pattern={uuidPattern} /></label>
      <label>Premier jour UTC<input name="start" type="date" required /></label>
      <label>Fin exclusive UTC<input name="end" type="date" required /></label>
      <button className="button button-primary" disabled={mutation.isPending}>Créer l’analyse</button>
    </form><ApiErrorMessage error={mutation.error} />
    <p>La zone doit avoir été créée au préalable. La période est [début, fin exclusive[ ; la dernière date n’est pas incluse.</p>
  </details>
}
function AnalysisResults({ id }: { id: string }) {
  const analysis = useAnalysis(id)
  const [tab, setTab] = useState<keyof typeof panels>('summary')
  const Panel = panels[tab].component
  return <div className="api-stack">
    {analysis.isPending && <p role="status">Chargement de l’analyse…</p>}<ApiErrorMessage error={analysis.error} />
    {analysis.data && <>
      <section className="panel api-section"><Facts values={{ Analyse: id, État: analysis.data.status, 'Version satellite': analysis.data.release_id, 'Premier jour': analysis.data.start_date, 'Fin exclusive': analysis.data.end_date_exclusive }} /></section>
      {['queued', 'running'].includes(analysis.data.status) ? <p role="status">Analyse en attente de traitement. Le worker doit être lancé pour exécuter sa tâche.</p> :
        analysis.data.status === 'failed' ? <p role="alert">Le traitement a échoué : {analysis.data.error_code}</p> : <>
          <nav className="api-tabs" aria-label="Résultats d’analyse">{Object.entries(panels).map(([name, panel]) =>
            <button type="button" className={name === tab ? 'button button-primary' : 'button button-secondary'} aria-pressed={name === tab} key={name} onClick={() => setTab(name as keyof typeof panels)}>{panel.label}</button>)}</nav>
          <Panel key={tab} id={id} />
        </>}
    </>}
  </div>
}

