import type { AnalysisView } from '@firebridge/contracts'
import type { Step } from '../../components/ui/Stepper'
import { validDateRange } from './validation'

export type WorkflowPresentation = { start: string; end: string; pending: boolean }

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
