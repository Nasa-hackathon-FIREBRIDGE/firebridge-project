import { createHash, randomUUID } from 'node:crypto';
import type {
  FastifyRequest,
  onResponseAsyncHookHandler,
  onSendAsyncHookHandler,
  preHandlerAsyncHookHandler
} from 'fastify';
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
    const result = await redis.eval(RENEW_LUA_SCRIPT, 1, key, ownerToken, extensionTtlMs.toString());
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
 * Equivalent of Express's req.baseUrl + req.path: the URL path without the query string.
 */
function getRequestPath(req: FastifyRequest): string {
  return req.url.split('?')[0] ?? '';
}

/**
 * Computes an unambiguous SHA-256 fingerprint of the request.
 * Encodes the method, route, canonicalized query params, and canonicalized body
 * into a structured JSON envelope, avoiding string boundary concatenation ambiguities.
 */
export function computePayloadHash(req: FastifyRequest): string {
  const fingerprintEnvelope = {
    method: req.method.toUpperCase(),
    route: getRequestPath(req).toLowerCase(),
    query: canonicalize(req.query ?? {}),
    body: canonicalize(req.body ?? {})
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
 *
 * NOTE: the authentication hook MUST run before this route-level preHandler
 * (e.g. a global onRequest hook), otherwise every key lands in 'unauthenticated'.
 */
export function defaultScopeResolver(req: FastifyRequest): string {
  const user = (req as unknown as { user?: { tenantId?: string; id?: string } }).user;
  if (user?.tenantId) {
    return `tenant:${user.tenantId}`;
  }
  if (user?.id) {
    return `user:${user.id}`;
  }

  const auth = (req as unknown as { auth?: { tenantId?: string; sub?: string } }).auth;
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
  'idempotent-replayed',
  'content-length' // added: Fastify recomputes it on send
]);

export function getSafeReplayHeaders(
  rawHeaders: Record<string, number | string | string[] | undefined>
): Record<string, string> {
  const safeHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lowerKey = key.toLowerCase();
    if (!STRIPPED_REPLAY_HEADERS.has(lowerKey) && value !== undefined) {
      safeHeaders[lowerKey] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  return safeHeaders;
}

// ---------------------------------------------------------------------------
// Idempotency Hooks Factory (Fastify-native)
// ---------------------------------------------------------------------------

interface IdempotencyState {
  storageKey: string;
  ownerToken: string;
  payloadHash: string;
  responseBody: unknown;
  responsePayload?: ResponsePayloadRecord;
  capturable: boolean;
  finalized: boolean;
  stopRenewal: () => void;
}

export interface IdempotencyHooks {
  preHandler: preHandlerAsyncHookHandler;
  onSend: onSendAsyncHookHandler;
  onResponse: onResponseAsyncHookHandler;
}

/**
 * Usage (route level):
 *   fastify.post('/', { ...idempotency({ required: false }) }, handler);
 */
export function idempotency(options: IdempotencyOptions = {}): IdempotencyHooks {
  const {
    required = false,
    lockTtlMs = 15_000,
    retentionTtlSec = 86_400,
    enableLeaseRenewal = false,
    leaseRenewalIntervalMs = Math.floor(lockTtlMs / 2),
    store = defaultRedisStore,
    getScope = defaultScopeResolver,
    onStoreError = 'fail_closed'
  } = options;

  const states = new WeakMap<FastifyRequest, IdempotencyState>();

  const releaseLock = (state: IdempotencyState, message: string): void => {
    store.release(state.storageKey, state.ownerToken).catch((error: unknown) => {
      logger.warn({ err: error instanceof Error ? error.message : 'Unknown error' }, message);
    });
  };

  const preHandler: preHandlerAsyncHookHandler = async (req, reply) => {
    // Only apply to mutating HTTP methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return;
    }

    const rawHeader = req.headers['idempotency-key'];

    if (!rawHeader) {
      if (required) {
        throw new MissingIdempotencyKeyError();
      }
      return;
    }

    const key = validateIdempotencyKeyFormat(rawHeader); // throws InvalidIdempotencyKeyError

    const scope = getScope(req).trim() || 'unauthenticated';
    const storageKey = `idempotency:${scope}:${req.method.toUpperCase()}:${getRequestPath(req)}:${key}`;
    const payloadHash = computePayloadHash(req);
    const ownerToken = randomUUID();

    let acquireResult: { acquired: true } | { acquired: false; record?: IdempotencyRecord };
    try {
      acquireResult = await store.acquire(storageKey, payloadHash, lockTtlMs, ownerToken);
    } catch (error) {
      if (!required && onStoreError === 'bypass') {
        req.log.warn(
          { error },
          'Idempotency store is unreachable; bypassing idempotency as explicitly configured for optional route.'
        );
        return;
      }
      throw new ServiceUnavailableError(
        'Idempotency service is currently unavailable. Please retry shortly.'
      );
    }

    if (!acquireResult.acquired) {
      const record = acquireResult.record;

      if (!record || record.status === 'in_progress') {
        reply.header('Retry-After', '2');
        throw new IdempotencyConflictError(
          'A request with this idempotency key is currently in progress.'
        );
      }

      if (record.payloadHash !== payloadHash) {
        throw new IdempotencyConflictError(
          'Idempotency-Key was already used with a different request payload.'
        );
      }

      // Replay identical response with contractually relevant headers.
      // No state is registered, so onSend/onResponse are no-ops for replays.
      if (record.headers) {
        for (const [headerName, headerVal] of Object.entries(record.headers)) {
          reply.header(headerName, headerVal);
        }
      }

      reply.header('Idempotent-Replayed', 'true');
      reply.code(record.statusCode ?? 200);

      const payload = record.responsePayload;
      if (payload?.bodyType === 'buffer' && payload.base64) {
        return reply.send(Buffer.from(payload.base64, 'base64'));
      }
      if (payload?.bodyType === 'text') {
        return reply.send(payload.body as string);
      }
      if (record.body === undefined) {
        return reply.send();
      }
      if (!reply.hasHeader('content-type')) {
        reply.type('application/json; charset=utf-8');
      }
      return reply.send(JSON.stringify(record.body));
    }

    // Set up optional lease renewal heartbeat
    let renewalTimer: ReturnType<typeof setInterval> | undefined;
    let timerCleanedUp = false;

    const stopRenewal = (): void => {
      if (timerCleanedUp) {
        return;
      }
      timerCleanedUp = true;
      if (renewalTimer) {
        clearInterval(renewalTimer);
        renewalTimer = undefined;
      }
    };

    if (enableLeaseRenewal && store.renewLease) {
      renewalTimer = setInterval(() => {
        if (timerCleanedUp) {
          return;
        }
        store
          .renewLease?.(storageKey, ownerToken, lockTtlMs)
          ?.then((renewed) => {
            if (renewed === false) {
              logger.warn(
                'Idempotency lease could not be renewed (lock expired or acquired by another owner)'
              );
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: error instanceof Error ? error.message : 'Unknown error' },
              'Failed to renew idempotency lease in background'
            );
          });
      }, leaseRenewalIntervalMs);
      renewalTimer.unref?.();
    }

    const state: IdempotencyState = {
      storageKey,
      ownerToken,
      payloadHash,
      responseBody: undefined,
      responsePayload: undefined,
      capturable: true,
      finalized: false,
      stopRenewal
    };
    states.set(req, state);

    // Premature connection close: release the lock (equivalent of res.on('close')).
    reply.raw.once('close', () => {
      state.stopRenewal();
      if (state.finalized) {
        return;
      }
      state.finalized = true;

      if (!reply.raw.writableEnded) {
        releaseLock(state, 'Failed to release idempotency lock on premature connection close');
      }
    });
  };

  // Captures the serialized body (replaces the res.json / res.send interception).
  const onSend: onSendAsyncHookHandler = async (req, _reply, payload) => {
    const state = states.get(req);
    if (!state) {
      return payload;
    }

    if (payload === null || payload === undefined) {
      state.responseBody = undefined;
      state.responsePayload = { bodyType: 'json', body: undefined };
    } else if (Buffer.isBuffer(payload)) {
      state.responseBody = payload;
      state.responsePayload = { bodyType: 'buffer', base64: payload.toString('base64') };
    } else if (typeof payload === 'string') {
      try {
        state.responseBody = JSON.parse(payload);
        state.responsePayload = { bodyType: 'json', body: state.responseBody };
      } catch {
        state.responseBody = payload;
        state.responsePayload = { bodyType: 'text', body: payload };
      }
    } else {
      // Stream or other non-replayable payload.
      state.capturable = false;
    }

    return payload;
  };

  // Finalization (replaces res.on('finish')).
  const onResponse: onResponseAsyncHookHandler = async (req, reply) => {
    const state = states.get(req);
    if (!state) {
      return;
    }

    state.stopRenewal();
    if (state.finalized) {
      return;
    }
    state.finalized = true;

    const statusCode = reply.statusCode;

    if (statusCode >= 200 && statusCode < 500 && state.capturable) {
      store
        .complete(
          state.storageKey,
          state.ownerToken,
          state.payloadHash,
          statusCode,
          state.responseBody,
          getSafeReplayHeaders(reply.getHeaders()),
          retentionTtlSec,
          state.responsePayload
        )
        .then((persisted) => {
          if (!persisted) {
            logger.warn(
              'Idempotency record was not persisted (lock expired or acquired by another owner)'
            );
          }
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: error instanceof Error ? error.message : 'Unknown error' },
            'Failed to persist completed idempotency record in background'
          );
        });
    } else {
      // 5xx or non-replayable body: release the lock atomically so the client can retry
      releaseLock(state, 'Failed to release idempotency lock in background');
    }
  };

  return { preHandler, onSend, onResponse };
}