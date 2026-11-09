import { useId, useState } from 'react'
import { CellPanel, ComparisonPanel, CoveragePanel, ReportsPanel, WeatherPanel } from '../../components/api/ContextPanels'

const sections = {
  coverage: { label: 'Couverture', component: CoveragePanel },
  cell: { label: 'Cellule', component: CellPanel },
  comparison: { label: 'Comparaison', component: ComparisonPanel },
  weather: { label: 'Météo', component: WeatherPanel },
  reports: { label: 'Rapports', component: ReportsPanel },
}
type Section = keyof typeof sections
const names = Object.keys(sections) as Section[]

export function ContextDetails({ analysisId }: { analysisId: string }) {
  const id = useId()
  const [selected, setSelected] = useState<Section | null>(null)
  const [visited, setVisited] = useState<Section[]>([])
  function open(name: Section) {
    setSelected(name)
    setVisited((current) => current.includes(name) ? current : [...current, name])
  }

  return (
    <section className="api-stack" aria-label="Détails du contexte d’analyse">
      <div>
        <h3>Explorer les données de contexte</h3>
        <p>Chaque rubrique utilise les versions enregistrées avec cette analyse. Les données absentes restent indiquées comme manquantes.</p>
      </div>
      <div className="api-tabs" role="tablist" aria-label="Rubriques du contexte">
        {names.map((name) => (
          <button
            key={name} type="button" role="tab"
            className={selected === name ? 'button button-primary' : 'button button-secondary'}
            id={`${id}-tab-${name}`} aria-controls={`${id}-panel-${name}`}
            aria-selected={selected === name}
            tabIndex={selected === null ? name === names[0] ? 0 : -1 : selected === name ? 0 : -1}
            onClick={() => open(name)}
            onKeyDown={(event) => {
              const index = names.indexOf(name)
              const next = event.key === 'ArrowRight' ? (index + 1) % names.length
                : event.key === 'ArrowLeft' ? (index + names.length - 1) % names.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1
              if (next < 0) return
              event.preventDefault()
              open(names[next])
              document.getElementById(`${id}-tab-${names[next]}`)?.focus()
            }}
          >{sections[name].label}</button>
        ))}
      </div>
      {selected === null && <p>Choisir une rubrique pour charger ses détails.</p>}
      {names.map((name) => {
        const Panel = sections[name].component
        return (
          <div key={name} id={`${id}-panel-${name}`} role="tabpanel"
            aria-labelledby={`${id}-tab-${name}`} hidden={selected !== name} tabIndex={0}>
            {visited.includes(name) && <Panel id={analysisId} />}
          </div>
        )
      })}
    </section>
  )
}
