import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { sourcesService } from '../src/services/sources.service.js';
import { InMemoryIdempotencyStore, RedisIdempotencyStore } from '../src/middleware/idempotency.js';

const apps: ReturnType<typeof createApp>[] = [];
function buildApp() {
  const app = createApp({ logger: false });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

const sourceBody = {
  name: 'Review source',
  provider: 'NASA',
  kind: 'hotspots',
  product: 'Review',
  collection: '2',
  processingStream: 'near-real-time',
  documentationUrl: 'https://example.org/review',
  citation: 'Test fixture',
  licenseInfo: 'Open data',
  schemaVersion: '1'
} as const;

function mockCreation() {
  const store = new InMemoryIdempotencyStore();
  vi.spyOn(RedisIdempotencyStore.prototype, 'acquire').mockImplementation((...args) =>
    store.acquire(...args)
  );
  vi.spyOn(RedisIdempotencyStore.prototype, 'complete').mockImplementation((...args) =>
    store.complete(...args)
  );
  vi.spyOn(RedisIdempotencyStore.prototype, 'release').mockImplementation((...args) =>
    store.release(...args)
  );
  const create = vi.spyOn(sourcesService, 'create').mockResolvedValue({
    id: 'fixture-source',
    ...sourceBody,
    platform: null,
    instrument: null,
    nativeResolutionM: null,
    metadata: { description: 'a'.repeat(10000) }
  });
  return { store, create };
}

describe('Fastify HTTP integration', () => {
  it('serves OpenAPI operations for the three Phase 1 endpoints, Sources and health', async () => {
    const response = await buildApp().inject('/api-docs/json');
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    for (const path of [
      '/api/v1/catalog',
      '/api/v1/releases/{release_id}',
      '/api/v1/updates',
      '/api/v1/sources',
      '/api/v1/health/live',
      '/api/v1/health/ready'
    ]) {
      const actual = Object.keys(spec.paths).find((key) => key.replace(/\/$/, '') === path);
      expect(actual, path).toBeDefined();
      expect(spec.paths[actual!].get).toBeDefined();
    }
    const release = spec.paths['/api/v1/releases/{release_id}'].get;
    expect(release.parameters).toContainEqual(
      expect.objectContaining({ name: 'release_id', in: 'path', required: true })
    );
    const ui = await apps[0].inject('/api-docs/');
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
  });

  it('keeps security headers on native routes and unknown paths', async () => {
    const app = buildApp();
    for (const path of ['/api/v1/health/live', '/api/v1/nope']) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(path.endsWith('live') ? 200 : 404);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('preserves CORS preflight support for mutation methods', async () => {
    const response = await buildApp().inject({
      method: 'OPTIONS',
      url: '/api/v1/sources',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT' }
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-methods']).toContain('PUT');
  });

  it.each([
    ['gzip', 'gzip'],
    ['gzip', 'identity'],
    ['identity', 'gzip']
  ])('replays a source once with compression %s then %s', async (firstEncoding, replayEncoding) => {
    const { create } = mockCreation();
    const app = buildApp();
    const responses = [];
    for (const encoding of [firstEncoding, replayEncoding]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sources',
        headers: { 'idempotency-key': 'compressed-source', 'accept-encoding': encoding },
        payload: sourceBody
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers['content-encoding']).toBe(encoding === 'gzip' ? 'gzip' : undefined);
      const payload =
        encoding === 'gzip' ? gunzipSync(response.rawPayload).toString() : response.body;
      const body = JSON.parse(payload);
      expect(body.request_id).toBe(response.headers['x-request-id']);
      responses.push({ response, body });
    }
    expect(create).toHaveBeenCalledOnce();
    expect(responses[1].response.headers['idempotent-replayed']).toBe('true');
    expect(responses[1].body.data).toEqual(responses[0].body.data);
    expect(responses[1].body.request_id).not.toBe(responses[0].body.request_id);
  });

  it('discards obsolete compression and length headers from older cached records', async () => {
    const { store, create } = mockCreation();
    vi.spyOn(RedisIdempotencyStore.prototype, 'complete').mockImplementation(
      (key, owner, hash, status, body, headers, ttl, representation) =>
        store.complete(
          key,
          owner,
          hash,
          status,
          body,
          { ...headers, 'content-encoding': 'gzip', 'content-length': '123' },
          ttl,
          representation
        )
    );
    const app = buildApp();
    const options = {
      method: 'POST' as const,
      url: '/api/v1/sources',
      headers: { 'idempotency-key': 'old-compression', 'accept-encoding': 'identity' },
      payload: sourceBody
    };
    await app.inject(options);
    const replay = await app.inject(options);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['content-encoding']).toBeUndefined();
    expect(Number(replay.headers['content-length'])).toBe(replay.rawPayload.length);
    expect(replay.json().data.id).toBe('fixture-source');
    expect(create).toHaveBeenCalledOnce();
  });
});
