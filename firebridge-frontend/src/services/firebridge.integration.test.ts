/// <reference types="node" />
import { beforeAll, describe, expect, it } from 'vitest'
import api, { ApiClientError } from '../lib/axios'
import { health } from './health.service'
import { areas } from './areas.service'
import { analyses, createIdempotencyKey } from './analyses.service'
import { jobs } from './jobs.service'
import type { CreateAreaRequest } from '@firebridge/contracts'

// Started by the guarded backend runner; never points at the developer's API/database.
const url = process.env.FIREBRIDGE_INTEGRATION_URL
describe.skipIf(!url)('Real public API → PostgreSQL/PostGIS → Redis → separate Worker → Axios', () => {
  let areaId: string
  let analysisId: string
  const polygon: CreateAreaRequest = { name: 'TEST ONLY HTTP area', version: createIdempotencyKey(), provenance: 'isolated-integration-test', display_timezone: 'Africa/Casablanca', geometry: { type: 'Polygon', coordinates: [[[-8, 30], [-7, 30], [-7, 31], [-8, 31], [-8, 30]]] } }
  beforeAll(() => { if (!/^http:\/\/127\.0\.0\.1:3301\/api\/v1$/.test(url!)) throw new Error('Only the isolated runner is supported.'); api.defaults.baseURL = url; api.defaults.adapter = 'fetch' })
  it('reads both health endpoints through the HTTP client', async () => {
    expect((await health.getHealthLive()).status).toBe('ok')
    expect((await health.getHealthReady()).checks.database).toBe('ready')
  })
  it('creates and reuses a zone, and reads its real PostGIS surface and coverage', async () => {
    const created = await api.post('/areas', polygon)
    expect(created.status).toBe(201); areaId = created.data.data.id
    expect((await areas.create(polygon)).id).toBe(areaId)
    const area = await areas.get(areaId)
    expect(area.surface_km2).toBeGreaterThan(0); expect(area.coverage?.weights_status).toBe('not_prepared')
  })
  it('submits concurrent idempotent analyses and observes the separate worker reaching partial', async () => {
    const request = { input: { area_id: areaId, start_date: '2024-01-17', end_date_exclusive: '2024-01-20' }, idempotencyKey: createIdempotencyKey() }
    const accepted = await Promise.all([analyses.create(request), analyses.create(request)])
    expect(accepted[0].id).toBe(accepted[1].id); analysisId = accepted[0].id
    expect(accepted[0].metric_key).toBe('native_detections_v1'); expect(accepted[0].grid_id).toBeNull(); expect(accepted[0].data_mode).toBe('standard_only')
    const deadline = Date.now() + 20000
    while (true) {
      const job = await jobs.get(accepted[0].job_id!)
      if (!['queued', 'running'].includes(job.status)) { expect(job.status).toBe('partial'); break }
      if (Date.now() > deadline) throw new Error('Separate worker did not complete the analysis.')
      await new Promise((done) => setTimeout(done, 200))
    }
    expect((await analyses.get(analysisId)).status).toBe('partial')
    await expect(analyses.create({ ...request, input: { ...request.input, end_date_exclusive: '2024-01-19' } })).rejects.toMatchObject({ status: 409 })
  }, 30000)
  it('reads a real nonempty MVT and refuses an invalid XYZ coordinate', async () => {
    const tile = await analyses.tile({ id: analysisId, layer: 'detections', z: 0, x: 0, y: 0 })
    expect(tile.byteLength).toBeGreaterThan(0)
    await expect(analyses.tile({ id: analysisId, layer: 'detections', z: 0, x: 1, y: 0 })).rejects.toMatchObject({ status: 400 })
  })
  it.each(['csv', 'geojson', 'parquet'] as const)('queues %s, waits for the worker and downloads its bytes through a signed public link', async (format) => {
    const request = { analysisId, input: { format }, idempotencyKey: createIdempotencyKey() }
    const accepted = await analyses.createExport(request)
    expect((await analyses.createExport(request)).job_id).toBe(accepted.job_id)
    const deadline = Date.now() + 20000
    while (true) {
      const job = await jobs.get(accepted.job_id)
      if (!['queued', 'running'].includes(job.status)) { expect(job.status).toBe('succeeded'); expect(job.download_url).toContain('signature='); break }
      if (Date.now() > deadline) throw new Error('Separate worker did not complete the export.')
      await new Promise((done) => setTimeout(done, 200))
    }
    const { blob, filename } = await jobs.download(accepted.job_id)
    expect(blob.size).toBeGreaterThan(0); expect(filename).toContain(accepted.job_id)
    if (format === 'geojson') expect(JSON.parse(await blob.text()).features).toHaveLength(3)
    if (format === 'csv') expect((await blob.text()).trim().split('\n')).toHaveLength(4)
    if (format === 'parquet') expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 4))).toBe('PAR1')
  }, 30000)
  it('propagates validation and missing-resource errors without any authentication header', async () => {
    expect(api.defaults.withCredentials).toBe(false)
    expect(api.defaults.headers.common.Authorization).toBeUndefined()
    await expect(areas.create({ ...polygon, geometry: { type: 'Polygon', coordinates: [] } })).rejects.toMatchObject({ status: 400 })
    await expect(analyses.get('00000000-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(ApiClientError)
  })
})
