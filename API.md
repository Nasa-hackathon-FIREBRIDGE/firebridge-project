# FIREBRIDGE API Specification

This document describes the API foundation (Phase 0) and contract for the FIREBRIDGE backend.

---

## 1. API Root and Architecture

- **Base URL:** `/api/v1`
- **Architecture:** Node.js, Express, TypeScript, Prisma ORM (PostgreSQL/PostGIS), Redis.
- **Port:** Configured via `PORT` (default `3000`).

---

## 2. Response Envelope & Error Codes Contract

All endpoints adhere to a standardized JSON envelope contract.

### 2.1 Success Response

```json
{
  "status": "ok",
  "message": "Operation description.",
  "data": { ... }
}
```

For scaffolded endpoints pending implementation:
```json
{
  "status": "planned",
  "message": "This endpoint is scaffolded and not yet implemented.",
  "data": null
}
```

### 2.2 Error Response

Errors include explicit, stable machine-readable error codes (`code`) alongside sanitized, safe public messages (`message`). No SQL statements, internal stack traces, or secret configuration details are ever exposed in public responses.

```json
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "Request could not be processed.",
  "data": null
}
```

### 2.3 Standard Error Codes & HTTP Mapping

| HTTP Status | Error Code | Description |
|---|---|---|
| `400` | `BAD_REQUEST` | General client request malformation. |
| `400` | `VALIDATION_ERROR` | Request body or schema constraint violation. |
| `400` | `INVALID_QUERY` | Query parameter violation or unknown parameter rejected by strict schema. |
| `400` | `INVALID_CURSOR` | Pagination cursor is malformed, has an invalid HMAC signature, or mismatches query filters. |
| `400` | `MISSING_IDEMPOTENCY_KEY` | `Idempotency-Key` header is missing on an endpoint where idempotency is required. |
| `400` | `INVALID_IDEMPOTENCY_KEY` | `Idempotency-Key` format is invalid (must be 1–256 printable ASCII characters). |
| `404` | `NOT_FOUND` | Requested route or domain entity does not exist. |
| `409` | `CONFLICT` | Resource uniqueness violation or duplicate entity. |
| `409` | `IDEMPOTENCY_CONFLICT` | Either: (a) a concurrent request with the same key is already in progress, or (b) the same key was reused with a different request payload. |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded. |
| `503` | `SERVICE_UNAVAILABLE` | Required infrastructure or domain dependency is unreachable or timed out. |
| `500` | `INTERNAL_SERVER_ERROR` | Unhandled server error. Sanitized message returned to client; detailed context logged internally. |

---

## 3. Idempotency (`Idempotency-Key`)

FIREBRIDGE implements robust mutation idempotency via the hardened `idempotency()` middleware.

### 3.1 Contract & Guarantees

1. **Header:** `Idempotency-Key: <unique-token>` (1–256 printable ASCII characters, typically a UUIDv4 or client-generated unique nonce).
2. **Applicable Methods:** Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`).
3. **Atomic Ownership Tokens:**
   - Every lock acquisition generates a cryptographically random `ownerToken` stored in Redis alongside the `in_progress` status.
   - Lock release and completion are executed via atomic Redis Lua scripts (`RELEASE_LUA_SCRIPT` and `COMPLETE_LUA_SCRIPT`).
   - If a request's lock TTL expires and a newer request acquires the key, the stale worker's completion or release is rejected atomically, preventing stale executions from corrupting or overwriting active leases.
4. **Trusted Identity Scoping:**
   - Keys are partitioned per scope: `idempotency:<clientScope>:<METHOD>:<path>:<idempotencyKey>`.
   - By default (`defaultScopeResolver`), only trusted authenticated identities (`req.user.tenantId` / `req.user.id`) are used as scope partitions. Unauthenticated callers cannot spoof arbitrary tenant IDs via headers (`X-Tenant-Id` headers are ignored unless explicitly validated by custom scope resolvers).
5. **Deterministic Request Fingerprinting:**
   - Fingerprints are computed over a structured envelope `{ method, route, query, body }`.
   - Keys in JSON bodies and query parameters are recursively canonicalized (lexicographical key sorting). Two semantically equivalent JSON objects with differing key order produce the exact same SHA-256 hash.
   - Ambiguous boundary concatenation is eliminated.
6. **Conflict Detection:**
   - If the same key is sent while an identical request is still being processed (`in_progress`), the API returns `HTTP 409 Conflict` (`code: IDEMPOTENCY_CONFLICT`) with a `Retry-After: 2` header.
   - If the same key is reused with a *different* request payload, the API returns `HTTP 409 Conflict` (`code: IDEMPOTENCY_CONFLICT`).
7. **Safe Response Replay:**
   - Replays identical HTTP responses with `Idempotent-Replayed: true`.
   - Contractually relevant representation headers (`Content-Type`, `ETag`, `Content-Language`, `Content-Encoding`, `Cache-Control`) are preserved.
   - Hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade`, etc.) and sensitive/transactional headers (`Set-Cookie`, `Authorization`, `X-Request-Id`) are strictly stripped.
   - JSON, plain text, and binary buffer responses are all accurately replayed.
8. **Configurable Store Failure Policy:**
   - `onStoreError: 'fail_closed'` (default): Fails closed with sanitized `HTTP 503 Service Unavailable` (`SERVICE_UNAVAILABLE`) if the store cannot be reached.
   - `onStoreError: 'bypass'`: Permitted only on routes where idempotency is optional and the route contract explicitly opts into bypass during infrastructure outages.
9. **Lease Renewal & Limitations:**
   - Long-running operations can opt in to safe lease renewal via `enableLeaseRenewal: true`.
   - **Important Limitation:** A distributed lock and cache alone *does not guarantee true end-to-end exactly-once business execution* without transactional atomicity in the underlying database (e.g. database-level unique constraints or transactional outbox). A lock prevents concurrent duplicate executions within the lease window and protects against race conditions at the API boundary.
10. **In-Memory Store Limitation:**
    - `InMemoryIdempotencyStore` is provided strictly for unit testing and single-process development. It is NOT safe for multi-instance or clustered production deployments. Distributed deployments must use `RedisIdempotencyStore`.
11. **Endpoint Configuration:** `POST /api/v1/sources` has idempotency mounted in optional mode (`required: false, onStoreError: 'bypass'`).

---

## 4. Cryptographically Signed Cursors

FIREBRIDGE enforces tamper-evident, HMAC-SHA-256 signed pagination cursors.

### 4.1 Format

```text
v1.<base64url_payload>.<base64url_signature>
```

- **Version prefix:** `v1` (enables seamless future format evolution).
- **Payload (`base64url` JSON):**
  ```json
  {
    "v": "v1",
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filters": {
      "kind": "hotspots",
      "provider": "NASA"
    },
    "ts": 1730178000000
  }
  ```
- **Signature (`base64url` HMAC-SHA-256):**
  `HMAC-SHA256(key = PAGINATION_SECRET, message = "v1." + base64url_payload)`

### 4.2 Security & Validation Rules

1. **Timing-Safe Comparison:** Signature verification uses `crypto.timingSafeEqual` to prevent timing side-channel attacks.
2. **Filter Binding:** The cursor securely binds the query filters (`kind`, `provider`). Reusing a cursor generated for `kind=hotspots` in a query requesting `kind=fire_mask` is detected and rejected with `HTTP 400` (`INVALID_CURSOR`).
3. **Tamper Rejection:** Any alteration of the cursor payload or signature immediately triggers `HTTP 400` (`INVALID_CURSOR`).
4. **Length Bounding:** Maximum cursor length is capped at 512 characters.
5. **No Secret Leaks:** Raw identifiers and query parameters in cursors are opaque; no credentials or server internals are embedded.
6. **Sorting Order:** Deterministic pagination is preserved (`ORDER BY id ASC`, with `id > cursor.id`).

---

## 5. Health Endpoints

### 5.1 Liveness: `GET /api/v1/health/live`
- **Access:** Public.
- **Purpose:** Verifies that the Node.js API process is responsive and able to handle event loop ticks.
- **Guarantees:**
  - Zero external I/O (does not query PostgreSQL, Redis, queues, or workers).
  - Deterministic HTTP 200 response.
  - Safe payload containing only `status: "ok"`, `service: "firebridge-api"`, `uptimeMs`, and ISO `timestamp`.

### 5.2 Readiness: `GET /api/v1/health/ready`
- **Access:** Public.
- **Purpose:** Determines whether the API can serve traffic.
- **Guarantees:**
  - **PostgreSQL Connectivity:** Verified via Prisma `$queryRaw` (`SELECT 1`).
  - **Redis Connectivity:** Verified via `pingRedis()` (`PING` expecting `PONG`).
  - **Strict Timeout:** Each check is bounded by a 3,000 ms timeout via `withTimeout()`.
  - **Status Code:** Returns `HTTP 200` only when all required dependencies succeed. Returns `HTTP 503 Service Unavailable` if any required dependency fails or times out.
  - **No Information Leaks:** Sanitized check statuses (`ready` / `unavailable` / `not_checked`). Never leaks connection strings or credentials.

---

## 6. Phase 0 / Phase 1 Integration Contract

The FIREBRIDGE functional specification requires that a published catalogue or release be servable before the service reports complete readiness.

- **Phase 0 Responsibility (Socle):** Provides infrastructure readiness verification (PostgreSQL, Redis), bounds all checks, and defines the integration interface:
  ```typescript
  export interface Phase1ReadinessProvider {
    isCatalogueServable(): Promise<boolean>;
  }
  export function registerPhase1ReadinessProvider(provider: Phase1ReadinessProvider | null): void;
  ```
- **Phase 1 Responsibility (Catalog & Releases):**
  The Phase 1 owner will implement:
  - `GET /catalog`
  - `GET /releases/{release_id}`
  - `GET /updates`
  - Domain models and migrations for Catalog and Releases.
  - Register their `Phase1ReadinessProvider` implementation with `registerPhase1ReadinessProvider(...)`.
- **Current Limitation:** Until the Phase 1 provider is registered, Phase 0 readiness checks PostgreSQL and Redis. The contract is in place and verified by unit tests (`tests/health.service.test.ts`).

---

## 7. Environment Variables Configuration

The following variables must be configured in `.env` (see `.env.example`):

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | enum | `development` | Environment (`development`, `test`, `production`). |
| `PORT` | number | `3000` | HTTP port for the API. |
| `APP_NAME` | string | `firebridge-api` | Identifier used in logs and health responses. |
| `LOG_LEVEL` | enum | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`). |
| `DATABASE_URL` | string (URL) | — | PostgreSQL connection string with protocol `postgres:` or `postgresql:`. |
| `REDIS_URL` | string (URL) | — | Redis connection string with protocol `redis:` or `rediss:`. |
| `CORS_ORIGINS` | string | `""` | Comma-separated list of allowed CORS origins. |
| `PAGINATION_SECRET` | string | (dev fallback) | **Required in production** (min 16 chars). HMAC-SHA256 secret for signed cursors. In production, using the development default throws a startup validation error. |

---

## 8. Verification & Test Commands

Run the full API test suite:
```bash
npm.cmd run test --workspace @firebridge/api
# or via vitest directly:
node_modules\.bin\vitest.cmd run --root apps/api
```

Run TypeScript compilation check:
```bash
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
```

Run the build pipeline:
```bash
npm.cmd run build --workspace @firebridge/api
```

Run ESLint:
```bash
node_modules\.bin\eslint.cmd apps/api/src apps/api/tests
```
