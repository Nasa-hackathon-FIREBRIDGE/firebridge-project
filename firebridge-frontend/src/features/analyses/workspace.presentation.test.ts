import { describe, expect, it } from 'vitest'
import { analysisFixture } from '../../services/test-fixtures'
import { requestDisabledReason, workflowSteps } from './workspace.presentation'

const empty = { start: '', end: '', pending: false }
const valid = { start: '2024-07-15', end: '2024-07-18', pending: false }
describe('Presentational workflow state', () => {
  it.each([
    [false, empty, 'Save or open an area first'],
    [true, empty, 'Select a start and end date'],
    [true, { ...valid, start: '' }, 'Select a start and end date'],
    [true, { ...valid, end: '' }, 'Select a start and end date'],
    [true, { ...valid, end: '2024-07-15' }, 'The exclusive end must be after a valid start date'],
    [true, { ...valid, start: '2024-02-30' }, 'The exclusive end must be after a valid start date'],
    [true, { ...valid, pending: true }, 'An analysis request is being submitted'],
    [true, valid, undefined],
  ] as const)('explains the existing guards, areaReady=%s state=%j', (areaReady, state, reason) => {
    expect(requestDisabledReason(areaReady, state)).toBe(reason)
  })
  it.each([[false, empty, 'Define area'], [true, empty, 'Set interval'], [true, { ...valid, end: '' }, 'Set interval'], [true, valid, 'Run analysis']] as const)('derives a current step from saved area and actual dates', (ready, state, current) => {
    expect(workflowSteps(ready, state).filter(step => step.state === 'current').map(step => step.label)).toEqual([current])
  })
  it.each(['queued', 'running', 'ready', 'partial', 'failed', 'unsupported'] as const)('reports selected %s analyses without inventing successful components', status => {
    const steps = workflowSteps(true, empty, { ...analysisFixture, status })
    expect(steps.find(step => step.state === 'current')?.label).toBe(['queued', 'running'].includes(status) ? 'Run analysis' : 'Review')
  })
})
