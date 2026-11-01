import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  computePayloadHash,
  defaultScopeResolver,
  getSafeReplayHeaders,
  idempotency,
  InMemoryIdempotencyStore,
  validateIdempotencyKeyFormat,
  type IdempotencyOptions
} from '../src/middleware/idempotency.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { InvalidIdempotencyKeyError } from '../src/errors/app-error.js';

const apps: FastifyInstance[] = [];

/** Fastify instance with the project's global error handler, closed after each test. */
function newApp(): FastifyInstance {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  apps.push(app);
  return app;
}

/**
 * The idempotency record is persisted/released in the background after the response is
 * flushed (same as the Express 'finish' listener). Over real HTTP that completed long before
 * the next request; with inject() we yield to the event loop explicitly.
 */
async function flushBackground(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function post(
  app: FastifyInstance,
  url: string,
  options: { headers?: Record<string, string>; payload?: Record<string, unknown> } = {}
) {
  return app.inject({ method: 'POST', url, headers: options.headers, payload: options.payload });
}

describe('Idempotency-Key Middleware', () => {
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    store = new InMemoryIdempotencyStore();
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createTestApp(options: Partial<IdempotencyOptions> = {}) {
    const app = newApp();

    const handlerMock = vi.fn((req: FastifyRequest, reply: FastifyReply) =>
      reply.code(201).send({ success: true, processedAt: Date.now(), data: req.body })
    );

    app.post(
      '/test-resource',
      {
        ...idempotency({
          store,
          getScope: (req) => (req.headers['x-tenant-id'] as string) || 'test-client',
          ...options
        })
      },
      async (req, reply) => handlerMock(req, reply)
    );

    return { app, handlerMock };
  }

  it('persists replay after a normal real HTTP connection closes before an async root onResponse completes', async () => {
    const app = newApp();
    app.addHook('onResponse', async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    const handler = vi.fn(async (_req: FastifyRequest, reply: FastifyReply) => reply.code(202).send({ job_id: 'owned-test-job' }));
    app.post('/network-replay', { ...idempotency({ required: true, store, getScope: () => 'network-test' }) }, handler);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close', 'idempotency-key': 'normal-close' },
      body: JSON.stringify({ format: 'csv' }) };
    const first = await fetch(`${address}/network-replay`, request);
    expect(first.status).toBe(202);
    const payload = await first.text();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await fetch(`${address}/network-replay`, request);
    expect(second.status).toBe(202);
    expect(await second.text()).toBe(payload);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(handler).toHaveBeenCalledOnce();
  });

  describe('Key format validation', () => {
    it('accepts valid string keys within length bounds', () => {
      expect(validateIdempotencyKeyFormat('valid-key-123')).toBe('valid-key-123');
      expect(validateIdempotencyKeyFormat('550e8400-e29b-41d4-a716-446655440000')).toBe(
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });

    it('rejects keys exceeding 256 characters or empty', () => {
      expect(() => validateIdempotencyKeyFormat('')).toThrow(InvalidIdempotencyKeyError);
      expect(() => validateIdempotencyKeyFormat('   ')).toThrow(InvalidIdempotencyKeyError);
      expect(() => validateIdempotencyKeyFormat('a'.repeat(257))).toThrow(InvalidIdempotencyKeyError);
    });

    it('rejects non-printable or control characters', () => {
      expect(() => validateIdempotencyKeyFormat('key\nwith\rnewline')).toThrow(
        InvalidIdempotencyKeyError
      );
      expect(() => validateIdempotencyKeyFormat('key with spaces')).toThrow(
        InvalidIdempotencyKeyError
      );
    });
  });

  describe('Header presence and requirements', () => {
    it('returns HTTP 400 when Idempotency-Key is required but absent', async () => {
      const { app } = createTestApp({ required: true });

      const res = await post(app, '/test-resource', { payload: { title: 'Task' } });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('allows requests through when Idempotency-Key is optional and absent', async () => {
      const { app, handlerMock } = createTestApp({ required: false });

      const res = await post(app, '/test-resource', { payload: { title: 'Task' } });

      expect(res.statusCode).toBe(201);
      expect(handlerMock).toHaveBeenCalledOnce();
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    });

    it('rejects malformed Idempotency-Key with HTTP 400', async () => {
      const { app } = createTestApp({ required: true });

      const res = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': 'invalid key with spaces' },
        payload: { title: 'Task' }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_IDEMPOTENCY_KEY');
    });
  });

  describe('Replay and caching behavior', () => {
    it('processes the request on first attempt and replays cached response on second identical attempt without re-running handler', async () => {
      const { app, handlerMock } = createTestApp({ required: true });
      const idempotencyKey = 'req-key-001';
      const payload = { title: 'Create Source', value: 42 };

      // First call
      const firstRes = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload
      });

      expect(firstRes.statusCode).toBe(201);
      expect(firstRes.json().success).toBe(true);
      expect(handlerMock).toHaveBeenCalledOnce();
      expect(firstRes.headers['idempotent-replayed']).toBeUndefined();

      await flushBackground();

      // Second call with same key and same body
      const secondRes = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload
      });

      expect(secondRes.statusCode).toBe(201);
      expect(secondRes.json()).toEqual(firstRes.json());
      expect(secondRes.headers['idempotent-replayed']).toBe('true');
      // Handler must NOT have been called a second time
      expect(handlerMock).toHaveBeenCalledOnce();
    });

    it('returns HTTP 409 Conflict when the same key is reused with a different request payload', async () => {
      const { app, handlerMock } = createTestApp({ required: true });
      const idempotencyKey = 'req-key-002';

      // First call with payload A
      await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload: { name: 'Payload A' }
      });

      expect(handlerMock).toHaveBeenCalledOnce();
      await flushBackground();

      // Second call with same key but payload B
      const conflictRes = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload: { name: 'Payload B (different)' }
      });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflictRes.json().message).toContain('different request payload');
      // Handler must NOT be called for the conflicting request
      expect(handlerMock).toHaveBeenCalledOnce();
    });
  });

  describe('Concurrent requests and in-flight locking', () => {
    it('returns HTTP 409 Conflict with Retry-After when a concurrent request with the same key is in progress', async () => {
      const { app } = createTestApp({ required: true });

      const idempotencyKey = 'concurrent-key-001';
      const payload = { action: 'start' };
      const storageKey = `idempotency:test-client:POST:/test-resource:${idempotencyKey}`;
      const payloadHash = computePayloadHash({
        method: 'POST',
        url: '/test-resource',
        body: payload,
        query: {}
      } as unknown as FastifyRequest);

      // Simulate Request 1 having acquired the in_progress lock with an ownership token
      await store.acquire(storageKey, payloadHash, 10_000, 'owner-token-1');

      // Request 2 arrives while in_progress lock is held
      const concurrentRes = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload
      });

      expect(concurrentRes.statusCode).toBe(409);
      expect(concurrentRes.json().code).toBe('IDEMPOTENCY_CONFLICT');
      expect(concurrentRes.json().message).toContain('currently in progress');
      expect(concurrentRes.headers['retry-after']).toBe('2');
    });
  });

  describe('Error handling and lock release', () => {
    it('releases the lock when an unhandled 500 error occurs, allowing subsequent retries', async () => {
      const app = newApp();

      let attempts = 0;
      app.post(
        '/failing-resource',
        { ...idempotency({ store, required: true }) },
        async (_req, reply) => {
          attempts++;
          if (attempts === 1) {
            throw new Error('Transient database error');
          }
          return reply.code(201).send({ success: true, attempt: attempts });
        }
      );

      const idempotencyKey = 'retryable-key';
      const payload = { item: 'value' };

      // First attempt fails with 500
      const firstRes = await post(app, '/failing-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload
      });

      expect(firstRes.statusCode).toBe(500);
      await flushBackground();

      // Second attempt with same key must not be blocked by lingering in_progress lock
      const retryRes = await post(app, '/failing-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload
      });

      expect(retryRes.statusCode).toBe(201);
      expect(retryRes.json().attempt).toBe(2);
    });
  });

  describe('Tenant and identity scope isolation', () => {
    it('isolates keys across different tenants or client contexts', async () => {
      const { app, handlerMock } = createTestApp({ required: true });
      const idempotencyKey = 'shared-key-across-tenants';

      // Tenant A
      const resA = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey, 'x-tenant-id': 'tenant-alpha' },
        payload: { data: 'A' }
      });

      expect(resA.statusCode).toBe(201);
      await flushBackground();

      // Tenant B uses the same key with different data -> must NOT conflict due to tenant scoping
      const resB = await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey, 'x-tenant-id': 'tenant-beta' },
        payload: { data: 'B' }
      });

      expect(resB.statusCode).toBe(201);
      expect(handlerMock).toHaveBeenCalledTimes(2);
    });

    it('ignores untrusted caller headers in default scope resolver to prevent spoofing', () => {
      const unauthenticatedReq = {
        headers: { 'x-tenant-id': 'spoofed-tenant-id' },
        user: undefined,
        auth: undefined
      } as unknown as FastifyRequest;

      // Unauthenticated caller cannot hijack another tenant's scope by sending custom headers
      expect(defaultScopeResolver(unauthenticatedReq)).toBe('unauthenticated');

      const authenticatedReq = {
        headers: {},
        user: { tenantId: 'real-trusted-tenant' }
      } as unknown as FastifyRequest;

      expect(defaultScopeResolver(authenticatedReq)).toBe('tenant:real-trusted-tenant');
    });
  });

  describe('Key expiration', () => {
    it('allows re-execution after key retention TTL expires', async () => {
      // 1-second retention TTL
      const { app, handlerMock } = createTestApp({ required: true, retentionTtlSec: 1 });
      const idempotencyKey = 'expiring-key';

      await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload: { item: 'data' }
      });

      expect(handlerMock).toHaveBeenCalledOnce();

      // Wait 1.1s for expiration
      await new Promise((r) => setTimeout(r, 1100));

      // Re-send same key and body after expiration -> should re-execute
      await post(app, '/test-resource', {
        headers: { 'Idempotency-Key': idempotencyKey },
        payload: { item: 'data' }
      });

      expect(handlerMock).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Hardened Security & Isolation Tests (Phase 0 Review Requirements)
  // ---------------------------------------------------------------------------

  describe('Ownership token & Stale-owner Protection', () => {
    it('prevents a stale owner from releasing a lock acquired by a newer owner after expiry', async () => {
      const key = 'test:lock:key';
      const hash = 'hash-123';

      // Owner A acquires lock with 50ms TTL
      const acqA = await store.acquire(key, hash, 50, 'owner-token-A');
      expect(acqA.acquired).toBe(true);

      // Wait for Owner A's lock to expire
      await new Promise((r) => setTimeout(r, 60));

      // Owner B acquires the lock with its own token
      const acqB = await store.acquire(key, hash, 10_000, 'owner-token-B');
      expect(acqB.acquired).toBe(true);

      // Stale Owner A attempts to release the lock -> must fail and NOT delete Owner B's lock
      const releasedByA = await store.release(key, 'owner-token-A');
      expect(releasedByA).toBe(false);

      // Verify Owner B's lock is still intact and in progress
      const checkB = await store.acquire(key, hash, 10_000, 'owner-token-C');
      expect(checkB.acquired).toBe(false);
      expect((checkB as { record: { status: string } }).record?.status).toBe('in_progress');
    });

    it('prevents a stale owner from completing a record after its lock was lost', async () => {
      const key = 'test:complete:key';
      const hash = 'hash-456';

      // Owner A acquires lock with 50ms TTL
      await store.acquire(key, hash, 50, 'owner-token-A');

      // Wait for lock to expire
      await new Promise((r) => setTimeout(r, 60));

      // Owner B acquires the lock
      await store.acquire(key, hash, 10_000, 'owner-token-B');

      // Owner A attempts to complete -> must fail and NOT overwrite Owner B's in-progress state
      const completedByA = await store.complete(
        key,
        'owner-token-A',
        hash,
        200,
        { data: 'stale' },
        {},
        3600
      );
      expect(completedByA).toBe(false);

      // Complete by legitimate Owner B -> succeeds
      const completedByB = await store.complete(
        key,
        'owner-token-B',
        hash,
        201,
        { data: 'fresh' },
        {},
        3600
      );
      expect(completedByB).toBe(true);
    });

    it('extends lock lease duration via renewLease for the legitimate owner token only', async () => {
      const key = 'test:renew:key';
      const hash = 'hash-789';

      await store.acquire(key, hash, 100, 'owner-token-A');

      // Stale token cannot renew
      const renewFake = await store.renewLease?.(key, 'fake-token', 500);
      expect(renewFake).toBe(false);

      // Legitimate token extends lease
      const renewLegit = await store.renewLease?.(key, 'owner-token-A', 500);
      expect(renewLegit).toBe(true);
    });
  });

  describe('Deterministic & Canonical Request Fingerprinting', () => {
    it('produces identical payload hashes for JSON bodies with different key orderings', () => {
      const req1 = {
        method: 'POST',
        url: '/api/v1/sources',
        query: { kind: 'hotspots', provider: 'NASA' },
        body: { name: 'Fire', count: 10, nested: { b: 2, a: 1 } }
      } as unknown as FastifyRequest;

      const req2 = {
        method: 'POST',
        url: '/api/v1/sources',
        query: { provider: 'NASA', kind: 'hotspots' },
        body: { count: 10, name: 'Fire', nested: { a: 1, b: 2 } }
      } as unknown as FastifyRequest;

      expect(computePayloadHash(req1)).toBe(computePayloadHash(req2));
    });

    it('produces different hashes when query parameters or body values differ', () => {
      const reqBase = {
        method: 'POST',
        url: '/sources',
        query: { limit: '10' },
        body: { active: true }
      } as unknown as FastifyRequest;

      const reqDiffQuery = {
        method: 'POST',
        url: '/sources',
        query: { limit: '20' },
        body: { active: true }
      } as unknown as FastifyRequest;

      const reqDiffBody = {
        method: 'POST',
        url: '/sources',
        query: { limit: '10' },
        body: { active: false }
      } as unknown as FastifyRequest;

      expect(computePayloadHash(reqBase)).not.toBe(computePayloadHash(reqDiffQuery));
      expect(computePayloadHash(reqBase)).not.toBe(computePayloadHash(reqDiffBody));
    });

    it('canonicalizes nested arrays and primitive types predictably', () => {
      const complex = { z: [3, 2, 1], a: { y: null, x: true } };
      const canonical = canonicalize(complex);
      expect(Object.keys(canonical as object)).toEqual(['a', 'z']);
      expect(Object.keys((canonical as { a: object }).a)).toEqual(['x', 'y']);
    });
  });

  describe('Explicit Store Failure Policies', () => {
    it('fails closed with HTTP 503 SERVICE_UNAVAILABLE when store throws and policy is fail_closed', async () => {
      const failingStore = {
        acquire: vi.fn().mockRejectedValue(new Error('Connection refused to Redis')),
        complete: vi.fn(),
        release: vi.fn()
      };

      const app = newApp();
      app.post(
        '/critical-endpoint',
        { ...idempotency({ store: failingStore, required: true, onStoreError: 'fail_closed' }) },
        async (_req, reply) => reply.code(200).send({ ok: true })
      );

      const res = await post(app, '/critical-endpoint', {
        headers: { 'Idempotency-Key': 'idemp-fail-1' },
        payload: { data: 1 }
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('SERVICE_UNAVAILABLE');
      expect(res.json().message).not.toContain('Connection refused');
    });

    it('bypasses idempotency without failing when route explicitly opts into bypass on failure', async () => {
      const failingStore = {
        acquire: vi.fn().mockRejectedValue(new Error('Redis cluster down')),
        complete: vi.fn(),
        release: vi.fn()
      };

      const app = newApp();
      const handler = vi.fn((_req: FastifyRequest, reply: FastifyReply) =>
        reply.code(200).send({ executed: true })
      );

      app.post(
        '/optional-endpoint',
        { ...idempotency({ store: failingStore, required: false, onStoreError: 'bypass' }) },
        async (req, reply) => handler(req, reply)
      );

      const res = await post(app, '/optional-endpoint', {
        headers: { 'Idempotency-Key': 'idemp-bypass-1' },
        payload: { data: 1 }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().executed).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('Response Replay Header Filtering & Non-JSON Handling', () => {
    it('filters out hop-by-hop and sensitive headers during replay while preserving contract headers', () => {
      // getSafeReplayHeaders now receives the response headers directly (reply.getHeaders()).
      const safe = getSafeReplayHeaders({
        'content-type': 'application/json',
        etag: '"abc123"',
        'set-cookie': 'session=secret123',
        connection: 'keep-alive',
        'x-request-id': 'req-xyz',
        'content-length': 42
      });
      expect(safe['content-type']).toBe('application/json');
      expect(safe.etag).toBe('"abc123"');
      expect(safe['set-cookie']).toBeUndefined();
      expect(safe.connection).toBeUndefined();
      expect(safe['x-request-id']).toBeUndefined();
      // Fastify recomputes content-length on send, so it must not be replayed.
      expect(safe['content-length']).toBeUndefined();
    });

    it('replays plain text and binary buffer responses accurately', async () => {
      const app = newApp();

      let callCount = 0;
      app.post('/text-endpoint', { ...idempotency({ store, required: true }) }, async (_req, reply) => {
        callCount++;
        reply.header('Content-Type', 'text/plain');
        return reply.code(200).send(`Plain text execution #${callCount}`);
      });

      // First call
      const res1 = await post(app, '/text-endpoint', {
        headers: { 'Idempotency-Key': 'text-key-1' }
      });

      expect(res1.statusCode).toBe(200);
      expect(res1.body).toBe('Plain text execution #1');
      await flushBackground();

      // Replay
      const res2 = await post(app, '/text-endpoint', {
        headers: { 'Idempotency-Key': 'text-key-1' }
      });

      expect(res2.statusCode).toBe(200);
      expect(res2.body).toBe('Plain text execution #1');
      expect(res2.headers['idempotent-replayed']).toBe('true');
      expect(callCount).toBe(1);
    });
  });

  describe('Background Promise Failure & Safe Cleanup', () => {
    it('safely handles background store.complete rejection without unhandled rejection', async () => {
      const rejectingStore = {
        acquire: vi.fn().mockResolvedValue({ acquired: true }),
        complete: vi.fn().mockRejectedValue(new Error('Redis connection lost on save')),
        release: vi.fn()
      };

      const app = newApp();
      app.post(
        '/bg-complete-fail',
        { ...idempotency({ store: rejectingStore, required: true }) },
        async (_req, reply) => reply.code(201).send({ created: true })
      );

      const res = await post(app, '/bg-complete-fail', {
        headers: { 'Idempotency-Key': 'bg-key-complete-1' },
        payload: { foo: 'bar' }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().created).toBe(true);
      await flushBackground();
      expect(rejectingStore.complete).toHaveBeenCalledOnce();
    });

    it('safely handles background store.release rejection without unhandled rejection', async () => {
      const rejectingStore = {
        acquire: vi.fn().mockResolvedValue({ acquired: true }),
        complete: vi.fn(),
        release: vi.fn().mockRejectedValue(new Error('Redis failed to release lock'))
      };

      const app = newApp();
      app.post(
        '/bg-release-fail',
        { ...idempotency({ store: rejectingStore, required: true }) },
        async () => {
          throw new Error('Simulated internal server crash');
        }
      );

      const res = await post(app, '/bg-release-fail', {
        headers: { 'Idempotency-Key': 'bg-key-release-1' },
        payload: { foo: 'bar' }
      });

      expect(res.statusCode).toBe(500);
      await flushBackground();
      expect(rejectingStore.release).toHaveBeenCalledOnce();
    });

    it('cleans up renewal lease timer exactly once on finish or close', async () => {
      const renewLeaseMock = vi.fn().mockResolvedValue(true);
      const testStore = {
        acquire: vi.fn().mockResolvedValue({ acquired: true }),
        complete: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        renewLease: renewLeaseMock
      };

      const app = newApp();
      app.post(
        '/timer-cleanup-endpoint',
        {
          ...idempotency({
            store: testStore,
            required: true,
            enableLeaseRenewal: true,
            lockTtlMs: 200,
            leaseRenewalIntervalMs: 50
          })
        },
        async (_req, reply) => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return reply.code(200).send({ done: true });
        }
      );

      const res = await post(app, '/timer-cleanup-endpoint', {
        headers: { 'Idempotency-Key': 'timer-key-1' }
      });

      expect(res.statusCode).toBe(200);
      await flushBackground();
      const renewCountAtFinish = renewLeaseMock.mock.calls.length;

      // Wait additional intervals to confirm timer is dead and stopped
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(renewLeaseMock.mock.calls.length).toBe(renewCountAtFinish);
    });

    it('handles background store.renewLease rejection safely', async () => {
      const renewLeaseFailing = vi.fn().mockRejectedValue(new Error('Redis renew lease failed'));
      const testStore = {
        acquire: vi.fn().mockResolvedValue({ acquired: true }),
        complete: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(true),
        renewLease: renewLeaseFailing
      };

      const app = newApp();
      app.post(
        '/renew-fail-endpoint',
        {
          ...idempotency({
            store: testStore,
            required: true,
            enableLeaseRenewal: true,
            lockTtlMs: 100,
            leaseRenewalIntervalMs: 20
          })
        },
        async (_req, reply) => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return reply.code(200).send({ done: true });
        }
      );

      const res = await post(app, '/renew-fail-endpoint', {
        headers: { 'Idempotency-Key': 'renew-fail-key-1' }
      });

      expect(res.statusCode).toBe(200);
      expect(renewLeaseFailing).toHaveBeenCalled();
    });
  });

  describe('Redis Connection Readiness & Single-Flight Connect', () => {
    it('returns immediately without connecting if redis is already ready', async () => {
      const { ensureRedisConnected, redis: redisClient } = await import('../src/config/redis.js');
      const originalStatus = redisClient.status;
      Object.defineProperty(redisClient, 'status', { value: 'ready', configurable: true });

      const connectSpy = vi.spyOn(redisClient, 'connect');
      await ensureRedisConnected();

      expect(connectSpy).not.toHaveBeenCalled();
      Object.defineProperty(redisClient, 'status', { value: originalStatus, configurable: true });
    });

    it('executes a single-flight connect when multiple concurrent calls occur in wait status', async () => {
      const { ensureRedisConnected, redis: redisClient } = await import('../src/config/redis.js');
      const originalStatus = redisClient.status;
      Object.defineProperty(redisClient, 'status', { value: 'wait', configurable: true });

      let resolveConnect!: () => void;
      const connectPromise = new Promise<void>((resolve) => {
        resolveConnect = () => {
          Object.defineProperty(redisClient, 'status', { value: 'ready', configurable: true });
          resolve();
        };
      });

      const connectSpy = vi.spyOn(redisClient, 'connect').mockReturnValue(connectPromise as never);

      // Trigger 3 concurrent calls
      const call1 = ensureRedisConnected();
      const call2 = ensureRedisConnected();
      const call3 = ensureRedisConnected();

      expect(connectSpy).toHaveBeenCalledOnce();

      resolveConnect();
      await Promise.all([call1, call2, call3]);

      expect(connectSpy).toHaveBeenCalledOnce();
      Object.defineProperty(redisClient, 'status', { value: originalStatus, configurable: true });
    });
  });
});
