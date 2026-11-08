import { afterEach, describe, expect, it } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import api from '../lib/axios'
import { envelope } from './test-fixtures'
import { resultFixtures as fixtures } from './results.test-fixtures'
import { results } from './results.service'
const original = api.defaults.adapter
let requests: InternalAxiosRequestConfig[] = []
afterEach(() => {
  api.defaults.adapter = original
  requests = []
})
function respond(data: unknown) {
  api.defaults.adapter = async (config) => {
    requests.push(config)
    return { config, status: 200, statusText: 'OK', headers: {}, data: envelope(data) }
  }
}
describe('public results service with isolated responses', () => {
  it.each([
    ['catalogue', () => results.catalogue(), fixtures.catalogue],
    ['release', () => results.release('release'), fixtures.release],
    ['summary', () => results.summary('analysis'), fixtures.summary],
    ['detections', () => results.detections('analysis', undefined, undefined), fixtures.detections],
    ['calendar', () => results.calendar('analysis'), fixtures.calendar],
    ['provenance', () => results.provenance('analysis'), fixtures.provenance],
    ['explanation', () => results.explanation('note'), fixtures.explanation],
  ] as const)('validates the %s response', async (_, read, data) => {
    respond(data)
    expect(await read()).toEqual(data)
  })
  it('passes signed cursors, source filter and cancellation without changing their meaning', async () => {
    respond(fixtures.detections)
    const signal = new AbortController().signal
    await results.detections('a/b', 'source/a', 'signed+cursor/=', signal)
    expect(requests[0].url).toBe('/analyses/a%2Fb/detections')
    expect(requests[0].params).toEqual({
      limit: 20,
      source_ids: 'source/a',
      cursor: 'signed+cursor/=',
    })
    expect(requests[0].signal).toBe(signal)
    expect(requests[0].headers.has('Authorization')).toBe(false)
  })
  it.each(['coordinate', 'timestamp', 'frp', 'row count'] as const)(
    'rejects malformed detection %s',
    async (kind) => {
      const data = structuredClone(fixtures.detections)
      if (kind === 'coordinate') data.features[0]!.geometry.coordinates = [181, 35]
      if (kind === 'timestamp') data.features[0]!.properties.acquired_at = 'not-a-date'
      if (kind === 'frp') Object.assign(data.features[0]!.properties, { frp_mw: -1 })
      if (kind === 'row count') data.returned = 2
      respond(data)
      await expect(results.detections('analysis', undefined, undefined)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      })
    },
  )
  it('sends UTC start and exclusive end together with the signed cursor and source', async () => {
    respond(fixtures.detections)
    await results.detections('analysis', 'source', 'signed-page', undefined, { start: '2024-07-15T00:00:00Z', end_exclusive: '2024-07-16T00:00:00Z' })
    expect(requests[0].params).toEqual({ limit: 20, source_ids: 'source', cursor: 'signed-page', start: '2024-07-15T00:00:00Z', end_exclusive: '2024-07-16T00:00:00Z' })
  })
  it('rejects non-integral source counts before they can reach BigInt rendering', async () => {
    const data = structuredClone(fixtures.summary)
    data.native_detections_by_source[0]!.count = '12.3'
    respond(data)
    await expect(results.summary('analysis')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('accepts the backend’s explicit unknown counts without converting them to zeros', async () => {
    const data = { ...fixtures.summary, native_detections_by_source: [{ ...fixtures.summary.native_detections_by_source[0], count: null, observed_count: '0', count_status: 'unknown' }] }
    respond(data)
    expect((await results.summary('analysis')).native_detections_by_source[0].count).toBeNull()
    respond({ ...data, native_detections_by_source: [{ ...data.native_detections_by_source[0], count_status: 'complete' }] })
    await expect(results.summary('analysis')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('rejects malformed source descriptors and context reasons', async () => {
    respond({ ...fixtures.catalogue, sources: [{ platform: { unsafe: 'value' } }] })
    await expect(results.catalogue()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    respond({ analysis_id: 'analysis', status: 'missing', reasons: 'missing' })
    await expect(results.context('analysis', 'weather')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
  it('keeps missing context distinct from a zero observation', async () => {
    const data = {
      analysis_id: 'analysis',
      status: 'missing',
      reasons: ['WEATHER_COMPONENT_MISSING'],
      series: [],
    }
    respond(data)
    expect(await results.context('analysis', 'weather')).toEqual(data)
  })
  it('preserves an explanation intent key and posts only the supported deterministic input', async () => {
    respond(fixtures.explanation)
    await results.createExplanation('analysis', 'stable-key')
    expect(requests[0].headers.get('Idempotency-Key')).toBe('stable-key')
    expect(JSON.parse(requests[0].data)).toEqual({ language: 'en', question: '' })
  })
})
