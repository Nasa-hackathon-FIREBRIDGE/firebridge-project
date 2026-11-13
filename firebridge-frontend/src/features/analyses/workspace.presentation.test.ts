import { describe, expect, it } from 'vitest'
import { analysisFixture } from '../../services/test-fixtures'
import { activeLaunch, analysisPreparationStage, formatElapsed, requestDisabledReason, workflowSteps } from './workspace.presentation'

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
  it.each([
    ['queued', 'queued'],
    ['running', 'processing'],
    ['ready', null],
    ['failed', null],
    [undefined, null],
  ] as const)('bridges an accepted %s request until the analysis is first read', (accepted, stage) => {
    expect(analysisPreparationStage(false, undefined, false, accepted)).toBe(stage)
  })
  it('lets the analysis itself and refresh failures override the accepted response', () => {
    expect(analysisPreparationStage(false, { ...analysisFixture, status: 'ready', job: null }, false, 'queued')).toBeNull()
    expect(analysisPreparationStage(false, undefined, true, 'queued')).toBeNull()
    expect(analysisPreparationStage(true, undefined, false, undefined)).toBe('submitting')
  })
  it('follows an accepted request across the router transition and drops it once the user moves on', () => {
    const launch = { id: 'new', status: 'queued' as const, areaId: 'area', from: 'old', landed: false }
    expect(activeLaunch(launch, 'old')).toBe(launch)
    expect(activeLaunch(launch, 'new')).toBe(launch)
    expect(activeLaunch(launch, 'other')).toBeUndefined()
    expect(activeLaunch({ ...launch, landed: true }, 'old')).toBeUndefined()
    const fromAreaOnly = { ...launch, from: undefined }
    expect(activeLaunch(fromAreaOnly, undefined)).toBe(fromAreaOnly)
    expect(activeLaunch(null, 'new')).toBeUndefined()
  })
  it.each([[0, '0:00'], [-5000, '0:00'], [42_900, '0:42'], [605_000, '10:05'], [3_725_000, '1:02:05']])('formats %i ms of elapsed time as %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text)
  })
})
