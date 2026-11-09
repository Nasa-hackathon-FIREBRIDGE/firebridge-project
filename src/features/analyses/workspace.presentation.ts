import type { AnalysisView } from '@firebridge/contracts'
import type { Step } from '../../components/ui/Stepper'
import { validDateRange } from './validation'
import { isRecord } from '../../lib/api.validation'

export type WorkflowPresentation = { start: string; end: string; pending: boolean }
export type AcceptedAnalysis = { id: string; status: AnalysisView['status']; areaId: string }
/** An accepted request plus the analysis that was selected when it was sent. */
export type AnalysisLaunch = AcceptedAnalysis & { from?: string; landed: boolean }

/**
 * The accepted request the workspace should describe for the selected analysis, if any. Router updates run
 * as transitions, so the URL can still show the previous selection (`from`) for a few frames after the
 * request is accepted; any other selection means the user has moved on.
 */
export function activeLaunch(launch: AnalysisLaunch | null, analysisId: string | undefined) {
  if (!launch) return undefined
  if (analysisId === launch.id) return launch
  return !launch.landed && analysisId === launch.from ? launch : undefined
}
export type PreparationStage = 'submitting' | 'queued' | 'resolving_data' | 'preparing_history' | 'retrying' | 'completed' | 'processing'

/**
 * Uses only confirmed lifecycle state; decorative motion never represents scientific progress.
 * `acceptedStatus` is the creation response for the selected analysis: it bridges the gap between the
 * accepted request and the first read of that analysis so the preparation view does not flicker away.
 */
export function analysisPreparationStage(submitting: boolean, analysis?: AnalysisView, refreshFailed = false, acceptedStatus?: AnalysisView['status']): PreparationStage | null {
  if (submitting) return 'submitting'
  if (refreshFailed) return null
  if (!analysis) return acceptedStatus === 'queued' ? 'queued' : acceptedStatus === 'running' ? 'processing' : null
  const activeJob = analysis.job && ['queued', 'running'].includes(analysis.job.status)
  if (analysis.job && !activeJob) return null
  if (!['queued', 'running'].includes(analysis.status) && !(analysis.status === 'partial' && activeJob)) return null
  const progress = analysis.job?.progress
  const stage = isRecord(progress) && typeof progress.stage === 'string' ? progress.stage : undefined
  if (stage && ['queued', 'resolving_data', 'preparing_history', 'retrying', 'completed'].includes(stage)) return stage as PreparationStage
  return analysis.job?.status === 'queued' || analysis.status === 'queued' ? 'queued' : 'processing'
}

/** Wall-clock time since the request, e.g. 0:42 or 1:02:05. */
export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function requestDisabledReason(areaReady: boolean, state: WorkflowPresentation) {
  if (!areaReady) return 'Save or open an area first'
  if (state.pending) return 'An analysis request is being submitted'
  if (!state.start || !state.end) return 'Select a start and end date'
  if (!validDateRange(state.start, state.end)) return 'The exclusive end must be after a valid start date'
  return undefined
}

export function workflowSteps(areaReady: boolean, state: WorkflowPresentation, analysis?: AnalysisView): Step[] {
  const current = analysis ? ['queued', 'running'].includes(analysis.status) ? 2 : 3
    : !areaReady ? 0 : validDateRange(state.start, state.end) ? 2 : 1
  return ['Define area', 'Set interval', 'Run analysis', 'Review'].map((label, index) => ({
    id: ['area', 'interval', 'run', 'review'][index], label,
    state: index < current ? 'complete' : index === current ? 'current' : 'upcoming',
  }))
}
