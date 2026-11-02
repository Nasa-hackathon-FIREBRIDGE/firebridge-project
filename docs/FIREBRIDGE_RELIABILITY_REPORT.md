# FIREBRIDGE engineering repair — 2026-11-01

> Historical report from the Phase 4 branch. For the merged implementation, current fixture v2, actual identity behavior and fresh validation, see [integration report](PHASE_4_REVIEW.md).

## A. Root cause

**The four incident jobs were delivered to historical test queues, not lost from Redis.** All four hashes still exist in Redis DB 0 under:

- `test-queue-0bd4648a-488e-4d6f-8259-9a5561708448` — the first two analyses.
- `test-queue-cfe3e505-d280-46aa-bbc8-370fcfb1f8d8` — the other two analyses.

They are absent from the expected `firebridge-default` namespace. The filtered AOF history shows each job's hash creation and added/waiting events in those test queues. Representative enqueue timestamps match the October 30 outbox delivery times, with no processing/completion timestamps. PostgreSQL independently confirms queued/attempt 0/progress 0/completed NULL and delivered/attempt 1 outbox records with matching payload IDs.

The HEAD version of `apps/worker/tests/outbox-dispatcher.test.ts` constructs a dispatcher against `test-queue-${randomUUID()}` **without an aggregate filter**. Its dispatcher can claim any pending event from the configured database. This is the strongly supported mechanism for the confirmed misrouting. The exact historical command/process is unavailable; no claim is made to have identified its operator or invocation.

Redis started at `2026-11-01T02:16:25.620378453Z`, mounting `firebridge_redis_data`, created `2026-10-26T17:02:48Z`, at `/data`. Startup logs show successful AOF loading. Current configuration is AOF enabled, fsync every second, `noeviction`, with zero evictions since startup. These facts and the surviving hashes do not support Redis restart/data loss as the cause of this incident.

Sanitized evidence: [RELIABILITY_INCIDENT_EVIDENCE.json](RELIABILITY_INCIDENT_EVIDENCE.json). Initial findings, written before implementation: [RELIABILITY_AUDIT.md](RELIABILITY_AUDIT.md).

**The four jobs, their events, original test queues and live services have not been recovered, removed, restarted or otherwise modified.** Diagnostic reads can affect normal database/Redis access statistics, but no historical business-state writes were issued.

## B. Architecture and reliability changes

The repository actually uses **Fastify**, not Express. The existing framework, endpoints, envelopes, identifiers, authentication boundaries, database CHECK constraints and technology choices are preserved.

| Area | Repair and rationale |
|---|---|
| Misrouting prevention | Dispatchers and reconcilers using nonstandard queues require an explicit bounded aggregate scope. Integration dispatchers only select their own records. Existing infrastructure guards require a separate `*_test` database and Redis DB 1–15. |
| Outbox claims | Claim one event immediately before enqueue with a single atomic `FOR UPDATE SKIP LOCKED` statement. A serial batch no longer ages leases for events it has not started. |
| Outbox acknowledgement | Update only the claimed dispatch attempt with a live lease and `dispatching` state. Old owners cannot acknowledge or reset reclaimed events. Delivery is acknowledged after Redis add succeeds. |
| Delivery uncertainty | Preserve existing deterministic IDs and retry bounded failures with exponential jitter. Redis-committed/SQL-unacknowledged deliveries converge through ID reuse plus durable processor guards. |
| Runtime validation | Strict schemas validate supported event types, UUIDs, real calendar dates, date ordering, payload fields and aggregate identity. The analysis repository also binds every payload identifier/specification to durable records before changing state. |
| Analysis claim | Lock analysis before API job, reject live duplicate leases, increment the durable processing attempt once, and establish a SQL lease. Completed/terminal records cannot be restarted. |
| Finalization | Evaluate required satellite readiness and optional component readiness; finalize analysis and API job in one transaction. Retry/failure updates use the same lock order and attempt/lease fencing. A lost completion acknowledgement cannot turn successful results into failure. |
| Legacy split state | A delivered duplicate can align a queued API job with an already terminal analysis without executing the analysis again. Other inconsistent legacy combinations remain for manual review. |
| Reconciliation | Opt-in bounded batches select stale queued jobs and expired/null running leases. SQL locks coordinate recovery while bounded Redis commands inspect existence/state. Reuse the original deterministic ID; retry retained failed jobs; leave waiting/active/delayed work alone. |
| Conservative recovery | Exclude terminal/completed SQL results even when Redis records were auto-removed. A completed Redis record with nonterminal SQL is quarantined for review. Missing/invalid outbox records and exhausted processing/recovery attempts are also quarantined. |
| Recovery audit | Persist action, reason, time, attempts and next eligible time in `api_jobs.progress.recovery`; emit correlated structured logs after acknowledged SQL commit. Internal recovery metadata is omitted from API job progress. |
| Worker lifecycle | Start consumers after dependency readiness, retain reconnecting blocking connections, configure concurrency/lock/stall behavior, and keep idle workers alive. Shutdown shares completion, drains producers first, attempts every cleanup, reports failure, and has a 30-second signal deadline. |
| Export safety | Validate the entire export queue envelope. Remove the queue-failed callback that could mutate an API job without owning its SQL lease; processor fencing and existing expired-lease cleanup retain state ownership. |

Outbox states remain compatible with the existing schema:

| Meaning | Representation |
|---|---|
| Pending delivery | `pending`, below the attempt limit, eligible at `available_at`. |
| Dispatch owned | `dispatching` with a live lease; expired leases can be reclaimed below the attempt limit. |
| Enqueue acknowledged | `delivered`; this does not mean business execution finished. |
| Processed successfully | Derived from `api_jobs.status IN ('succeeded','partial')`, not a new outbox value. |
| Delivery failed/quarantined | Derived from non-delivered events at the dispatch attempt cap; alert via `exhaustedOutbox`. Invalid envelopes are placed at that cap. |
| Business failed | Existing `api_jobs.status = 'failed'`, with guarded analysis failure where applicable. |

A five-state outbox, dedicated recovery-history table or new indexes would require an approved migration; none was added/applied. The existing API transaction that atomically creates analysis/components/job/outbox is retained.

Queue ID deduplication alone is insufficient after completed-job removal; the durable SQL guards provide replay safety. See [BullMQ auto-removal guidance](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs). Producers use bounded command retries while blocking workers reconnect, consistent with [BullMQ connection guidance](https://docs.bullmq.io/guide/connections).

## C. Security

Implemented in source:

- Queue-envelope validation and durable payload binding; no raw payloads, connection strings or underlying database error details added to worker logs.
- Reject impossible API calendar dates before PostgreSQL casts them. Existing valid inputs and response envelopes are preserved.
- Remove Redis host-port publication; bind PostgreSQL's development host port to loopback.
- Run API/worker images as `node`; start Node directly so it receives container signals. Prepare a writable export directory for fresh volumes. Add worker init and a 35-second Compose shutdown grace period.
- Remove verified unused dependencies: API `helmet`, `pino-http`, `swagger-jsdoc`, `supertest`, and root `@types/supertest`; retain the active `@fastify/helmet`. Delete the obsolete `swagger-jsdoc` ambient declaration.

**Remaining deployment gates:** the running Redis is still publicly bound and unauthenticated; the running `firebridge` PostgreSQL role has superuser/createdb/createrole privileges; committed Compose development credentials need a production secret strategy. Source changes have not been deployed. Moving existing export volumes to UID/GID 1000 requires ownership verification and an explicitly approved permissions change.

`npm audit --omit=dev --json`: eight production findings before cleanup, seven after cleanup (four moderate, three high, zero critical). Remaining chains involve Swagger UI/static/glob/minimatch and Prisma tooling/config/deepmerge-ts. The suggested fixes include incompatible Swagger UI versions and major transitive changes; no forced upgrade/override was applied. The full development dependency audit also reports critical findings and needs a separate toolchain compatibility upgrade. These are not represented as resolved or as evidence of a remotely exploitable queue path.

No authentication was added. Existing API limits, CORS, SQL parameterization, export storage restrictions and result-access behavior remain in place.

## D. Performance and observability

- Batch sizes, processing/recovery attempt limits, worker concurrency and recovery cadence are bounded/configurable. No unbounded job fan-out or cache was added.
- Initialized producer Redis commands have a 2.5-second timeout; workers keep reconnecting. Startup waits for readiness before dispatch begins. A database transaction coordinating recovery has a 15-second limit; analysis state transactions have a 10-second limit.
- Remove simulated intermediate analysis progress writes and redundant standalone existence checks; add the locking reads necessary for correctness. Per-event claims intentionally cost more SQL statements than a batch claim while preventing lease ageing. No unmeasured throughput improvement is claimed.
- Heartbeats sample dependency availability, queue waiting/active/delayed/failed counts, oldest queued/pending age, expired processing/dispatch leases and exhausted delivery counts. Include local dispatch/recovery counters; analysis completion logs include processing duration and durable attempt. Probes do not overlap; DB sampling has a statement timeout. These are snapshots/logs, not a new Prometheus exporter or fleet-wide aggregate.
- Existing bulk PostGIS fixtures lacked planner statistics and initially exceeded a five-second transaction deadline. Analyze only the newly populated **isolated fixture tables** before performance assertions; no test deadline was increased.
- Final 10,000-row integration run: tile samples approximately **106–114 ms**, spatial index present in the plan; two concurrent 10,000-row exports approximately **1.03 seconds**, sampled RSS delta approximately **6.8 MB**. Existing 50,000-row streaming test stayed at a maximum producer lead of **11 rows**. These are local fixture measurements, not production load certification.

No production query plan, index, pool size or infrastructure resource limit was changed. Additional recovery/outbox expression indexes and ingestion ANALYZE scheduling should follow representative production measurements and migration review.

## E. Clean code

Replace the unguarded analysis processor with a small orchestration function and a focused SQL repository. Centralize queue payload schemas, deterministic ID conversion and retry-delay calculation. Remove the unused queue-name wrapper after repository-wide reference search, the unsafe export queue-failure writer, simulated progress stages and obsolete dependency declarations. Existing export generation/storage code is preserved.

No broad `any`, disabled lint rule, weakened TypeScript setting, skipped assertion or generic framework was introduced. Existing extensive uncommitted work was retained; this report describes only this audit's changes, not every item in the working-tree diff.

## F. Testing and validation

Executed commands (from repository root; the located Docker CLI is used where `docker` is shown):

Docker executable used: `C:\Users\Mohamed El Korchi\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test --workspace @firebridge/worker -- --run
npm.cmd run test --workspace @firebridge/worker -- --run tests/reliability.integration.test.ts
npm.cmd run test --workspace @firebridge/worker -- --run tests/phase4.integration.test.ts
npm.cmd run test:integration
npm.cmd audit --omit=dev --json
docker compose -f docker-compose.yml config --quiet
docker build -f Dockerfile.worker -t firebridge-worker:reliability-review .
docker build -f Dockerfile.api -t firebridge-api:reliability-review .
git -c core.safecrlf=false diff --check
```

Integration invocations set explicit `TEST_DATABASE_URL` to a newly created database in `firebridge-reliability-pg-c9f21` (localhost:55439) and `TEST_REDIS_URL` to DB 12/14/15 in `firebridge-reliability-redis-c9f21` (localhost:56389). The existing schema was initialized only in these new test databases. No reset, flush, development fixture insertion or historical-row cleanup was used. Repeated full runs use fresh databases because retained failed-run fixtures legitimately affect global export quotas.

Verification results before the final pass:

| Check | Actual result |
|---|---|
| Baseline units | API 226 passed; worker 41 passed. |
| Focused distributed reliability | 15 passed, including actual process termination and BullMQ stalled recovery. |
| Full integration on fresh infrastructure | API 244 passed; worker 110 passed. |
| Post-dependency-cleanup units | API 232 passed; worker 86 passed. |
| TypeScript / lint / production build | Passed repeatedly; final pass recorded below. |
| Both separate review-image builds | Passed; final source rebuilds recorded below. |
| Compose validation / whitespace | Passed. |

The first sandboxed unit command failed because esbuild could not read an ancestor directory; the same tests passed with the approved execution exception. An overlapping Prisma generation/build and integration run hit Windows DLL locking; serial verification resolved it. Initial integration failures exposed an unsuitable spy on Prisma's dynamic client, missing fixture statistics and retained quota state. The spy was replaced with an actual enqueue/lost-acknowledgement scenario; SQL acknowledgement failure remains covered by focused unit injection. Fresh fixtures and planner statistics resolved the other failures without increasing timeouts or weakening limits.

Coverage includes dispatch success/refusal/ambiguity, SQL acknowledgement failure injection, reclaimed leases, deterministic IDs, concurrent dispatchers, malformed payloads, stale/missing jobs, concurrent recovery, expired processing leases, duplicate execution, retry exhaustion, partial/ready/failed results, terminal preservation, legacy split finalization, a real process crash, idle-worker survival and shutdown cleanup/error handling.

Final validation on the final source and cleaned dependencies:

| Check | Result |
|---|---|
| Full unit + integration suite | **253 API tests + 114 worker tests = 367 passed**, zero failures; 35 test files. |
| TypeScript, lint, production build | **PASS**, all three commands actually executed after the last implementation changes. |
| API and worker Docker review-image rebuilds | **PASS**, separate `:reliability-review` tags; running images were not replaced. |
| Native Linux SIGTERM and SIGINT | **PASS** in two new non-consuming test containers; both logged graceful shutdown and exited 0, no OOM. |
| Nonroot storage and Redis connectivity | **PASS**, UID 1000, writable fresh export directory, PONG from isolated Redis. |
| Actual worker startup and heartbeat | **PASS** in a third new container using a fresh empty smoke-test database and Redis DB 10; built-in health command exited 0; graceful stop exited 0. |
| Historical preservation | **PASS**, all four original jobs/events retain the initial values, all four hashes remain in their original test queues, live container IDs/start times are unchanged, and only the original schema-v2 migration is applied. |
| Compose validation and diff whitespace | **PASS**. |

Native signal commands used `docker stop --time 35 firebridge-reliability-sigterm-c9f21`, `docker kill --signal SIGINT firebridge-reliability-sigint-c9f21`, `docker wait`, and filtered `docker inspect`/`docker logs`. The startup container used `WORKER_AUTOSTART=true` with an empty test database; its built-in `node apps/worker/dist/health.js` succeeded, followed by `docker stop --timeout 35`. Signal targets were exclusively newly created, labeled test containers.

Test artifacts remain under ignored `.data/reliability-evidence/`, including `verified-integration.log`, `post-cleanup-unit.log`, both final Docker build logs and production advisory JSON. All newly created test datastores, smoke containers and the read-only diagnostic container were stopped and retained for review. No containers or volumes were deleted.

Automatic approval review rejected a proposed full AOF export because it could include unrelated sensitive data. Instead, an approved network-isolated read-only container parsed the file in place and printed only the four incident IDs, command names and hash field names. No full AOF was exported; the diagnosis does not depend on that blocked operation.

## G. Deployment and rollback

No application migration is required. The existing unapplied serving-index migration is not part of this repair and was not applied to development.

Worker settings/defaults:

| Variable | Default |
|---|---:|
| `OUTBOX_MAX_ATTEMPTS` | 10 |
| `ANALYSIS_MAX_ATTEMPTS` | 3; set identically for API and worker |
| `ANALYSIS_LEASE_SECONDS` | 60 |
| `ANALYSIS_WORKER_CONCURRENCY` | 5 |
| `RECOVERY_ENABLED` | `false` |
| `RECOVERY_CREATED_AFTER` | unset; mandatory ISO timestamp if enabled |
| `RECOVERY_INTERVAL_MS` | 30000 |
| `RECOVERY_STALE_SECONDS` | 120 |
| `RECOVERY_BATCH_SIZE` | 20 |
| `RECOVERY_MAX_ATTEMPTS` | 5 |

Existing database/Redis URLs and outbox poll/batch/lease settings remain supported. Outbox leases now require at least 15 seconds. Compose forwards the new settings. Recovery stays disabled unless explicitly activated; select a deployment-time cutoff that excludes the four October 30 records. A cutoff is not an authorization to replay historical work.

Safe rollout, **not executed**:

1. Review this patch together with the pre-existing uncommitted changes. Back up durable SQL and preserve image/volume identifiers. Record the four historical job/event states and both wrong-queue namespaces.
2. Plan Redis network isolation/authentication, secret rotation and least-privilege database roles separately. Removing the Redis host port also removes direct host development access; use an approved private connection path.
3. Verify existing export-volume ownership and approve any scoped UID/GID 1000 adjustment before enabling nonroot images against that volume. Do not delete/recreate the volume.
4. Build/version reviewed API/worker images and drain/replace application services only after deployment approval. Use recovery disabled first. Do not run an indiscriminate `compose up` that also recreates datastore services.
5. Verify dependency/worker health and a new isolated analysis. Alert on exhausted outbox events, quarantine reasons, old queued work and heartbeat/dependency failure.
6. Enable recovery only with an explicit new-work cutoff after reviewing quarantines and the historic queue mismatch. Recovery stops after its bounded budget; operators must review exhausted work rather than repeatedly resetting counters.

Rollback: disable recovery, drain the new worker, and restore previously recorded API/worker image versions and compatible environment settings. Retain SQL, Redis and export volumes. There is no schema rollback. Keep security network restrictions unless the reviewed rollback requires a coordinated change. The older processor does not understand the new safety guarantees, so do not run mixed worker versions during rollback or recovery.

## H. Remaining work

Completed: incident diagnosis, recurrence guard, bounded/fenced dispatch, validated/transactional analysis processing, opt-in analysis reconciliation, safer shutdown/heartbeat, dependency cleanup, security source edits and automated verification described above.

Unresolved/recommendations:

- Approve and perform the production security/infrastructure rollout; source edits do not secure currently running containers.
- Resolve the seven production and remaining development dependency advisories with compatibility-tested supported versions; address the existing Fastify deprecation warning.
- The four historical jobs remain unchanged. Any migration from their original test queues to the intended queue requires a separate reviewed recovery action.
- Recovery targets analyses. Existing export expired-lease recovery is retained; queued exports whose Redis records disappear still need equivalent reconciliation if that scope is required.
- Analysis processing currently finalizes pre-resolved component readiness; it does not implement satellite ingestion or aggregation. Long-running future computation must renew the SQL lease and fence every side effect.
- Review pre-existing analysis-cache key policy omissions and concurrent cache-miss conflicts without silently changing public idempotency semantics.
- A dedicated immutable recovery audit history, five-state outbox schema, production-scale chaos/load tests, monitoring export/alerts and measured index/pool/resource tuning need follow-up review. Current recovery metadata stores the latest decision, with structured logs providing the sequence.

The changes improve failure safety substantially; the remaining security and rollout gates prevent an unconditional production-readiness certification.
