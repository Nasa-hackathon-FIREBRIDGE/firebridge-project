import { Link, useSearchParams } from 'react-router-dom'
import { useAnalysis } from '../hooks/useFirebridge'
import { useAllWorkspaceAnalyses } from '../hooks/useAllWorkspaceAnalyses'
import { Banner } from '../components/ui/Banner'
import { PageHeader } from '../components/workspace/PageHeader'
import { ApiError } from '../features/analyses/Feedback'
import { ObservationLab } from '../features/visualization/ObservationLab'
import '../features/visualization/visualization.css'

export default function VisualizationPage() {
  const [params, setParams] = useSearchParams()
  const id = params.get('analysis') || undefined
  const analyses = useAllWorkspaceAnalyses()
  const analysis = useAnalysis(id)
  const choices = analyses.data?.filter((a) => a.metric_key === 'native_detections_v1' && ['ready', 'partial'].includes(a.status)) ?? []
  return <div className="platform-page viz-page">
    <PageHeader eyebrow="RESEARCH / VISUAL ANALYTICS LAB" title="Beyond the overview." description="Explore the shape, concentration and variability of the satellite record. Seven complementary lenses, one shared observation window." action={<span className="viz-live-badge"><i /> Published observations</span>} />
    <section className="card viz-card lab-analysis-picker">
      <label className="api-field">Saved analysis
        <select aria-label="Saved analysis for visualization" disabled={analyses.isPending} aria-busy={analyses.isFetching} value={id ?? ''} onChange={(e) => setParams(e.target.value ? { analysis: e.target.value } : {})}>
          <option value="">Choose an analysis</option>
          {id && !choices.some((a) => a.id === id) && <option value={id}>{id}</option>}
          {choices.map((a) => <option key={a.id} value={a.id}>{a.start_date} → {a.end_date_exclusive} (end excluded) · {a.id.slice(0, 8)}</option>)}
        </select>
      </label>
      <ApiError error={analyses.error} retry={() => { void analyses.refetch() }} />
      {analyses.isFetching && <p role="status">Loading saved analyses…</p>}
      <p>Work from a saved study, or <Link to="/analyses">choose another area and create an analysis</Link>.</p>
    </section>
    <ApiError error={analysis.error} retry={() => { void analysis.refetch() }} />
    {id && analysis.isPending && <p role="status">Loading the saved analysis…</p>}
    {analysis.data && (analysis.data.metric_key === 'native_detections_v1'
      ? <ObservationLab key={analysis.data.id} analysis={analysis.data} />
      : <Banner>This lab explores native detections. Choose a native analysis, or <Link to={`/api-analysis?analysis=${encodeURIComponent(analysis.data.id)}`}>inspect this analysis and its prepared results</Link>.</Banner>)}
    {!id && <Banner>Select an analysis to load its charts. No data is downloaded or invented by this page.</Banner>}
  </div>
}
