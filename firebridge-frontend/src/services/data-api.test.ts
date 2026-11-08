import { afterEach, describe, expect, it } from 'vitest'
import { AxiosError, CanceledError, type AxiosRequestConfig } from 'axios'
import api from '../lib/axios'
import { releases } from './releases.service'
import { nativeResults } from './native-results.service'
import { context } from './context.service'
import { ingestion } from './ingestion.service'
import { explanations } from './explanations.service'
import type { BackfillInput, RefreshInput } from './data.types'

const original = api.defaults.adapter
afterEach(() => { api.defaults.adapter = original })
const backfill: BackfillInput = {
  feed_id: 'modis', area_id: 'area', scope_key: 'scope', start: '2024-01-17T00:00:00Z', end_exclusive: '2024-01-20T00:00:00Z',
  source_ids: ['terra'], products: ['MCD14ML'], collection: '6.1', resource_budget: { max_chunks: 3, max_bytes: 1000 },
}
const refresh: RefreshInput = { mode: 'repair', resource_budget: backfill.resource_budget }
describe('Phase 1/3/5/6 HTTP services', () => {
  it('uses the 19 additional canonical operations', async () => {
    const calls: AxiosRequestConfig[] = []
    const controller = new AbortController()
    api.defaults.adapter = async (config) => {
      calls.push(config)
      return { config, status: 200, statusText: 'OK', headers: {}, data: { schema_version: '1', request_id: 'r', warnings: [], data: {} } }
    }
    await releases.get('release', { membership: 'assets', limit: 1, cursor: 'signed' }, controller.signal)
    await releases.updates({ scope_key: 'scope', after_release_id: 'old' })
    await nativeResults.summary('analysis')
    await nativeResults.detections('analysis', { source_ids: 'terra,aqua', bbox: '-8,30,-7,31', limit: 1, cursor: 'signed' })
    await nativeResults.calendar('analysis', { resolution: 'month' })
    await nativeResults.provenance('analysis', { asset_id: 'asset', limit: 1 })
    await context.coverage('analysis', { cell_id: '9007199254740993' })
    await context.cell('analysis', '9007199254740993', { limit: 1 })
    await context.comparison('analysis', { view: 'common_response' })
    await context.weather('analysis', { context: 'recent', variables: 'temperature', resolution: 'day' })
    await context.reports('analysis', { relation: 'candidate', review_status: 'unreviewed' })
    await ingestion.availability('terra', { scope_key: 'scope' })
    await ingestion.subscriptions('test-secret', { enabled: 'false' })
    await ingestion.gaps('test-secret', { status: 'accepted_unavailable' })
    await ingestion.run('test-secret', 'run')
    await ingestion.backfill('test-secret', backfill, 'key-backfill')
    await ingestion.refresh('test-secret', 'sub', refresh, 'key-refresh')
    await explanations.create({ analysisId: 'analysis', input: { language: 'fr' }, idempotencyKey: 'key-explanation' })
    await explanations.get('explanation', controller.signal)
    expect(calls).toHaveLength(19)
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['get', '/releases/release'], ['get', '/updates'], ['get', '/analyses/analysis/summary'],
      ['get', '/analyses/analysis/detections'], ['get', '/analyses/analysis/calendar'], ['get', '/analyses/analysis/provenance'],
      ['get', '/analyses/analysis/coverage'], ['get', '/analyses/analysis/cells/9007199254740993'],
      ['get', '/analyses/analysis/comparison'], ['get', '/analyses/analysis/weather'], ['get', '/analyses/analysis/reports'],
      ['get', '/sources/terra/availability'], ['get', '/admin/ingestion/subscriptions'], ['get', '/admin/ingestion/gaps'],
      ['get', '/admin/ingestion/runs/run'], ['post', '/admin/ingestion/backfills'],
      ['post', '/admin/ingestion/subscriptions/sub/refresh'], ['post', '/analyses/analysis/explanations'],
      ['get', '/explanations/explanation'],
    ])
    expect(calls[0].signal).toBe(controller.signal)
    expect(calls[0].params).toEqual({ membership: 'assets', limit: 1, cursor: 'signed' })
    expect(calls[3].params.source_ids).toBe('terra,aqua')
    expect(calls[13].params.status).toBe('accepted_unavailable')
    for (const call of calls) {
      const headers = call.headers as Record<string, unknown>
      const admin = call.url!.startsWith('/admin/')
      expect(Boolean(headers.Authorization)).toBe(admin)
      expect(call.withCredentials).toBe(false)
    }
    expect(calls[15].headers!['Idempotency-Key']).toBe('key-backfill')
    expect(JSON.parse(calls[15].data)).toEqual(backfill)
    expect(calls[16].headers!['Idempotency-Key']).toBe('key-refresh')
    expect(calls[17].headers!['Idempotency-Key']).toBe('key-explanation')
    expect(api.defaults.headers.common.Authorization).toBeUndefined()
  })
  it('keeps scientific unknowns, long IDs, exact acquisition times and envelope warnings', async () => {
    const payload = { count: null, observed_count: '0', detection_id: '9007199254740993', acquired_at: '2024-01-17T00:00:00.000001Z' }
    api.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { schema_version: '1', request_id: 'r', warnings: ['PARTIAL'], data: payload } })
    const result = await nativeResults.detections('a')
    expect(result).toEqual({ data: payload, warnings: ['PARTIAL'], requestId: 'r' })
  })
  it('preserves cancellation and rejects malformed envelopes and authentication failures', async () => {
    api.defaults.adapter = async () => { throw new CanceledError() }
    await expect(context.coverage('a')).rejects.toBeInstanceOf(CanceledError)
    api.defaults.adapter = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { data: {} } })
    await expect(releases.get('r')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    api.defaults.adapter = async (config) => { throw new AxiosError('denied', 'ERR_BAD_REQUEST', config, undefined, { config, status: 401, statusText: 'Unauthorized', headers: {}, data: { message: 'Denied', code: 'UNAUTHORIZED', request_id: 'auth' } }) }
    await expect(ingestion.subscriptions('wrong')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED', requestId: 'auth' })
  })
})

