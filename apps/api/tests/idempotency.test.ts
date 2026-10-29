import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  computePayloadHash,
  defaultScopeResolver,
  getSafeReplayHeaders,
  idempotency,
  InMemoryIdempotencyStore,
  validateIdempotencyKeyFormat
} from '../src/middleware/idempotency.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { InvalidIdempotencyKeyError } from '../src/errors/app-error.js';

describe('Idempotency-Key Middleware', () => {
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    store = new InMemoryIdempotencyStore();
  });

  function createTestApp(options = {}) {
    const app = express();
    app.use(express.json());

    const handlerMock = vi.fn((req, res) => {
      res.status(201).json({ success: true, processedAt: Date.now(), data: req.body });
    });

    app.post(
      '/test-resource',
      idempotency({
        store,
        getScope: (req) => (req.headers['x-tenant-id'] as string) || 'test-client',
        ...options
      }),
      (req, res) => {
        handlerMock(req, res);
      }
    );

    app.use(errorHandler);
    return { app, handlerMock };
  }

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

      const res = await request(app)
        .post('/test-resource')
        .send({ title: 'Task' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('allows requests through when Idempotency-Key is optional and absent', async () => {
      const { app, handlerMock } = createTestApp({ required: false });

      const res = await request(app)
        .post('/test-resource')
        .send({ title: 'Task' });

      expect(res.status).toBe(201);
      expect(handlerMock).toHaveBeenCalledOnce();
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    });

    it('rejects malformed Idempotency-Key with HTTP 400', async () => {
      const { app } = createTestApp({ required: true });

      const res = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', 'invalid key with spaces')
        .send({ title: 'Task' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });
  });

  describe('Replay and caching behavior', () => {
    it('processes the request on first attempt and replays cached response on second identical attempt without re-running handler', async () => {
      const { app, handlerMock } = createTestApp({ required: true });
      const idempotencyKey = 'req-key-001';
      const payload = { title: 'Create Source', value: 42 };

      // First call
      const firstRes = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(firstRes.status).toBe(201);
      expect(firstRes.body.success).toBe(true);
      expect(handlerMock).toHaveBeenCalledOnce();
      expect(firstRes.headers['idempotent-replayed']).toBeUndefined();

      // Second call with same key and same body
      const secondRes = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(secondRes.status).toBe(201);
      expect(secondRes.body).toEqual(firstRes.body);
      expect(secondRes.headers['idempotent-replayed']).toBe('true');
      // Handler must NOT have been called a second time
      expect(handlerMock).toHaveBeenCalledOnce();
    });

    it('returns HTTP 409 Conflict when the same key is reused with a different request payload', async () => {
      const { app, handlerMock } = createTestApp({ required: true });
      const idempotencyKey = 'req-key-002';

      // First call with payload A
      await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: 'Payload A' });

      expect(handlerMock).toHaveBeenCalledOnce();

      // Second call with same key but payload B
      const conflictRes = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: 'Payload B (different)' });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflictRes.body.message).toContain('different request payload');
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
        baseUrl: '',
        path: '/test-resource',
        body: payload,
        query: {}
      } as unknown as express.Request);

      // Simulate Request 1 having acquired the in_progress lock with an ownership token
      await store.acquire(storageKey, payloadHash, 10_000, 'owner-token-1');

      // Request 2 arrives while in_progress lock is held
      const concurrentRes = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(concurrentRes.status).toBe(409);
      expect(concurrentRes.body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(concurrentRes.body.message).toContain('currently in progress');
      expect(concurrentRes.headers['retry-after']).toBe('2');
    });
  });

  describe('Error handling and lock release', () => {
    it('releases the lock when an unhandled 500 error occurs, allowing subsequent retries', async () => {
      const app = express();
      app.use(express.json());

      let attempts = 0;
      app.post(
        '/failing-resource',
        idempotency({ store, required: true }),
        (_req, _res, next) => {
          attempts++;
          if (attempts === 1) {
            next(new Error('Transient database error'));
            return;
          }
          _res.status(201).json({ success: true, attempt: attempts });
        }
      );
      app.use(errorHandler);

      const idempotencyKey = 'retryable-key';
      const payload = { item: 'value' };

      // First attempt fails with 500
      const firstRes = await request(app)
        .post('/failing-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(firstRes.status).toBe(500);

      // Second attempt with same key must not be blocked by lingering in_progress lock
      const retryRes = await request(app)
        .post('/failing-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(retryRes.status).toBe(201);
      expect(retryRes.body.attempt).toBe(2);
    });
  });

  describe('Tenant and identity scope isolation', () => {
    it('isolates keys across different tenants or client contexts', async () => {
      const { app, handlerMock } = createTestApp({ required: true });
      const idempotencyKey = 'shared-key-across-tenants';

      // Tenant A
      const resA = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .set('x-tenant-id', 'tenant-alpha')
        .send({ data: 'A' });

      expect(resA.status).toBe(201);

      // Tenant B uses the same key with different data -> must NOT conflict due to tenant scoping
      const resB = await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .set('x-tenant-id', 'tenant-beta')
        .send({ data: 'B' });

      expect(resB.status).toBe(201);
      expect(handlerMock).toHaveBeenCalledTimes(2);
    });

    it('ignores untrusted caller headers in default scope resolver to prevent spoofing', () => {
      const unauthenticatedReq = {
        headers: { 'x-tenant-id': 'spoofed-tenant-id' },
        user: undefined,
        auth: undefined
      } as unknown as express.Request;

      // Unauthenticated caller cannot hijack another tenant's scope by sending custom headers
      expect(defaultScopeResolver(unauthenticatedReq)).toBe('unauthenticated');

      const authenticatedReq = {
        headers: {},
        user: { tenantId: 'real-trusted-tenant' }
      } as unknown as express.Request;

      expect(defaultScopeResolver(authenticatedReq)).toBe('tenant:real-trusted-tenant');
    });
  });

  describe('Key expiration', () => {
    it('allows re-execution after key retention TTL expires', async () => {
      // 1-second retention TTL
      const { app, handlerMock } = createTestApp({ required: true, retentionTtlSec: 1 });
      const idempotencyKey = 'expiring-key';

      await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send({ item: 'data' });

      expect(handlerMock).toHaveBeenCalledOnce();

      // Wait 1.1s for expiration
      await new Promise((r) => setTimeout(r, 1100));

      // Re-send same key and body after expiration -> should re-execute
      await request(app)
        .post('/test-resource')
        .set('Idempotency-Key', idempotencyKey)
        .send({ item: 'data' });

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
        baseUrl: '/api/v1',
        path: '/sources',
        query: { kind: 'hotspots', provider: 'NASA' },
        body: { name: 'Fire', count: 10, nested: { b: 2, a: 1 } }
      } as unknown as express.Request;

      const req2 = {
        method: 'POST',
        baseUrl: '/api/v1',
        path: '/sources',
        query: { provider: 'NASA', kind: 'hotspots' },
        body: { count: 10, name: 'Fire', nested: { a: 1, b: 2 } }
      } as unknown as express.Request;

      expect(computePayloadHash(req1)).toBe(computePayloadHash(req2));
    });

    it('produces different hashes when query parameters or body values differ', () => {
      const reqBase = {
        method: 'POST',
        baseUrl: '',
        path: '/sources',
        query: { limit: '10' },
        body: { active: true }
      } as unknown as express.Request;

      const reqDiffQuery = {
        method: 'POST',
        baseUrl: '',
        path: '/sources',
        query: { limit: '20' },
        body: { active: true }
      } as unknown as express.Request;

      const reqDiffBody = {
        method: 'POST',
        baseUrl: '',
        path: '/sources',
        query: { limit: '10' },
        body: { active: false }
      } as unknown as express.Request;

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

      const app = express();
      app.use(express.json());
      app.post(
        '/critical-endpoint',
        idempotency({ store: failingStore, required: true, onStoreError: 'fail_closed' }),
        (_req, res) => res.status(200).json({ ok: true })
      );
      app.use(errorHandler);

      const res = await request(app)
        .post('/critical-endpoint')
        .set('Idempotency-Key', 'idemp-fail-1')
        .send({ data: 1 });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.message).not.toContain('Connection refused');
    });

    it('bypasses idempotency without failing when route explicitly opts into bypass on failure', async () => {
      const failingStore = {
        acquire: vi.fn().mockRejectedValue(new Error('Redis cluster down')),
        complete: vi.fn(),
        release: vi.fn()
      };

      const app = express();
      app.use(express.json());
      const handler = vi.fn((_req, res) => res.status(200).json({ executed: true }));

      app.post(
        '/optional-endpoint',
        idempotency({ store: failingStore, required: false, onStoreError: 'bypass' }),
        handler
      );
      app.use(errorHandler);

      const res = await request(app)
        .post('/optional-endpoint')
        .set('Idempotency-Key', 'idemp-bypass-1')
        .send({ data: 1 });

      expect(res.status).toBe(200);
      expect(res.body.executed).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('Response Replay Header Filtering & Non-JSON Handling', () => {
    it('filters out hop-by-hop and sensitive headers during replay while preserving contract headers', () => {
      const mockRes = {
        getHeaders: () => ({
          'content-type': 'application/json',
          etag: '"abc123"',
          'set-cookie': 'session=secret123',
          connection: 'keep-alive',
          'x-request-id': 'req-xyz'
        })
      } as unknown as express.Response;

      const safe = getSafeReplayHeaders(mockRes);
      expect(safe['content-type']).toBe('application/json');
      expect(safe.etag).toBe('"abc123"');
      expect(safe['set-cookie']).toBeUndefined();
      expect(safe.connection).toBeUndefined();
      expect(safe['x-request-id']).toBeUndefined();
    });

    it('replays plain text and binary buffer responses accurately', async () => {
      const app = express();
      app.use(express.json());

      let callCount = 0;
      app.post(
        '/text-endpoint',
        idempotency({ store, required: true }),
        (_req, res) => {
          callCount++;
          res.setHeader('Content-Type', 'text/plain');
          res.status(200).send(`Plain text execution #${callCount}`);
        }
      );
      app.use(errorHandler);

      // First call
      const res1 = await request(app)
        .post('/text-endpoint')
        .set('Idempotency-Key', 'text-key-1');

      expect(res1.status).toBe(200);
      expect(res1.text).toBe('Plain text execution #1');

      // Replay
      const res2 = await request(app)
        .post('/text-endpoint')
        .set('Idempotency-Key', 'text-key-1');

      expect(res2.status).toBe(200);
      expect(res2.text).toBe('Plain text execution #1');
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

      const app = express();
      app.use(express.json());
      app.post(
        '/bg-complete-fail',
        idempotency({ store: rejectingStore, required: true }),
        (_req, res) => res.status(201).json({ created: true })
      );
      app.use(errorHandler);

      const res = await request(app)
        .post('/bg-complete-fail')
        .set('Idempotency-Key', 'bg-key-complete-1')
        .send({ foo: 'bar' });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
      expect(rejectingStore.complete).toHaveBeenCalledOnce();
    });

    it('safely handles background store.release rejection without unhandled rejection', async () => {
      const rejectingStore = {
        acquire: vi.fn().mockResolvedValue({ acquired: true }),
        complete: vi.fn(),
        release: vi.fn().mockRejectedValue(new Error('Redis failed to release lock'))
      };

      const app = express();
      app.use(express.json());
      app.post(
        '/bg-release-fail',
        idempotency({ store: rejectingStore, required: true }),
        (_req, _res, next) => next(new Error('Simulated internal server crash'))
      );
      app.use(errorHandler);

      const res = await request(app)
        .post('/bg-release-fail')
        .set('Idempotency-Key', 'bg-key-release-1')
        .send({ foo: 'bar' });

      expect(res.status).toBe(500);
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

      const app = express();
      app.use(express.json());
      app.post(
        '/timer-cleanup-endpoint',
        idempotency({
          store: testStore,
          required: true,
          enableLeaseRenewal: true,
          lockTtlMs: 200,
          leaseRenewalIntervalMs: 50
        }),
        (_req, res) => {
          setTimeout(() => {
            res.status(200).json({ done: true });
          }, 80);
        }
      );
      app.use(errorHandler);

      const res = await request(app)
        .post('/timer-cleanup-endpoint')
        .set('Idempotency-Key', 'timer-key-1');

      expect(res.status).toBe(200);
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

      const app = express();
      app.use(express.json());
      app.post(
        '/renew-fail-endpoint',
        idempotency({
          store: testStore,
          required: true,
          enableLeaseRenewal: true,
          lockTtlMs: 100,
          leaseRenewalIntervalMs: 20
        }),
        (_req, res) => {
          setTimeout(() => {
            res.status(200).json({ done: true });
          }, 60);
        }
      );
      app.use(errorHandler);

      const res = await request(app)
        .post('/renew-fail-endpoint')
        .set('Idempotency-Key', 'renew-fail-key-1');

      expect(res.status).toBe(200);
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
