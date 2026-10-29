import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
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
  getScope?: (req: Request) => string;

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
export function computePayloadHash(req: Request): string {
  const normalizedMethod = req.method.toUpperCase();
  const normalizedRoute = (req.baseUrl + req.path).toLowerCase();
  const canonicalQuery = canonicalize(req.query ?? {});
  const canonicalBody = canonicalize(req.body ?? {});

  const fingerprintEnvelope = {
    method: normalizedMethod,
    route: normalizedRoute,
    query: canonicalQuery,
    body: canonicalBody
  };

  return createHash('sha256')
    .update(JSON.stringify(fingerprintEnvelope))
    .digest('hex');
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
export function defaultScopeResolver(req: Request): string {
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

export function getSafeReplayHeaders(res: Response): Record<string, string> {
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

export function idempotency(options: IdempotencyOptions = {}) {
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

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only apply to mutating HTTP methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }

    const rawHeader = req.headers['idempotency-key'];

    if (!rawHeader) {
      if (required) {
        next(new MissingIdempotencyKeyError());
        return;
      }
      next();
      return;
    }

    let key: string;
    try {
      key = validateIdempotencyKeyFormat(rawHeader);
    } catch (err) {
      next(err);
      return;
    }

    const rawScope = getScope(req);
    const scope = rawScope.trim() || 'unauthenticated';
    const storageKey = `idempotency:${scope}:${req.method.toUpperCase()}:${req.baseUrl}${req.path}:${key}`;
    const payloadHash = computePayloadHash(req);
    const ownerToken = randomUUID();

    let acquireResult: { acquired: true } | { acquired: false; record?: IdempotencyRecord };
    try {
      acquireResult = await store.acquire(storageKey, payloadHash, lockTtlMs, ownerToken);
    } catch (error) {
      if (!required && onStoreError === 'bypass') {
        req.app?.locals?.logger?.warn?.(
          { error },
          'Idempotency store is unreachable; bypassing idempotency as explicitly configured for optional route.'
        );
        next();
        return;
      }
      next(
        new ServiceUnavailableError(
          'Idempotency service is currently unavailable. Please retry shortly.'
        )
      );
      return;
    }

    if (!acquireResult.acquired) {
      const record = acquireResult.record;

      if (!record || record.status === 'in_progress') {
        res.setHeader('Retry-After', '2');
        next(
          new IdempotencyConflictError(
            'A request with this idempotency key is currently in progress.'
          )
        );
        return;
      }

      if (record.payloadHash !== payloadHash) {
        next(
          new IdempotencyConflictError(
            'Idempotency-Key was already used with a different request payload.'
          )
        );
        return;
      }

      // Replay identical response safely with contractually relevant headers
      if (record.headers) {
        for (const [headerName, headerVal] of Object.entries(record.headers)) {
          res.setHeader(headerName, headerVal);
        }
      }

      res.setHeader('Idempotent-Replayed', 'true');

      if (record.responsePayload) {
        if (record.responsePayload.bodyType === 'buffer' && record.responsePayload.base64) {
          res.status(record.statusCode).send(Buffer.from(record.responsePayload.base64, 'base64'));
          return;
        }
        if (record.responsePayload.bodyType === 'text') {
          res.status(record.statusCode).send(record.responsePayload.body as string);
          return;
        }
      }

      res.status(record.statusCode ?? 200).json(record.body);
      return;
    }

    // Set up optional lease renewal heartbeat
    let renewalTimer: ReturnType<typeof setInterval> | undefined;
    let timerCleanedUp = false;

    const stopRenewal = () => {
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

    // Intercept response to safely capture and store result upon completion
    let responseBody: unknown = undefined;
    let responsePayload: ResponsePayloadRecord | undefined = undefined;

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body: unknown): Response => {
      responseBody = body;
      responsePayload = { bodyType: 'json', body };
      return originalJson(body);
    };

    res.send = (body: unknown): Response => {
      if (responsePayload === undefined) {
        if (Buffer.isBuffer(body)) {
          responseBody = body;
          responsePayload = {
            bodyType: 'buffer',
            base64: body.toString('base64')
          };
        } else if (typeof body === 'string') {
          try {
            responseBody = JSON.parse(body);
            responsePayload = { bodyType: 'json', body: responseBody };
          } catch {
            responseBody = body;
            responsePayload = { bodyType: 'text', body };
          }
        } else {
          responseBody = body;
          responsePayload = { bodyType: 'json', body };
        }
      }
      return originalSend(body);
    };

    let finalized = false;

    res.on('finish', () => {
      stopRenewal();
      if (finalized) {
        return;
      }
      finalized = true;

      const statusCode = res.statusCode;

      if (statusCode >= 200 && statusCode < 500) {
        const safeHeaders = getSafeReplayHeaders(res);
        store
          .complete(
            storageKey,
            ownerToken,
            payloadHash,
            statusCode,
            responseBody,
            safeHeaders,
            retentionTtlSec,
            responsePayload
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
        // Unhandled 5xx or server crash: release the lock atomically so client can retry
        store
          .release(storageKey, ownerToken)
          .catch((error: unknown) => {
            logger.warn(
              { err: error instanceof Error ? error.message : 'Unknown error' },
              'Failed to release idempotency lock in background'
            );
          });
      }
    });

    res.on('close', () => {
      stopRenewal();
      if (finalized) {
        return;
      }
      finalized = true;

      if (!res.writableEnded) {
        store
          .release(storageKey, ownerToken)
          .catch((error: unknown) => {
            logger.warn(
              { err: error instanceof Error ? error.message : 'Unknown error' },
              'Failed to release idempotency lock on premature connection close'
            );
          });
      }
    });

    next();
  };
}
