import { useId, useRef, useState } from 'react'
import { ApiClientError } from '../lib/axios'
import { FeedbackMessage } from '../components/FeedbackMessage'
import { useAnalysis, useCreateAnalysis } from '../hooks/useFirebridge'
import { useIntentKey } from '../hooks/useIntentKey'
import { ApiErrorMessage, Facts } from '../components/api/ApiPrimitives'
import { uuidPattern } from '../components/api/format'
import {
  CalendarPanel,
  DetectionsPanel,
  ProvenancePanel,
  SummaryPanel,
} from '../components/api/NativePanels'
import {
  CellPanel,
  ComparisonPanel,
  CoveragePanel,
  ReportsPanel,
  WeatherPanel,
} from '../components/api/ContextPanels'
import { ExplanationRequestPanel } from '../components/api/ExplanationRequestPanel'
import { validDateRange } from '../features/analyses/validation'
import { UserInputError } from '../lib/userFeedback'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Database } from 'lucide-react'
import { PageHeader } from '../components/workspace/PageHeader'

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
type ResultTab = keyof typeof panels
const resultTabs = Object.keys(panels) as ResultTab[]
export default function ApiAnalysisPage() {
  const [params, setParams] = useSearchParams()
  const id = params.get('analysis') ?? ''
  const setId = (value: string) => setParams({ analysis: value })
  return (
    <div className="page-content api-workspace platform-results-page">
      <PageHeader eyebrow="RESEARCH / STRUCTURED RESULTS" title="Results explorer" description="Inspect saved observations, prepared scientific results and source metadata. Test datasets retain their synthetic labels." action={id ? <Link className="button button-secondary" to={`/analyses?analysis=${encodeURIComponent(id)}`}>Open map workspace<ArrowUpRight size={14} /></Link> : undefined} />
      <section className="panel api-section platform-analysis-loader">
        <h2>Choisir une analyse enregistrée</h2>
        <form
          className="api-form"
          onSubmit={(e) => {
            e.preventDefault()
            setId(String(new FormData(e.currentTarget).get('analysis')).trim())
          }}
        >
          <label>
            Identifiant d’analyse
            <input name="analysis" required pattern={uuidPattern} placeholder="UUID de l’analyse" />
          </label>
          <button className="button button-primary">Ouvrir l’analyse</button>
        </form>
        <CreateAnalysis onCreated={setId} />
      </section>
      {id ? (
        <AnalysisResults key={id} id={id} />
      ) : (
        <div className="platform-empty-register"><Database size={30} /><h2>Open a saved analysis</h2><p>Ouvrir une analyse existante ou en créer une sur une zone déjà enregistrée.</p><small>Records, calendar, coverage and context are loaded only as you open their tabs.</small></div>
      )}
    </div>
  )
}
function CreateAnalysis({ onCreated }: { onCreated: (id: string) => void }) {
  const mutation = useCreateAnalysis()
  const intentKey = useIntentKey()
  const submitting = useRef(false)
  const endInput = useRef<HTMLInputElement>(null)
  const [formError, setFormError] = useState<UserInputError | null>(null)
  const dateErrorId = useId()
  return (
    <details>
      <summary>Créer une analyse native sur une zone existante</summary>
      <form
        className="api-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (submitting.current) return
          setFormError(null)
          const values = new FormData(e.currentTarget)
          const input = {
            area_id: String(values.get('area')).trim(),
            start_date: String(values.get('start')),
            end_date_exclusive: String(values.get('end')),
          }
          if (!validDateRange(input.start_date, input.end_date_exclusive)) {
            setFormError(
              new UserInputError(
                'Choisissez une fin exclusive strictement après le premier jour UTC.',
                'end',
              ),
            )
            endInput.current?.focus()
            return
          }
          submitting.current = true
          mutation.mutate(
            { input, idempotencyKey: intentKey(input) },
            {
              onSuccess: (result) => onCreated(result.id),
              onSettled: () => {
                submitting.current = false
              },
            },
          )
        }}
      >
        <label>
          Zone enregistrée (UUID)
          <input name="area" required pattern={uuidPattern} />
        </label>
        <label>
          Premier jour UTC
          <input name="start" type="date" required onChange={() => setFormError(null)} />
        </label>
        <label>
          Fin exclusive UTC
          <input
            ref={endInput}
            name="end"
            type="date"
            required
            aria-label="Fin exclusive UTC"
            aria-invalid={!!formError}
            aria-describedby={formError ? dateErrorId : undefined}
            onChange={() => setFormError(null)}
          />
          {formError && (
            <span id={dateErrorId} className="fb-field-error">
              La date de fin est exclue. Elle doit être après le premier jour UTC.
            </span>
          )}
        </label>
        <button
          className="button button-primary"
          disabled={mutation.isPending}
          aria-busy={mutation.isPending}
        >
          Créer l’analyse
        </button>
      </form>
      <ApiErrorMessage operation="write" error={formError} />
      <ApiErrorMessage operation="write" error={mutation.error} />
      <p>
        La zone doit avoir été créée au préalable. La période est [début, fin exclusive[ ; la
        dernière date n’est pas incluse.
      </p>
    </details>
  )
}
function AnalysisResults({ id }: { id: string }) {
  const analysis = useAnalysis(id)
  const [tab, setTab] = useState<ResultTab>('summary')
  const [visited, setVisited] = useState<ResultTab[]>(['summary'])
  const tabsId = useId()
  function selectTab(value: ResultTab) {
    setVisited((current) => (current.includes(value) ? current : [...current, value]))
    setTab(value)
  }
  return (
    <div className="api-stack">
      {analysis.isPending && <p role="status">Chargement de l’analyse…</p>}
      <ApiErrorMessage error={analysis.error} />
      {analysis.data && (
        <>
          <section className="panel api-section">
            <Facts
              values={{
                Analyse: id,
                État: analysis.data.status,
                'Version satellite': analysis.data.release_id,
                'Premier jour': analysis.data.start_date,
                'Fin exclusive': analysis.data.end_date_exclusive,
              }}
            />
          </section>
          {['queued', 'running'].includes(analysis.data.status) ? (
            <p role="status">
              Analyse en attente de traitement. Le worker doit être lancé pour exécuter sa tâche.
            </p>
          ) : analysis.data.status === 'failed' ? (
            <FeedbackMessage
              context="analysis"
              operation="write"
              error={new ApiClientError('', 'EXECUTION_FAILED')}
            />
          ) : (
            <>
              <div
                className="api-tabs"
                role="tablist"
                aria-label="Résultats d’analyse"
                onKeyDown={(event) => {
                  const index = resultTabs.indexOf(tab)
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % resultTabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + resultTabs.length - 1) % resultTabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? resultTabs.length - 1
                            : -1
                  if (next < 0) return
                  event.preventDefault()
                  const value = resultTabs[next]
                  selectTab(value)
                  document.getElementById(`${tabsId}-tab-${value}`)?.focus()
                }}
              >
                {resultTabs.map((name) => (
                  <button
                    type="button"
                    className={name === tab ? 'button button-primary' : 'button button-secondary'}
                    role="tab"
                    id={`${tabsId}-tab-${name}`}
                    aria-selected={name === tab}
                    aria-controls={`${tabsId}-panel-${name}`}
                    tabIndex={name === tab ? 0 : -1}
                    key={name}
                    onClick={() => selectTab(name)}
                  >
                    {panels[name].label}
                  </button>
                ))}
              </div>
              {resultTabs.map((name) => {
                const Panel = panels[name].component
                return (
                  <div
                    key={name}
                    className="api-stack"
                    role="tabpanel"
                    id={`${tabsId}-panel-${name}`}
                    aria-labelledby={`${tabsId}-tab-${name}`}
                    hidden={name !== tab}
                    tabIndex={0}
                  >
                    {visited.includes(name) && <Panel id={id} />}
                  </div>
                )
              })}
            </>
          )}
        </>
      )}
    </div>
  )
}
