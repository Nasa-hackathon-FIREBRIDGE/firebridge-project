import { useCallback, useState } from 'react'
import { activeLaunch, type AcceptedAnalysis, type AnalysisLaunch } from './workspace.presentation'

/**
 * Remembers the latest accepted analysis request so the workspace can keep describing it (status, area)
 * while the router transition to its URL and its first read are still in flight.
 */
export function useAnalysisLaunch(analysisId: string | undefined) {
  const [launch, setLaunch] = useState<AnalysisLaunch | null>(null)
  // Derived during render, as React recommends: once the URL shows the new analysis it has "landed".
  if (launch && !launch.landed && analysisId === launch.id) setLaunch({ ...launch, landed: true })
  const accept = useCallback((accepted: AcceptedAnalysis) => setLaunch({ ...accepted, from: analysisId, landed: false }), [analysisId])
  const accepted = activeLaunch(launch, analysisId)
  return { accepted, awaitingRoute: !!accepted && accepted.id !== analysisId, accept }
}
