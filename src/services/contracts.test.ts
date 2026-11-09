import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import api from '../lib/axios'
import { health } from './health.service'
import { areas } from './areas.service'
import { analyses } from './analyses.service'
import { jobs } from './jobs.service'
import { workspace } from './workspace.service'
import {
  acceptedFixture,
  analysisFixture,
  areaFixture,
  envelope,
  jobFixture,
  readyFixture,
} from './test-fixtures'

const original = api.defaults.adapter
afterEach(() => {
  api.defaults.adapter = original
  vi.restoreAllMocks()
})
function respond(data: unknown, status = 200, headers = {}) {
  api.defaults.adapter = async (config) => ({
    config,
    status,
    statusText: 'OK',
    headers,
    data: envelope(data),
  })
}
function fail(config: InternalAxiosRequestConfig, status: number, data: unknown): never {
  throw new AxiosError('HTTP error', 'ERR_BAD_RESPONSE', config, undefined, {
    config,
    status,
    statusText: 'Error',
    headers: { 'x-request-id': 'request' },
    data,
  })
}

describe('Ten public endpoint contracts (isolated HTTP adapter)', () => {
  it('validates liveness independently from a 503 readiness payload', async () => {
    api.defaults.adapter = async (config) =>
      config.url === '/health/ready'
        ? fail(config, 503, envelope(readyFixture))
        : {
            config,
            status: 200,
            statusText: 'OK',
            headers: {},
            data: envelope({ status: 'ok', service: 'api', uptimeMs: 0, timestamp: 'now' }),
          }
    expect((await health.getHealthLive()).status).toBe('ok')
    expect(await health.getHealthReady()).toEqual(readyFixture)
  })
  it('rejects invalid readiness responses and propagates connection failures', async () => {
    api.defaults.adapter = async (config) => fail(config, 503, envelope({}))
    await expect(health.getHealthReady()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    api.defaults.adapter = async (config) => {
      throw new AxiosError('offline', 'ERR_NETWORK', config)
    }
    await expect(health.getHealthLive()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
  it('rejects readiness 503 with a malformed envelope or a success status', async () => {
    api.defaults.adapter = async (config) => fail(config, 503, { data: readyFixture })
    await expect(health.getHealthReady()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    api.defaults.adapter = async (config) =>
      fail(config, 503, envelope({ ...readyFixture, status: 'ok' }))
    await expect(health.getHealthReady()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it.each([201, 200])('retains area creation/reuse outcome for HTTP %s', async (status) => {
    respond(areaFixture, status)
    const input = {
      ...areaFixture,
      geometry: areaFixture.geometry as { type: 'Polygon'; coordinates: number[][][] },
    }
    expect((await areas.create(input)).created).toBe(status === 201)
    expect((await areas.get('a')).coverage?.weights_status).toBe('not_prepared')
  })
  it.each([400, 404, 409, 422, 503])(
    'retains HTTP %s, error code and request ID',
    async (status) => {
      api.defaults.adapter = async (config) =>
        fail(config, status, { ...envelope(null), code: 'TEST_ERROR', message: 'Rejected' })
      await expect(areas.get('a')).rejects.toMatchObject({
        status,
        code: 'TEST_ERROR',
        requestId: 'test-request',
      })
    },
  )
  it('sends the exact defaults and preserves an intent key across duplicate submissions', async () => {
    const requests: { body: unknown; key: unknown }[] = []
    api.defaults.adapter = async (config) => {
      requests.push({ body: JSON.parse(config.data), key: config.headers.get('Idempotency-Key') })
      return {
        config,
        status: 202,
        statusText: 'Accepted',
        headers: {},
        data: envelope(acceptedFixture),
      }
    }
    const request = {
      input: { area_id: 'a', start_date: '2024-01-01', end_date_exclusive: '2024-01-02' },
      idempotencyKey: 'same-intent',
    }
    expect(await analyses.create(request)).toEqual(await analyses.create(request))
    expect(requests[0]).toEqual(requests[1])
    expect(requests[0].body).toEqual({
      ...request.input,
      metric_key: 'native_detections_v1',
      grid_id: null,
      data_mode: 'standard_only',
    })
  })
  it('preserves partial components and rejects malformed successful payloads', async () => {
    respond({ ...analysisFixture, status: 'partial' })
    const result = await analyses.get('analysis')
    expect(result.status).toBe('partial')
    expect(result.components[1].status).toBe('missing')
    respond({ ...analysisFixture, components: null })
    await expect(analyses.get('analysis')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    respond(null)
    await expect(areas.get('a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('reads prepared scientific analyses without relaxing native-only creation', async () => {
    const prepared = { ...analysisFixture, metric_key: 'source_response_fixture', grid_id: 'phase6_fixture' }
    respond(prepared)
    expect(await analyses.get('prepared')).toMatchObject({ metric_key: prepared.metric_key, grid_id: prepared.grid_id })
    respond({ analyses: [analysisFixture, prepared], nextCursor: null })
    expect((await workspace.analyses('')).items).toHaveLength(2)
    respond({ ...acceptedFixture, metric_key: prepared.metric_key, grid_id: prepared.grid_id })
    await expect(analyses.create({ input: { area_id: 'a', start_date: '2024-01-01', end_date_exclusive: '2024-01-02' }, idempotencyKey: 'native-only' }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    respond({ ...prepared, grid_id: 42 })
    await expect(analyses.get('prepared')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('accepts zero-byte tiles, requests binary MVT and rejects unsupported coordinates/layers', async () => {
    let calls = 0
    api.defaults.adapter = async (config) => {
      calls++
      expect(config.responseType).toBe('arraybuffer')
      expect(config.url).toContain('/tiles/detections/0/0/0.mvt')
      return { config, status: 200, statusText: 'OK', headers: {}, data: new ArrayBuffer(0) }
    }
    const tile = { id: 'analysis', layer: 'detections', z: 0, x: 0, y: 0 } as const
    expect((await analyses.tile(tile)).byteLength).toBe(0)
    await expect(analyses.tile({ ...tile, x: 1 })).rejects.toMatchObject({ status: 400 })
    await expect(analyses.tile({ ...tile, layer: 'unsupported' as never })).rejects.toMatchObject({
      status: 400,
    })
    expect(calls).toBe(1)
  })
  it.each(['csv', 'geojson', 'parquet'] as const)(
    'queues %s through the API with idempotency',
    async (format) => {
      api.defaults.adapter = async (config) => {
        expect(config.url).toBe('/analyses/analysis/exports')
        expect(config.headers.get('Idempotency-Key')).toBe('export-intent')
        expect(JSON.parse(config.data)).toEqual({ format })
        return {
          config,
          status: 202,
          statusText: 'Accepted',
          headers: {},
          data: envelope({
            job_id: 'job',
            analysis_id: 'analysis',
            status: 'queued',
            format,
            status_url: '/api/v1/jobs/job',
            created_at: 'now',
          }),
        }
      }
      expect(
        (
          await analyses.createExport({
            analysisId: 'analysis',
            input: { format },
            idempotencyKey: 'export-intent',
          })
        ).status,
      ).toBe('queued')
    },
  )
  it('rejects unsupported export formats before HTTP', async () => {
    const adapter = vi.fn()
    api.defaults.adapter = adapter
    await expect(
      analyses.createExport({
        analysisId: 'analysis',
        input: { format: 'pdf' as never },
        idempotencyKey: 'x',
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(adapter).not.toHaveBeenCalled()
  })
  it.each(['queued', 'running', 'failed', 'partial', 'cancelled'] as const)(
    'does not download a %s export even with an unexpected URL',
    async (status) => {
      respond({ ...jobFixture, status, download_url: '/api/v1/jobs/job/download?signature=secret' })
      await expect(jobs.download('job')).rejects.toMatchObject({ status: 409 })
    },
  )
  it('rejects expired exports and untrusted URLs', async () => {
    respond({ ...jobFixture, status: 'succeeded', expires_at: '2000-01-01T00:00:00Z' })
    await expect(jobs.download('job')).rejects.toMatchObject({ status: 410 })
    respond({
      ...jobFixture,
      status: 'succeeded',
      download_url: 'https://evil.invalid/api/v1/jobs/job/download',
    })
    await expect(jobs.download('job')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('rejects malformed export expiration instead of starting an invalid expiry timer', async () => {
    respond({ ...jobFixture, expires_at: 'not-a-date' })
    await expect(jobs.get('job')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('downloads bytes via the same-origin signed path without exposing the URL', async () => {
    api.defaults.adapter = async (config) => {
      if (config.url === '/jobs/job')
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: envelope({
            ...jobFixture,
            status: 'succeeded',
            download_url: '/api/v1/jobs/job/download?expires=123&signature=secret',
          }),
        }
      expect(config.url).toBe('/jobs/job/download?expires=123&signature=secret')
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: { 'content-disposition': 'attachment; filename="export.csv"' },
        data: new Blob(['a,b']),
      }
    }
    const download = await jobs.download('job')
    expect(download.filename).toBe('export.csv')
    expect(await download.blob.text()).toBe('a,b')
    expect(download).not.toHaveProperty('url')
  })
  it.each([409, 410])(
    'propagates a download race with HTTP %s and binary JSON errors',
    async (status) => {
      api.defaults.adapter = async (config) =>
        config.url === '/jobs/job'
          ? {
              config,
              status: 200,
              statusText: 'OK',
              headers: {},
              data: envelope({
                ...jobFixture,
                status: 'succeeded',
                download_url: '/api/v1/jobs/job/download?signature=secret',
              }),
            }
          : fail(
              config,
              status,
              new Blob(
                [
                  JSON.stringify({
                    code: status === 410 ? 'EXPORT_GONE' : 'CONFLICT',
                    message: 'Unavailable',
                  }),
                ],
                { type: 'application/json' },
              ),
            )
      await expect(jobs.download('job')).rejects.toMatchObject({ status })
    },
  )
})
