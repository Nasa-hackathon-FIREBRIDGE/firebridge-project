import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sourcesService } from '../src/services/sources.service.js';

// Shared fixture for a minimal valid source record returned by the mocked service.
const minimalSourceRecord = {
  id: 'source-1',
  name: 'VIIRS active fire',
  provider: 'NASA',
  kind: 'hotspots',
  platform: null,
  instrument: null,
  product: 'VNP14IMG',
  collection: '2',
  processingStream: 'near-real-time',
  documentationUrl: 'https://example.org/source',
  citation: 'Example source citation',
  licenseInfo: 'Open data',
  nativeResolutionM: null,
  schemaVersion: '1',
  metadata: {}
} as const;

// Minimal valid POST body (required fields only).
const minimalCreateBody = {
  name: 'VIIRS active fire',
  provider: 'NASA',
  kind: 'hotspots',
  product: 'VNP14IMG',
  collection: '2',
  processingStream: 'near-real-time',
  documentationUrl: 'https://example.org/source',
  citation: 'Example source citation',
  licenseInfo: 'Open data',
  schemaVersion: '1'
} as const;

describe('GET /api/v1/sources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HTTP 200 with an empty sources array when the database has no matching records', async () => {
    vi.spyOn(sourcesService, 'list').mockResolvedValue({ sources: [], nextCursor: null });

    const response = await request(createApp()).get('/api/v1/sources');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      message: 'Sources retrieved.',
      data: { sources: [], nextCursor: null }
    });
  });

  it('returns HTTP 200 with the full record list when sources are present', async () => {
    vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: null
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    const response = await request(createApp()).get('/api/v1/sources');

    expect(response.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.data.sources).toHaveLength(1);
    expect(response.body.data.sources[0].id).toBe('source-1');
    expect(response.body.data.nextCursor).toBeNull();
  });

  it('validates listing filters and passes them to the service', async () => {
    const list = vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: null
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    // Out-of-range limit — rejected before the service is called.
    const invalidResponse = await request(createApp()).get('/api/v1/sources?limit=101');
    expect(invalidResponse.status).toBe(400);
    expect(list).not.toHaveBeenCalled();

    // Valid filters — service receives parsed, coerced values.
    const response = await request(createApp()).get(
      '/api/v1/sources?kind=hotspots&provider=NASA&limit=10'
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(list).toHaveBeenCalledWith({ kind: 'hotspots', provider: 'NASA', limit: 10 });
  });

  it('returns HTTP 400 when an unknown query parameter is supplied', async () => {
    const list = vi.spyOn(sourcesService, 'list');

    const response = await request(createApp()).get('/api/v1/sources?foo=bar');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      code: 'INVALID_QUERY',
      message: 'Invalid source query.',
      data: null
    });
    // Unknown key is rejected before the service is ever called.
    expect(list).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 when an invalid kind value is supplied', async () => {
    const response = await request(createApp()).get('/api/v1/sources?kind=invalid_kind');

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
    expect(response.body.code).toBe('INVALID_QUERY');
  });

  it('forwards a cursor query parameter to the service unchanged', async () => {
    const list = vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: null
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    await request(createApp()).get('/api/v1/sources?cursor=some-uuid-cursor&limit=10');

    expect(list).toHaveBeenCalledWith({
      cursor: 'some-uuid-cursor',
      limit: 10
    });
  });

  it('returns HTTP 400 for limit below the minimum (0)', async () => {
    const response = await request(createApp()).get('/api/v1/sources?limit=0');

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
    expect(response.body.code).toBe('INVALID_QUERY');
  });

  it('returns HTTP 500 and does not expose internal error details when the database fails', async () => {
    vi.spyOn(sourcesService, 'list').mockRejectedValue(
      new Error('relation "firebridge"."sources" does not exist — internal detail')
    );

    const response = await request(createApp()).get('/api/v1/sources');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.body)).not.toContain('firebridge');
    expect(JSON.stringify(response.body)).not.toContain('internal detail');
  });

  it('returns HTTP 200 with a nextCursor when a subsequent page exists', async () => {
    vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: 'source-1'
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    const response = await request(createApp()).get('/api/v1/sources?limit=1');

    expect(response.status).toBe(200);
    expect(response.body.data.nextCursor).toBe('source-1');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sources — existing tests preserved and extended
// ---------------------------------------------------------------------------

describe('POST /api/v1/sources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates and creates a source, returning HTTP 201 with the created record', async () => {
    const create = vi.spyOn(sourcesService, 'create').mockResolvedValue({
      id: 'source-1',
      ...minimalCreateBody,
      platform: null,
      instrument: null,
      nativeResolutionM: null,
      metadata: {}
    } as Awaited<ReturnType<typeof sourcesService.create>>);

    // Non-http URL is rejected before the service is called.
    const invalidResponse = await request(createApp())
      .post('/api/v1/sources')
      .send({ ...minimalCreateBody, documentationUrl: 'file:///local/data' });
    expect(invalidResponse.status).toBe(400);
    expect(create).not.toHaveBeenCalled();

    const response = await request(createApp()).post('/api/v1/sources').send(minimalCreateBody);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ok');
    expect(response.body.data.id).toBe('source-1');
    expect(create).toHaveBeenCalledWith(minimalCreateBody);
  });

  it('returns HTTP 400 when required fields are missing', async () => {
    const response = await request(createApp())
      .post('/api/v1/sources')
      .send({ name: 'Incomplete', provider: 'Org' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Invalid source payload.',
      data: null
    });
  });

  it('returns HTTP 400 when an unknown field is present in the body', async () => {
    const response = await request(createApp())
      .post('/api/v1/sources')
      .send({ ...minimalCreateBody, unknownField: 'should be rejected' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 500 and does not expose internal error details when the database fails on create', async () => {
    vi.spyOn(sourcesService, 'create').mockRejectedValue(
      new Error('duplicate key value — internal constraint detail')
    );

    const response = await request(createApp()).post('/api/v1/sources').send(minimalCreateBody);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.body)).not.toContain('duplicate key');
  });

  it('fails closed with HTTP 503 SERVICE_UNAVAILABLE on POST /api/v1/sources when an Idempotency-Key is provided and the store fails', async () => {
    const { RedisIdempotencyStore } = await import('../src/middleware/idempotency.js');
    vi.spyOn(RedisIdempotencyStore.prototype, 'acquire').mockRejectedValue(
      new Error('Redis connection lost')
    );

    const response = await request(createApp())
      .post('/api/v1/sources')
      .set('Idempotency-Key', 'idemp-source-create-fail-123')
      .send(minimalCreateBody);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'error',
      code: 'SERVICE_UNAVAILABLE',
      message: 'Internal server error.',
      data: null
    });
  });

  it('creates a source with HTTP 201 when Idempotency-Key is provided and the store succeeds', async () => {
    vi.spyOn(sourcesService, 'create').mockResolvedValue({
      id: 'source-idemp-1',
      ...minimalCreateBody,
      platform: null,
      instrument: null,
      nativeResolutionM: null,
      metadata: {}
    } as Awaited<ReturnType<typeof sourcesService.create>>);

    const { RedisIdempotencyStore } = await import('../src/middleware/idempotency.js');
    vi.spyOn(RedisIdempotencyStore.prototype, 'acquire').mockResolvedValue({ acquired: true });
    vi.spyOn(RedisIdempotencyStore.prototype, 'complete').mockResolvedValue(true);

    const response = await request(createApp())
      .post('/api/v1/sources')
      .set('Idempotency-Key', 'idemp-source-create-123')
      .send(minimalCreateBody);

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe('source-idemp-1');
  });
});
