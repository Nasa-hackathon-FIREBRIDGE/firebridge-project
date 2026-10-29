import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply, RouteShorthandOptions } from 'fastify';
import { redis, ensureRedisConnected } from '../config/redis.js';
import { logger } from '../config/logger.js';
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  MissingIdempotencyKeyError,
  ServiceUnavailableError
} from '../errors/app-error.js';

// ---------------------------------------------------------------------------
// Lua Scripts for Atomic Redis Operations
// ---------------------------------------------------------------------------

const RELEASE_LUA_SCRIPT = `
local current = redis.call('get', KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if decoded.status == 'in_progress' and decoded.ownerToken == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

const COMPLETE_LUA_SCRIPT = `
local current = redis.call('get', KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if decoded.status == 'in_progress' and decoded.ownerToken == ARGV[1] then
  redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
else
  return 0
end
`;

const RENEW_LUA_SCRIPT = `
local current = redis.call('get', KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if decoded.status == 'in_progress' and decoded.ownerToken == ARGV[1] then
  redis.call('pexpire', KEYS[1], ARGV[2])
  return 1
else
  return 0
end
`;

// ---------------------------------------------------------------------------
// Types & Record Contracts
// ---------------------------------------------------------------------------

export interface InProgressIdempotencyRecord {
  status: 'in_progress';
  ownerToken: string;
  payloadHash: string;
  createdAt: number;
}

export interface ResponsePayloadRecord {
  bodyType: 'json' | 'text' | 'buffer';
  body?: unknown;
  base64?: string;
}

export interface CompletedIdempotencyRecord {
  status: 'completed';
  payloadHash: string;
  statusCode: number;
  body: unknown;
  responsePayload?: ResponsePayloadRecord;
  headers?: Record<string, string>;
  createdAt: number;
}

export type IdempotencyRecord = InProgressIdempotencyRecord | CompletedIdempotencyRecord;

export interface IdempotencyStore {
  acquire(
    key: string,
    payloadHash: string,
    lockTtlMs: number,
    ownerToken: string
  ): Promise<{ acquired: true } | { acquired: false; record?: IdempotencyRecord }>;

  complete(
    key: string,
    ownerToken: string,
    payloadHash: string,
    statusCode: number,
    body: unknown,
    headers: Record<string, string>,
    retentionTtlSec: number,
    responsePayload?: ResponsePayloadRecord
  ): Promise<boolean>;

  release(key: string, ownerToken: string): Promise<boolean>;

  renewLease?(key: string, ownerToken: string, extensionTtlMs: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Redis Idempotency Store (Production-grade, distributed)
// ---------------------------------------------------------------------------

export class RedisIdempotencyStore implements IdempotencyStore {
  async acquire(
    key: string,
    payloadHash: string,
    lockTtlMs: number,
    ownerToken: string
  ): Promise<{ acquired: true } | { acquired: false; record?: IdempotencyRecord }> {
    await ensureRedisConnected();

    const initialRecord: InProgressIdempotencyRecord = {
      status: 'in_progress',
      ownerToken,
      payloadHash,
      createdAt: Date.now()
    };

    const result = await redis.set(key, JSON.stringify(initialRecord), 'PX', lockTtlMs, 'NX');

    if (result === 'OK') {
      return { acquired: true };
    }

    const existing = await redis.get(key);
    if (!existing) {
      // Lock expired between set and get; retry atomic set once
      const retry = await redis.set(key, JSON.stringify(initialRecord), 'PX', lockTtlMs, 'NX');
      if (retry === 'OK') {
        return { acquired: true };
      }
      return { acquired: false };
    }

    try {
      const record = JSON.parse(existing) as IdempotencyRecord;
      return { acquired: false, record };
    } catch {
      return { acquired: false };
    }
  }

  async complete(
    key: string,
    ownerToken: string,
    payloadHash: string,
    statusCode: number,
    body: unknown,
    headers: Record<string, string>,
    retentionTtlSec: number,
    responsePayload?: ResponsePayloadRecord
  ): Promise<boolean> {
    await ensureRedisConnected();

    const completedRecord: CompletedIdempotencyRecord = {
      status: 'completed',
      payloadHash,
      statusCode,
      body,
      responsePayload,
      headers,
      createdAt: Date.now()
    };

    const result = await redis.eval(
      COMPLETE_LUA_SCRIPT,
      1,
      key,
      ownerToken,
      JSON.stringify(completedRecord),
      retentionTtlSec.toString()
    );

    return result === 1;
  }

  async release(key: string, ownerToken: string): Promise<boolean> {
    await ensureRedisConnected();
    const result = await redis.eval(RELEASE_LUA_SCRIPT, 1, key, ownerToken);
    return result === 1;
  }

  async renewLease(key: string, ownerToken: string, extensionTtlMs: number): Promise<boolean> {
    await ensureRedisConnected();
    const result = await redis.eval(
      RENEW_LUA_SCRIPT,
      1,
      key,
      ownerToken,
      extensionTtlMs.toString()
    );
    return result === 1;
  }
}

// ---------------------------------------------------------------------------
// In-Memory Idempotency Store (Strictly for unit testing & single-process dev)
// ---------------------------------------------------------------------------

/**
 * InMemoryIdempotencyStore is strictly intended for local automated testing
 * and single-process development environments.
 *
 * CAUTION: It maintains an in-process Map and DOES NOT synchronize state across
 * multiple instances or worker processes. Using this store in a distributed
 * production deployment will allow duplicate concurrent executions across pods/nodes.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      // In production, log a stern configuration warning
      // (does not crash process to allow mock-based testing in CI if NODE_ENV=production is set)
      console.warn(
        '[SECURITY WARNING] InMemoryIdempotencyStore instantiated in production mode. Use RedisIdempotencyStore across multiple API instances.'
      );
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt <= now) {
        this.store.delete(k);
      }
    }
  }

  async acquire(
    key: string,
    payloadHash: string,
    lockTtlMs: number,
    ownerToken: string
  ): Promise<{ acquired: true } | { acquired: false; record?: IdempotencyRecord }> {
    this.sweepExpired();
    const existing = this.store.get(key);

    if (!existing) {
      const record: InProgressIdempotencyRecord = {
        status: 'in_progress',
        ownerToken,
        payloadHash,
        createdAt: Date.now()
      };
      this.store.set(key, { record, expiresAt: Date.now() + lockTtlMs });
      return { acquired: true };
    }

    return { acquired: false, record: existing.record };
  }

  async complete(
    key: string,
    ownerToken: string,
    payloadHash: string,
    statusCode: number,
    body: unknown,
    headers: Record<string, string>,
    retentionTtlSec: number,
    responsePayload?: ResponsePayloadRecord
  ): Promise<boolean> {
    this.sweepExpired();
    const existing = this.store.get(key);
    if (!existing) {
      return false;
    }

    if (
      existing.record.status !== 'in_progress' ||
      (existing.record as InProgressIdempotencyRecord).ownerToken !== ownerToken
    ) {
      // Expired or acquired by another owner token; do NOT overwrite!
      return false;
    }

    const record: CompletedIdempotencyRecord = {
      status: 'completed',
      payloadHash,
      statusCode,
      body,
      responsePayload,
      headers,
      createdAt: Date.now()
    };
    this.store.set(key, { record, expiresAt: Date.now() + retentionTtlSec * 1000 });
    return true;
  }

  async release(key: string, ownerToken: string): Promise<boolean> {
    this.sweepExpired();
    const existing = this.store.get(key);
    if (!existing) {
      return false;
    }

    if (
      existing.record.status === 'in_progress' &&
      (existing.record as InProgressIdempotencyRecord).ownerToken === ownerToken
    ) {
      this.store.delete(key);
      return true;
    }

    return false;
  }

  async renewLease(key: string, ownerToken: string, extensionTtlMs: number): Promise<boolean> {
    this.sweepExpired();
    const existing = this.store.get(key);
    if (!existing) {
      return false;
    }

    if (
      existing.record.status === 'in_progress' &&
      (existing.record as InProgressIdempotencyRecord).ownerToken === ownerToken
    ) {
      existing.expiresAt = Date.now() + extensionTtlMs;
      return true;
    }

    return false;
  }

  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Middleware Options & Configuration
// ---------------------------------------------------------------------------

export type StoreErrorPolicy = 'fail_closed' | 'bypass';

export interface IdempotencyOptions {
  /**
   * Whether the Idempotency-Key header is strictly required. Default: false.
   */
  required?: boolean;

  /**
   * Maximum processing lock lease duration in milliseconds. Default: 15,000 ms.
   */
  lockTtlMs?: number;

  /**
   * Duration in seconds to retain completed responses for replaying. Default: 86,400 (24h).
   */
  retentionTtlSec?: number;

  /**
   * Whether to periodically extend the lock lease during long operations. Default: false.
   */
  enableLeaseRenewal?: boolean;

  /**
   * Interval in milliseconds for lease extension heartbeats. Default: lockTtlMs / 2.
   */
  leaseRenewalIntervalMs?: number;

  /**
   * Backing storage implementation. Defaults to RedisIdempotencyStore.
   */
  store?: IdempotencyStore;

  /**
   * Custom trusted scope provider.
   * Security: Untrusted client headers must NOT be used directly without authentication validation.
   */
  getScope?: (req: FastifyRequest) => string;

  /**
   * Error policy when the idempotency store cannot be reached.
   * - 'fail_closed' (default): Fails with HTTP 503 Service Unavailable.
   * - 'bypass': Logs a warning and continues without idempotency (only permitted if explicitly chosen on non-critical routes).
   */
  onStoreError?: StoreErrorPolicy;
}

const defaultRedisStore = new RedisIdempotencyStore();

// ---------------------------------------------------------------------------
// Canonical Request Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Recursively canonicalizes objects by sorting keys lexicographically.
 * Ensures that equivalent JSON payloads with varying key order produce identical hashes.
 */
export function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObj: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    sortedObj[key] = canonicalize(record[key]);
  }

  return sortedObj;
}

/**
 * Computes an unambiguous SHA-256 fingerprint of the request.
 * Encodes the method, route, canonicalized query params, and canonicalized body
 * into a structured JSON envelope, avoiding string boundary concatenation ambiguities.
 */
export function computePayloadHash(req: {
  method: string;
  url?: string;
  baseUrl?: string;
  path?: string;
  query?: unknown;
  body?: unknown;
}): string {
  const normalizedMethod = req.method.toUpperCase();
  const normalizedRoute = (
    req.url?.split('?')[0] ?? (req.baseUrl ?? '') + (req.path ?? '')
  ).toLowerCase();
  const canonicalQuery = canonicalize(req.query ?? {});
  const canonicalBody = canonicalize(req.body ?? {});

  const fingerprintEnvelope = {
    method: normalizedMethod,
    route: normalizedRoute,
    query: canonicalQuery,
    body: canonicalBody
  };

  return createHash('sha256').update(JSON.stringify(fingerprintEnvelope)).digest('hex');
}

// ---------------------------------------------------------------------------
// Header Validation & Scoping
// ---------------------------------------------------------------------------

export function validateIdempotencyKeyFormat(rawKey: unknown): string {
  if (typeof rawKey !== 'string') {
    throw new InvalidIdempotencyKeyError('Idempotency-Key must be a string.');
  }

  const key = rawKey.trim();
  if (key.length === 0 || key.length > 256) {
    throw new InvalidIdempotencyKeyError(
      'Idempotency-Key must be between 1 and 256 characters in length.'
    );
  }

  // Allow printable ASCII characters without control characters
  if (!/^[\x21-\x7E]+$/.test(key)) {
    throw new InvalidIdempotencyKeyError('Idempotency-Key contains invalid characters.');
  }

  return key;
}

/**
 * Resolves the partition scope for an idempotency key.
 *
 * Security Guarantee:
 * Unauthenticated callers cannot spoof arbitrary client/tenant identifiers via headers.
 * If req.user is set (authenticated session), the user or tenant ID is trusted.
 * Otherwise, the request falls back to the isolated 'unauthenticated' scope partition.
 */
export function defaultScopeResolver(req: FastifyRequest): string {
  const user = (req as { user?: { tenantId?: string; id?: string } }).user;
  if (user?.tenantId) {
    return `tenant:${user.tenantId}`;
  }
  if (user?.id) {
    return `user:${user.id}`;
  }

  const auth = (req as { auth?: { tenantId?: string; sub?: string } }).auth;
  if (auth?.tenantId) {
    return `tenant:${auth.tenantId}`;
  }
  if (auth?.sub) {
    return `user:${auth.sub}`;
  }

  return 'unauthenticated';
}

// ---------------------------------------------------------------------------
// Safe Header Filtering for Response Replay
// ---------------------------------------------------------------------------

const STRIPPED_REPLAY_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'cookie',
  'date',
  'authorization',
  'x-request-id',
  'idempotent-replayed'
]);

export function getSafeReplayHeaders(
  res: Pick<FastifyReply, 'getHeaders'>
): Record<string, string> {
  const safeHeaders: Record<string, string> = {};
  const rawHeaders = res.getHeaders();

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lowerKey = key.toLowerCase();
    if (!STRIPPED_REPLAY_HEADERS.has(lowerKey) && value !== undefined) {
      safeHeaders[lowerKey] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  return safeHeaders;
}

// ---------------------------------------------------------------------------
// Idempotency Middleware Factory
// ---------------------------------------------------------------------------

export function idempotency(options: IdempotencyOptions = {}): RouteShorthandOptions {
  const {
    required = false,
    lockTtlMs = 15000,
    retentionTtlSec = 86400,
    enableLeaseRenewal = false,
    leaseRenewalIntervalMs = Math.max(1, Math.floor(lockTtlMs / 2)),
    store = defaultRedisStore,
    getScope = defaultScopeResolver,
    onStoreError = 'fail_closed'
  } = options;
  type State = {
    key: string;
    owner: string;
    hash: string;
    finished: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
  const states = new WeakMap<FastifyRequest, State>();
  function stop(state: State) {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }
  async function release(state: State) {
    if (state.finished) return;
    state.finished = true;
    stop(state);
    try {
      await store.release(state.key, state.owner);
    } catch {
      logger.warn('Failed to release idempotency lock');
    }
  }
  return {
    async preHandler(request, reply) {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
      const header = request.headers['idempotency-key'];
      if (!header) {
        if (required) throw new MissingIdempotencyKeyError();
        return;
      }
      const key = validateIdempotencyKeyFormat(header);
      const scope = getScope(request).trim() || 'unauthenticated';
      const path = request.url.split('?')[0];
      const storageKey = `idempotency:${scope}:${request.method.toUpperCase()}:${path}:${key}`;
      const hash = computePayloadHash(request);
      const owner = randomUUID();
      let result: Awaited<ReturnType<IdempotencyStore['acquire']>>;
      try {
        result = await store.acquire(storageKey, hash, lockTtlMs, owner);
      } catch {
        if (!required && onStoreError === 'bypass') {
          request.log.warn('Idempotency store unavailable; optional route explicitly bypasses it');
          return;
        }
        throw new ServiceUnavailableError(
          'Idempotency service is currently unavailable. Please retry shortly.'
        );
      }
      if (!result.acquired) {
        const record = result.record;
        if (!record || record.status === 'in_progress') {
          reply.header('Retry-After', '2');
          throw new IdempotencyConflictError(
            'A request with this idempotency key is currently in progress.'
          );
        }
        if (record.payloadHash !== hash) {
          throw new IdempotencyConflictError(
            'Idempotency-Key was already used with a different request payload.'
          );
        }
        for (const [name, value] of Object.entries(record.headers ?? {})) reply.header(name, value);
        reply.header('Idempotent-Replayed', 'true').status(record.statusCode);
        if (record.responsePayload?.bodyType === 'buffer')
          return reply.send(Buffer.from(record.responsePayload.base64 ?? '', 'base64'));
        if (record.responsePayload?.bodyType === 'text')
          return reply.send(record.responsePayload.body);
        const body =
          record.body && typeof record.body === 'object' && 'request_id' in record.body
            ? { ...record.body, request_id: request.id }
            : record.body;
        return reply.send(body);
      }
      const state: State = { key: storageKey, owner, hash, finished: false };
      states.set(request, state);
      reply.raw.once('close', () => {
        if (!reply.raw.writableEnded) void release(state);
      });
      if (enableLeaseRenewal && store.renewLease) {
        state.timer = setInterval(() => {
          if (!state.finished) {
            void store.renewLease!(state.key, state.owner, lockTtlMs)
              .then((renewed) => {
                if (!renewed) logger.warn('Idempotency lease was lost');
              })
              .catch(() => logger.warn('Failed to renew idempotency lease'));
          }
        }, leaseRenewalIntervalMs);
        state.timer.unref();
      }
    },
    async onSend(request, reply, payload) {
      const state = states.get(request);
      if (!state || state.finished) return payload;
      if (
        reply.statusCode >= 500 ||
        (payload !== null && typeof payload !== 'string' && !Buffer.isBuffer(payload))
      ) {
        await release(state);
        return payload;
      }
      state.finished = true;
      stop(state);
      let body: unknown = payload;
      let representation: ResponsePayloadRecord;
      if (Buffer.isBuffer(payload))
        representation = { bodyType: 'buffer', base64: payload.toString('base64') };
      else if (
        typeof payload === 'string' &&
        String(reply.getHeader('content-type')).includes('json')
      ) {
        try {
          body = JSON.parse(payload);
        } catch {
          /* Preserve the serialized response. */
        }
        representation = { bodyType: 'json', body };
      } else representation = { bodyType: 'text', body: payload };
      try {
        const persisted = await store.complete(
          state.key,
          state.owner,
          state.hash,
          reply.statusCode,
          body,
          getSafeReplayHeaders(reply),
          retentionTtlSec,
          representation
        );
        if (!persisted)
          logger.warn('Idempotency completion rejected: lease expired or changed owner');
      } catch {
        logger.warn('Failed to persist completed idempotency record');
      }
      return payload;
    },
    async onResponse(request) {
      const state = states.get(request);
      if (state) {
        stop(state);
        if (!state.finished) await release(state);
      }
    },
    async onTimeout(request) {
      const state = states.get(request);
      if (state) await release(state);
    }
  };
}
