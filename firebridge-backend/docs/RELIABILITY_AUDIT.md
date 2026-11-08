# FIREBRIDGE reliability audit — 2026-11-01

## Scope and evidence before implementation

Reviewed the API analysis service/repository/validator, transactional creation of analyses/components/jobs/events, worker bootstrap, queue connection options, dispatcher, analysis and export processors/repositories, export cleanup, heartbeat/health, shutdown manager, Prisma schema and both active SQL migrations, test infrastructure/configurations, Dockerfiles/Compose, dependency manifests, logging, API security/idempotency/readiness, and the prior repair report. Existing extensive uncommitted work is preserved. The actual HTTP stack is **Fastify**, not Express; changing it is outside this repair.

Lifecycle: POST analysis → repeatable-read SQL transaction creates analysis, components, API job, outbox event → polling dispatcher claims events → deterministic BullMQ ID → analysis worker → processor updates PostgreSQL. Export uses a separate queue and an existing lease-fenced file publication path. Analysis processing currently only evaluates pre-resolved component readiness; it does not ingest or aggregate satellite data.

## Confirmed source defects

| Priority | Finding | Consequence / proposed repair |
|---|---|---|
| Critical | Analysis writes have no state/attempt/lease guards and finalization is split across statements. | Duplicate execution can overwrite completed results; crashes split analysis/job state. Add transactional claims and finalization with attempt fencing. |
| High | No runtime analysis payload validation or binding to the persisted analysis/job. | A forged queue message can update unrelated records. Validate shape and compare identifiers/specification to SQL records before writes. |
| High | Dispatcher claims an entire batch with one lease, processes serially, and updates events by ID alone. | Later events can expire before enqueue; an old owner can acknowledge/reset a newer claim. Claim each event immediately before dispatch and fence acknowledgements by attempt and live lease. |
| High | Queue producers share unlimited request retries with blocking workers. | Redis interruption can hang dispatch and shutdown. Use bounded producer commands and reconnecting worker connections. |
| High | Delivered analysis events are never reconciled against database and Redis state. | Redis loss leaves durable queued jobs stranded indefinitely. Add opt-in, bounded, SQL-coordinated reconciliation. |
| High | Dispatcher retries indefinitely without jitter; analysis jobs have no explicit queue retry policy. | Retry storms or immediate permanent failure. Add bounded retry policies, jitter and exhaustion visibility. |
| High | Compose publishes Redis and PostgreSQL on all host interfaces, uses fixed database credentials, and runs application containers as root. | Exposure/least-privilege gaps. Remove Redis host publication in source; deployment/authentication/role changes require a reviewed infrastructure rollout. |
| Medium | Shutdown swallows the first failure and skips subsequent cleanup; concurrent callers do not share completion. | Resource leaks and false successful exit. Close every resource, share the shutdown promise, report failure. |
| Medium | Missing satellite readiness can still produce a ready analysis. | Incorrect result availability. Treat missing required satellite data as terminal failure. |
| Medium | Heartbeat proves Redis connectivity but not PostgreSQL/dispatcher health; observability is mostly scaffolded. | A healthy process can mask stranded work. Add bounded operational snapshots/counters to worker heartbeat and structured logs. |
| Medium | Existing API calendar-date validation accepts normalized invalid dates; creation cache keys omit optional policies and concurrent cache misses can conflict. | Validation/idempotency concerns; do not change canonical key semantics silently in this worker repair. |

## Incident: facts versus hypotheses

User-supplied evidence: four October 30 jobs are queued/attempt 0/progress 0/completed NULL, their events delivered/attempt 1 with matching job IDs and dedupe keys; Redis container started November 1, named volume created October 26, AOF/RDB enabled. These are supplied observations, not independently reproduced during this audit. Missing BullMQ hashes do **not** prove no execution: successful jobs are removed (`removeOnComplete: true`), and old processing did not atomically finalize SQL.

Confirmed design failure: SQL delivery acknowledgement is treated as permanent queue durability, with no database-driven recovery. Plausible historical triggers include lost/unflushed persistence, loading a different data directory/DB/queue/prefix, restore/reset, eviction or manual deletion. Container restart alone does not establish data loss; volume creation age does not prove contents survived. Need actual Redis startup/persistence/eviction logs, effective config, mount identity, queue/database names and worker logs at the incident times to establish the trigger.

The local `docker` executable is absent. `wsl --list --quiet` returns access denied. No live database/Redis/container mutations or historical recovery have been performed.

## Compatibility and implementation boundaries

The existing SQL CHECK constraint allows only `pending`, `dispatching`, `delivered` for outbox rows. `processed` is derived from terminal successful API-job state; `failed` delivery is derived from exhausted attempts, while business failure is stored on `api_jobs`. Do not write unsupported status values. A five-state outbox schema, dedicated recovery audit table and additional indexes need a separately approved migration. Existing `api_jobs.lease_expires_at`, `attempt` and JSON progress metadata suffice for the incremental repair.

Phases: (1) queue/outbox payload validation, bounded dispatch and fencing; (2) analysis claim/finalization and recovery with a required cutoff, disabled by default; (3) lifecycle, observability and Compose source hardening; (4) unit/concurrency/integration scenarios, typecheck, lint, build and diff cleanup. No live rollout, migration, authentication addition, historical enqueue, database reset, Redis flush or volume/container deletion is authorized.

Integration tests must target explicitly isolated `*_test` PostgreSQL and Redis DB 1–15. Unit tests and build use no live data. Full production-grade certification requires real failure/concurrency tests and deployment measurements; unit mocks alone cannot establish distributed correctness.

## Subsequent incident finding

Read-only Docker access was subsequently located in the user's Docker Desktop installation. The four hashes were found intact in two historical `test-queue-*` namespaces in Redis DB 0. A filtered, in-place AOF command summary records their insertion into those queues. `git show HEAD:apps/worker/tests/outbox-dispatcher.test.ts` shows the earlier test dispatcher used an arbitrary test queue with no aggregate scope. Wrong-queue delivery is confirmed; the exact historical test invocation is not available. See [the final report](FIREBRIDGE_RELIABILITY_REPORT.md) for verified evidence, implementation, results and remaining deployment gates. This supersedes Redis-data-loss hypotheses as the explanation supported by the available evidence.
