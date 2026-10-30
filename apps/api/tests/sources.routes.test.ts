import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { sourcesService } from '../src/services/sources.service.js';

type App = Awaited<ReturnType<typeof createApp>>;

const apps: App[] = [];

async function buildApp(): Promise<App> {
  // inject() cannot capture bodies written through @fastify/express, so the Fastify-native routes
  // under test are exercised without the legacy Express layer (it is covered over real HTTP in app.test.ts).
  const app = await createApp({ legacyExpress: false });
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

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
  it('returns HTTP 200 with an empty sources array when the database has no matching records', async () => {
    vi.spyOn(sourcesService, 'list').mockResolvedValue({ sources: [], nextCursor: null });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources' });

    expect(response.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.sources).toHaveLength(1);
    expect(response.json().data.sources[0].id).toBe('source-1');
    expect(response.json().data.nextCursor).toBeNull();
  });

  it('validates listing filters and passes them to the service', async () => {
    const list = vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: null
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    const app = await buildApp();

    // Out-of-range limit — rejected before the service is called.
    const invalidResponse = await app.inject({ method: 'GET', url: '/api/v1/sources?limit=101' });
    expect(invalidResponse.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();

    // Valid filters — service receives parsed, coerced values.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sources?kind=hotspots&provider=NASA&limit=10'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(list).toHaveBeenCalledWith({ kind: 'hotspots', provider: 'NASA', limit: 10 });
  });

  it('returns HTTP 400 when an unknown query parameter is supplied', async () => {
    const list = vi.spyOn(sourcesService, 'list');

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources?foo=bar' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'INVALID_QUERY',
      message: 'Invalid source query.',
      data: null
    });
    // Unknown key is rejected before the service is ever called.
    expect(list).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 when an invalid kind value is supplied', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources?kind=invalid_kind' });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('error');
    expect(response.json().code).toBe('INVALID_QUERY');
  });

  it('forwards a cursor query parameter to the service unchanged', async () => {
    const list = vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: null
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/v1/sources?cursor=some-uuid-cursor&limit=10' });

    expect(list).toHaveBeenCalledWith({
      cursor: 'some-uuid-cursor',
      limit: 10
    });
  });

  it('returns HTTP 400 for limit below the minimum (0)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources?limit=0' });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('error');
    expect(response.json().code).toBe('INVALID_QUERY');
  });

  it('returns HTTP 500 and does not expose internal error details when the database fails', async () => {
    vi.spyOn(sourcesService, 'list').mockRejectedValue(
      new Error('relation "firebridge"."sources" does not exist — internal detail')
    );

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.json())).not.toContain('firebridge');
    expect(JSON.stringify(response.json())).not.toContain('internal detail');
  });

  it('returns HTTP 200 with a nextCursor when a subsequent page exists', async () => {
    vi.spyOn(sourcesService, 'list').mockResolvedValue({
      sources: [minimalSourceRecord],
      nextCursor: 'source-1'
    } as Awaited<ReturnType<typeof sourcesService.list>>);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources?limit=1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.nextCursor).toBe('source-1');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sources — existing tests preserved and extended
// ---------------------------------------------------------------------------

describe('POST /api/v1/sources', () => {
  it('validates and creates a source, returning HTTP 201 with the created record', async () => {
    const create = vi.spyOn(sourcesService, 'create').mockResolvedValue({
      id: 'source-1',
      ...minimalCreateBody,
      platform: null,
      instrument: null,
      nativeResolutionM: null,
      metadata: {}
    } as Awaited<ReturnType<typeof sourcesService.create>>);

    const app = await buildApp();

    // Non-http URL is rejected before the service is called.
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      payload: { ...minimalCreateBody, documentationUrl: 'file:///local/data' }
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      payload: minimalCreateBody
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('ok');
    expect(response.json().data.id).toBe('source-1');
    expect(create).toHaveBeenCalledWith(minimalCreateBody);
  });

  it('returns HTTP 400 when required fields are missing', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      payload: { name: 'Incomplete', provider: 'Org' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Invalid source payload.',
      data: null
    });
  });

  it('returns HTTP 400 when an unknown field is present in the body', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      payload: { ...minimalCreateBody, unknownField: 'should be rejected' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 500 and does not expose internal error details when the database fails on create', async () => {
    vi.spyOn(sourcesService, 'create').mockRejectedValue(
      new Error('duplicate key value — internal constraint detail')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      payload: minimalCreateBody
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.json())).not.toContain('duplicate key');
  });

  it('fails closed with HTTP 503 SERVICE_UNAVAILABLE on POST /api/v1/sources when an Idempotency-Key is provided and the store fails', async () => {
    const { RedisIdempotencyStore } = await import('../src/middleware/idempotency.js');
    vi.spyOn(RedisIdempotencyStore.prototype, 'acquire').mockRejectedValue(
      new Error('Redis connection lost')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      headers: { 'idempotency-key': 'idemp-source-create-fail-123' },
      payload: minimalCreateBody
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
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
    const complete = vi.spyOn(RedisIdempotencyStore.prototype, 'complete').mockResolvedValue(true);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      headers: { 'idempotency-key': 'idemp-source-create-123' },
      payload: minimalCreateBody
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.id).toBe('source-idemp-1');

    // Let the background completion run before the app is closed and mocks are restored.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(complete).toHaveBeenCalledOnce();
  });
});