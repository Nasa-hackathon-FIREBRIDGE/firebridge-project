import { ArrowRight } from 'lucide-react'
import { useBridgeReport } from '../bridge/useBridgeReport'
import { EvidencePanel } from './Evidence'
import { heavyTailCheck, resolutionCheck, seasonCheck, timeOfDayCheck, trendCheck, weatherCheck } from './checks'
import { useWeatherEvidence } from './weather'

/** Overview ledger: does this analysis behave the way published fire science says it should? */
export function OverviewEvidence({ analysisId, onOpenCalendar }: { analysisId?: string; onOpenCalendar?: () => void }) {
  const state = useBridgeReport(analysisId)
  const report = state.status === 'ready' && state.report.evidence ? state.report : null
  const weather = useWeatherEvidence(report)
  // While the report loads, the verdict card above reports progress.
  if (!report) return null
  const checks = [seasonCheck(report), timeOfDayCheck(report), resolutionCheck(report), heavyTailCheck(report), trendCheck(report), weatherCheck(report, weather.evidence)].filter((c) => c !== null)
  return (
    <EvidencePanel
      id="overview-evidence"
      eyebrow="Does the result hold up?"
      title={`${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][checks.length] ?? checks.length} things fire science already knows, tested again on this analysis`}
      lede="Each finding asks this analysis’s own detections a question the literature has already answered. Agreement means the record behaves like real fire; disagreement is flagged, not hidden."
      checks={checks}
      action={
        onOpenCalendar && (
          <button type="button" className="ui-button ui-button--small" onClick={onOpenCalendar}>
            Month-by-month checks
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )
      }
    />
  )
}
