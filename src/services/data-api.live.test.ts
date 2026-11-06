/** Opt-in smoke against the existing, explicitly guarded local fixture database.
 * Run: $env:FIREBRIDGE_DATA_SMOKE='1'; npx.cmd vitest run src/services/data-api.live.test.ts
 * Creates planning/explanation requests only in firebridge_phase1_test; no provider fetch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import api from '../lib/axios'
import { catalog } from './catalog.service'
import { releases } from './releases.service'
import { nativeResults } from './native-results.service'
import { context } from './context.service'
import { ingestion } from './ingestion.service'
import { explanations } from './explanations.service'

const enabled = process.env.FIREBRIDGE_DATA_SMOKE === '1'
const suite = enabled ? describe : describe.skip
const native = 'a3000000-0000-4000-8000-000000000001'
const prepared = '60000000-0000-4000-8000-000000000100'
const release = '22222222-2222-4222-8222-222222222222'
const scope = 'phase1_test'
const originalAdapter = api.defaults.adapter
const originalURL = api.defaults.baseURL
let token = ''
suite('Live services against local phase1_test fixtures', () => {
  beforeAll(async () => {
    const config = parseEnv(readFileSync(new URL('../../../firebridge-backend/.env', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
    if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for the guarded local smoke test.')
    const db = new URL(config.DATABASE_URL)
    if (db.pathname !== '/firebridge_phase1_test' || !['localhost', '127.0.0.1'].includes(db.hostname) || (config.PORT && config.PORT !== '3000'))
      throw new Error('Smoke test requires the local firebridge_phase1_test database and API port 3000.')
    token = config.INGESTION_ADMIN_TOKEN ?? ''
    if (!token) throw new Error('Local ingestion admin token is not configured.')
    api.defaults.baseURL = 'http://127.0.0.1:3000/api/v1'
    api.defaults.adapter = 'http'
    const current = await catalog.get()
    if (current.scope_key !== scope || !current.releases.some((r) => r.id === release && r.name.startsWith('TEST ONLY')))
      throw new Error('API fixture fingerprint does not match. No mutation has been sent.')
  })
  afterAll(() => { api.defaults.adapter = originalAdapter; api.defaults.baseURL = originalURL; token = '' })
  it('reads release membership, follows its cursor and detects a newer release', async () => {
    const first = await releases.get(release, { limit: 1, membership: 'partitions' })
    expect(first.data.id).toBe(release)
    expect(first.data.membership.next_cursor).toBeTruthy()
    const second = await releases.get(release, { limit: 1, membership: 'partitions', cursor: first.data.membership.next_cursor! })
    expect(second.data.membership.items).not.toEqual(first.data.membership.items)
    const assets = await releases.get(release, { limit: 1, membership: 'assets' })
    expect(assets.data.membership.kind).toBe('assets')
    const updates = await releases.updates({ scope_key: scope, after_release_id: '11111111-1111-4111-8111-111111111111' })
    expect(updates.data.has_updates).toBe(true)
  })
  it('reads all four native views without losing bigint/time precision or unknown counts', async () => {
    const first = await nativeResults.detections(native, { limit: 1 })
    expect(first.data.features[0].properties.detection_id).toBe('9007199254740993')
    expect(first.data.features[0].properties.acquired_at).toBe('2024-01-17T00:00:00.000001Z')
    const next = await nativeResults.detections(native, { limit: 1, cursor: first.data.next_cursor! })
    expect(next.data.features[0].properties.detection_id).not.toBe(first.data.features[0].properties.detection_id)
    const summary = await nativeResults.summary(native)
    expect(summary.data.native_detections_by_source.find((s) => s.source_id === 'noaa21')?.count).toBeNull()
    expect(summary.data.native_detections_by_source.find((s) => s.source_id === 'terra')?.count).toBe('2')
    const calendar = await nativeResults.calendar(native, { resolution: 'day' })
    expect(calendar.data.periods).toHaveLength(3)
    const provenance = await nativeResults.provenance(native, { limit: 1 })
    expect(provenance.data.assets).toHaveLength(1)
  })
  it('reads prepared coverage/cell/comparison and pinned weather/reports, including missing states', async () => {
    expect((await context.coverage(native)).data.coverage_fraction).toBeNull()
    expect((await context.coverage(prepared)).data.coverage_fraction).toBe(1)
    expect((await context.cell(prepared, '6001', { limit: 1 })).data.observations).toHaveLength(1)
    expect((await context.comparison(native, { view: 'native_counts' })).data.series?.length).toBeGreaterThan(0)
    const unsupported = await context.comparison(prepared, { view: 'common_response', resolution: 'week' })
    expect(unsupported.data.status).toBe('unsupported')
    const common = await context.comparison(prepared, { view: 'common_response', resolution: 'month' })
    expect(common.data.status).toBe('ready')
    expect((await context.weather(native, { limit: 1 })).data.series[0].value).toBe(20)
    expect((await context.weather(prepared)).data.status).toBe('missing')
    expect((await context.reports(native, { limit: 1 })).data.reports[0].relation).toBe('candidate')
  })
  it('reads public source availability and the three protected admin resources', async () => {
    expect((await ingestion.availability('terra', { scope_key: scope })).data.ingestion_completeness).toBe('gaps_present')
    const subscriptions = await ingestion.subscriptions(token, { scope_key: scope })
    expect(subscriptions.data.subscriptions.some((s) => s.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true)
    expect((await ingestion.gaps(token, { scope_key: scope, status: 'open' })).data.gaps.length).toBeGreaterThan(0)
    const run = await ingestion.run(token, 'f5000000-0000-4000-8000-000000000001')
    expect(run.data.successful_empty).toBe(true)
    expect(run.data.sanitized_request).not.toHaveProperty('MAP_KEY')
    await expect(ingestion.subscriptions('deliberately-invalid')).rejects.toMatchObject({ status: 401 })
  })
  it('accepts bounded backfill/refresh plans and replays a retry without creating another job', async () => {
    const key = randomUUID()
    const input = { feed_id: 'modis', area_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scope_key: scope,
      start: '2024-01-17T00:00:00Z', end_exclusive: '2024-01-20T00:00:00Z', source_ids: ['terra', 'aqua'],
      products: ['MCD14ML'], collection: '6.1', resource_budget: { max_chunks: 3, max_bytes: 1000000 } }
    const first = await ingestion.backfill(token, input, key)
    expect(first.data.execution_support).toBe('planning_only')
    expect(first.data.estimated_bytes).toBeNull()
    const replay = await ingestion.backfill(token, input, key)
    expect(replay.data.job_id).toBe(first.data.job_id)
    expect(replay.data.reused).toBe(true)
    const refreshed = await ingestion.refresh(token, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      mode: 'repair', start: '2024-01-18T00:00:00Z', end_exclusive: '2024-01-19T00:00:00Z',
      reason: 'gap_repair', resource_budget: { max_chunks: 1, max_bytes: 1000000 },
    }, randomUUID())
    expect(refreshed.data.execution_support).toBe('planning_only')
    expect(refreshed.data.job_id).toBeTruthy()
  })
  it('creates and reads an explanation through real HTTP', async () => {
    const intent = { analysisId: native, input: { language: 'fr' as const, question: 'Vérification intégration frontend' }, idempotencyKey: randomUUID() }
    const first = await explanations.create(intent)
    expect(first.data.explanation_id).toBeTruthy()
    expect(first.data.job_id).toBeTruthy()
    expect(first.data.generation_mode).toBe('deterministic_template')
    const replay = await explanations.create(intent)
    expect(replay.data.explanation_id).toBe(first.data.explanation_id)
    const detail = await explanations.get(first.data.explanation_id)
    expect(detail.data.explanation_id).toBe(first.data.explanation_id)
    expect(detail.data.analysis_id).toBe(native)
  })
})

