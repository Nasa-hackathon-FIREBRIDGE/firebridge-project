import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  eval: vi.fn(),
  getBuffer: vi.fn(),
  set: vi.fn(),
  connect: vi.fn()
}));
vi.mock('@firebridge/results', async (original) => ({
  ...(await original<typeof import('@firebridge/results')>()),
  findResultContext: mocks.context
}));
vi.mock('../src/config/redis.js', () => ({
  ensureRedisConnected: mocks.connect,
  redis: { eval: mocks.eval, getBuffer: mocks.getBuffer, set: mocks.set }
}));
vi.mock('../src/middleware/idempotency.js', async (original) => {
  const actual = await original<typeof import('../src/middleware/idempotency.js')>();
  return {
    ...actual,
    idempotency: (options: Parameters<typeof actual.idempotency>[0]) =>
      actual.idempotency({ ...options, store: new actual.InMemoryIdempotencyStore() })
  };
});

import { createDownloadLink } from '../src/utils/download-link.js';
import { createApp } from '../src/app.js';
import { tilesRepository } from '../src/repositories/tiles.repository.js';
import { exportsRepository, type ExportJob } from '../src/repositories/exports.repository.js';
import { localExportStorage } from '@firebridge/results/storage';

const id = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const url = `/api/v1/analyses/${id}/tiles/detections/2/1/1.mvt`;
const context = {
  id,
  status: 'ready',
  time_basis: 'utc',
  metric_key: 'native_detections_v1',
  selection_policy: 'standard',
  grid_id: null,
  component_status: 'ready',
  release_status: 'published',
  release_id: id,
  cache_key: 'frozen',
  completed_at: new Date()
};
const job: ExportJob = {
  id: jobId,
  analysis_id: id,
  kind: 'export',
  status: 'succeeded',
  request_hash: 'hash',
  request_spec: { format: 'csv', filters: {}, options: {} },
  result_manifest_uri: `${jobId}.${id}.csv`,
  result_byte_size: 4n,
  created_at: new Date(),
  expires_at: new Date(Date.now() + 60000)
};
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
async function app() {
  const server = await createApp();
  apps.push(server);
  return server;
}

beforeEach(() => {
  mocks.context.mockResolvedValue(context);
  mocks.eval.mockResolvedValue(1);
  mocks.getBuffer.mockResolvedValue(null);
  mocks.set.mockResolvedValue('OK');
  mocks.connect.mockResolvedValue(undefined);
  vi.spyOn(tilesRepository, 'detections').mockResolvedValue(Buffer.from([26, 0]));
  vi.spyOn(exportsRepository, 'create').mockResolvedValue({ ...job, status: 'queued' });
  vi.spyOn(exportsRepository, 'findById').mockResolvedValue(job);
  vi.spyOn(localExportStorage, 'openDownload').mockImplementation(async () => ({
    bytes: 4,
    stream: Readable.from(['data'])
  }));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Phase 4 tiles and security', () => {
  it('returns binary MVT and a private no-store HTTP policy', async () => {
    const response = await (await app()).inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.rawPayload).toEqual(Buffer.from([26, 0]));
  });
  it('represents an empty tile as a zero-byte MVT', async () => {
    // Registry holds the code-owned generator; mock the shared query entrypoint.
    vi.mocked(tilesRepository.detections).mockResolvedValue(Buffer.alloc(0));
    const response = await (await app()).inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBe(0);
  });
  it.each([
    'unknown/2/1/1',
    'detections/19/0/0',
    'detections/2/4/0',
    'detections/2/0/4',
    'detections/-1/0/0',
    'detections/2/1.1/0',
    'detections/02/1/1',
    'detections/0/1/0'
  ])('rejects layer/XYZ %s', async (coordinates) => {
    const response = await (
      await app()
    ).inject({ url: `/api/v1/analyses/${id}/tiles/${coordinates}.mvt` });
    expect(response.statusCode).toBe(400);
  });
  it('rejects an invalid analysis UUID', async () => {
    expect((await (await app()).inject({ url: url.replace(id, 'invalid') })).statusCode).toBe(400);
  });
  it.each([null])('hides missing analyses before cache access', async (value) => {
    mocks.context.mockResolvedValue(value);
    expect((await (await app()).inject({ url })).statusCode).toBe(404);
    expect(mocks.getBuffer).not.toHaveBeenCalled();
  });
  it('serves tiles without a token or a client identity', async () => {
    expect((await (await app()).inject({ url })).statusCode).toBe(200);
  });
  it('serves a cached tile only after availability checks', async () => {
    mocks.getBuffer.mockResolvedValue(Buffer.from('cached'));
    const response = await (await app()).inject({ url });
    expect(response.body).toBe('cached');
    expect(mocks.context).toHaveBeenCalledWith(id);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('does not let client-supplied identity headers bypass network limits', async () => {
    const server = await app();
    await server.inject({ url });
    await server.inject({
      url,
      headers: { 'x-user-id': 'arbitrary', 'x-forwarded-for': '192.0.2.4' }
    });
    expect(mocks.eval.mock.calls[0][2]).toBe(mocks.eval.mock.calls[1][2]);
  });
  it('enforces the rate limit before the spatial query', async () => {
    mocks.eval.mockResolvedValue(121);
    const response = await (await app()).inject({ url });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('fails closed when the distributed limiter is unavailable', async () => {
    mocks.connect.mockRejectedValue(new Error('private Redis URL'));
    const response = await (await app()).inject({ url });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private Redis URL');
  });
});

describe('Phase 4 export creation', () => {
  const path = `/api/v1/analyses/${id}/exports`;
  it.each(['csv', 'geojson', 'parquet'])(
    'queues %s with 202 and a tracking URL',
    async (format) => {
      const response = await (
        await app()
      ).inject({
        method: 'POST',
        url: path,
        headers: { 'idempotency-key': 'new-export' },
        payload: { format }
      });
      expect(response.statusCode).toBe(202);
      expect(response.json().data).toMatchObject({
        job_id: jobId,
        analysis_id: id,
        status: 'queued',
        format
      });
      expect(response.headers.location).toBe(`/api/v1/jobs/${jobId}`);
    }
  );
  it.each([
    { format: 'pdf' },
    { format: 'csv', filters: { sql: 'anything' } },
    { format: 'csv', options: { path: '../secret' } },
    { format: 'csv', arbitrary: true }
  ])('rejects invalid payload %j', async (payload) => {
    const response = await (
      await app()
    ).inject({ method: 'POST', url: path, headers: { 'idempotency-key': 'invalid' }, payload });
    expect(response.statusCode).toBe(400);
    expect(exportsRepository.create).not.toHaveBeenCalled();
  });
  it('requires Idempotency-Key', async () => {
    const response = await (
      await app()
    ).inject({ method: 'POST', url: path, payload: { format: 'csv' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
  it.each([null])('hides missing analysis', async (value) => {
    mocks.context.mockResolvedValue(value);
    expect(
      (
        await (
          await app()
        ).inject({
          method: 'POST',
          url: path,
          headers: { 'idempotency-key': 'key' },
          payload: { format: 'csv' }
        })
      ).statusCode
    ).toBe(404);
  });
  it.each([{ status: 'running' }, { time_basis: 'local_solar' }, { release_status: 'withdrawn' }])(
    'rejects non-exportable context %j',
    async (patch) => {
      mocks.context.mockResolvedValue({ ...context, ...patch });
      expect(
        (
          await (
            await app()
          ).inject({
            method: 'POST',
            url: path,
            headers: { 'idempotency-key': 'key' },
            payload: { format: 'csv' }
          })
        ).statusCode
      ).toBe(409);
    }
  );
  it('replays idempotent requests; rejects a changed payload and rechecks access', async () => {
    const server = await app();
    const request = {
      method: 'POST' as const,
      url: path,
      headers: { 'idempotency-key': 'same' },
      payload: { format: 'csv' }
    };
    const first = await server.inject(request);
    const replay = await server.inject(request);
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data).toEqual(first.json().data);
    expect(replay.json().request_id).not.toBe(first.json().request_id);
    expect(exportsRepository.create).toHaveBeenCalledTimes(1);
    expect((await server.inject({ ...request, payload: { format: 'parquet' } })).statusCode).toBe(
      409
    );
    mocks.context.mockResolvedValue(null);
    expect((await server.inject(request)).statusCode).toBe(404);
  });
});

describe('Phase 4 download', () => {
  const path = createDownloadLink(jobId, new Date(Date.now() + 60000))!;
  it('streams an existing file with validated headers and length', async () => {
    const response = await (await app()).inject({ url: path });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('data');
    expect(response.headers['content-length']).toBe('4');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="firebridge-${jobId}.csv"`
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toContain('.data');
  });
  it.each(['queued', 'running', 'failed', 'cancelled'])('returns 409 for %s', async (status) => {
    vi.mocked(exportsRepository.findById).mockResolvedValue({ ...job, status });
    expect((await (await app()).inject({ url: path })).statusCode).toBe(409);
    expect(localExportStorage.openDownload).not.toHaveBeenCalled();
  });
  it.each([null, { ...job, kind: 'analysis' }])(
    'returns 404 for missing or non-export jobs',
    async (value) => {
      vi.mocked(exportsRepository.findById).mockResolvedValue(value);
      expect((await (await app()).inject({ url: path })).statusCode).toBe(404);
    }
  );
  it.each([{ expires_at: new Date(0) }, { result_manifest_uri: null }])(
    'returns 410 for expired or removed files',
    async (patch) => {
      vi.mocked(exportsRepository.findById).mockResolvedValue({ ...job, ...patch });
      expect((await (await app()).inject({ url: path })).statusCode).toBe(410);
    }
  );
  it('returns 410 when storage no longer contains the file', async () => {
    vi.mocked(localExportStorage.openDownload).mockRejectedValue(
      Object.assign(new Error('private path'), { code: 'ENOENT' })
    );
    const response = await (await app()).inject({ url: path });
    expect(response.statusCode).toBe(410);
    expect(response.body).not.toContain('private path');
  });
  it('does not stream mismatched or traversal metadata', async () => {
    vi.mocked(exportsRepository.findById).mockResolvedValue({
      ...job,
      result_manifest_uri: '../secret.csv'
    });
    expect((await (await app()).inject({ url: path })).statusCode).toBe(500);
    expect(localExportStorage.openDownload).not.toHaveBeenCalled();
  });
});
