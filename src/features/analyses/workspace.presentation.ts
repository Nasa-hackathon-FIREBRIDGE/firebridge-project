import type { AnalysisView } from '@firebridge/contracts'
import type { Step } from '../../components/ui/Stepper'
import { validDateRange } from './validation'
import { isRecord } from '../../lib/api.validation'

export type WorkflowPresentation = { start: string; end: string; pending: boolean }
export type PreparationStage = 'submitting' | 'queued' | 'resolving_data' | 'preparing_history' | 'retrying' | 'completed' | 'processing'

/** Uses only confirmed lifecycle state; decorative motion never represents scientific progress. */
export function analysisPreparationStage(submitting: boolean, analysis?: AnalysisView, refreshFailed = false): PreparationStage | null {
  if (submitting) return 'submitting'
  if (refreshFailed || !analysis) return null
  const activeJob = analysis.job && ['queued', 'running'].includes(analysis.job.status)
  if (analysis.job && !activeJob) return null
  if (!['queued', 'running'].includes(analysis.status) && !(analysis.status === 'partial' && activeJob)) return null
  const progress = analysis.job?.progress
  const stage = isRecord(progress) && typeof progress.stage === 'string' ? progress.stage : undefined
  if (stage && ['queued', 'resolving_data', 'preparing_history', 'retrying', 'completed'].includes(stage)) return stage as PreparationStage
  return analysis.job?.status === 'queued' || analysis.status === 'queued' ? 'queued' : 'processing'
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
