# FIREBRIDGE API — Catalogue et résultats natifs

Base path: `/api/v1`. Fastify serves OpenAPI at `/api-docs/json` and Swagger UI at `/api-docs`.

The implemented Phase 1 routes are `/catalog`, `/releases/{release_id}` and `/updates`. Sources and the Phase 2 area/analysis/job routes are integrated. Phase 3 adds `/analyses/{id}/detections`, `/summary`, `/calendar` and `/provenance`. Other resource groups remain planned (`501`). The [Phase 1 guide](docs/PHASE_1.md) and [Phase 3 guide](docs/PHASE_3.md) explain integration conventions and current limits.

## Common responses

Successful phase 1 responses use this envelope:

```json
{
  "request_id": "server-generated UUID",
  "schema_version": "1",
  "data": {},
  "warnings": []
}
```

`X-Request-Id` matches the response identifier. Error responses retain this envelope with `data: null` and add `error: {code, message}`. SQL details, connection strings and credentials are not returned.

| HTTP status | Meaning                                                     |
| ----------- | ----------------------------------------------------------- |
| `200`       | Successful read                                             |
| `304`       | Matching release representation ETag; empty body            |
| `400`       | Malformed HTTP/JSON syntax                                  |
| `404`       | Unknown scope or unknown/non-published release              |
| `422`       | Invalid parameters, cursor, filter or incompatible baseline |
| `503`       | Database/schema unavailable or no published snapshot        |

Unknown query parameters and duplicate scalar parameters are rejected. Dates are ISO 8601 UTC. Missing information stays `null`. Intervals are `[start, end_exclusive)`. Large counts are returned as decimal strings.

## GET /catalog

| Query       | Required | Meaning                                                                 |
| ----------- | -------- | ----------------------------------------------------------------------- |
| `scope_key` | No       | Registered inventory scope; defaults to `DEFAULT_SCOPE_KEY` (`morocco`) |

Returns:

- `sources[]`: product/platform/collection/stream, `provider_availability[]`, `provider_available_interval`, `ingested_intervals[]`, `ingested_interval`, `availability_status`, `verified_at`.
- `metrics[]`: ID/version/unit/family, description, mask/model requirements and `supported_extent[]` containing grid IDs, versions and GeoJSON geometry.
- `releases[]`: current releases targeted by published aliases in this scope, without raw configuration or private URLs.
- `release_aliases[]`: alias, release UUID, generation (decimal string), publication date and dataset kind.
- `limits`: configured workload limits for later analysis routes.
- `verified_at`: most recent source availability verification, or `null`. This is not the acquisition time or a freshness guarantee for every source.

Example:

```bash
curl "http://localhost:3000/api/v1/catalog?scope_key=morocco"
```

Provider availability and local inventory are separate. Multiple feeds retain their own intervals and statuses; the aggregate status is `multiple_feeds`. A singular interval is only populated when exactly one interval is available. No shared continuous range is inferred across gaps. Unknown or unverified provider availability is `unknown`.

The default scope without a snapshot returns `503`; an explicitly unknown scope returns `404`. No upstream download is triggered. Catalog responses use `Cache-Control: no-store`.

## GET /releases/{release_id}

`release_id` must be the UUID of a published release. Historical published releases are accessible even after an alias moves.

| Query        | Default      | Meaning                          |
| ------------ | ------------ | -------------------------------- |
| `membership` | `partitions` | `partitions` or `assets`         |
| `limit`      | `50`         | Page size, 1–100                 |
| `cursor`     | None         | Signed opaque continuation token |

Returns release ID/name, dataset kind, stream, scope, parent UUID, publication date, observation cutoff, code version, configuration digest, manifest digest (nullable), `validation_status`, `partition_counts[]`, `source_composition[]`, `change_summary[]` and `membership`.

```json
{
  "membership": {
    "kind": "partitions",
    "items": [],
    "returned": 0,
    "next_cursor": null
  }
}
```

Partition items contain `series_key`, `partition_key`, `partition_id`, `kind`, `sha256`, `row_count`, `serving_complete`, `validation_status` and `schema_version`. Asset items contain `asset_id`, `role`, `source_id`, `sha256`, `byte_size` and `validation_status`.

Reuse a cursor only with the same release, membership type and page size. Tampered or incompatible cursors return `422 INVALID_CURSOR`.

`partition_counts[].row_count` counts stored rows of each partition kind; it is not a count of unique incidents. `source_composition[].role` distinguishes normalized `record` sources from physical `input` sources.

The server sends an `ETag` bound to the returned page and configuration. Send `If-None-Match` to obtain `304` when unchanged. Responses use `Cache-Control: private, max-age=0, must-revalidate`.

```bash
curl "http://localhost:3000/api/v1/releases/RELEASE_UUID?membership=partitions&limit=50"
```

Replace `RELEASE_UUID` with an ID returned by the catalog; the placeholder is not a valid request.

## GET /updates

| Query              | Required | Meaning                                               |
| ------------------ | -------- | ----------------------------------------------------- |
| `scope_key`        | Yes      | Registered inventory scope                            |
| `after_release_id` | No       | Published baseline UUID from the same scope/component |
| `component`        | No       | `satellite`, `weather` or `reports`                   |
| `alias`            | No       | Exact alias, e.g. `latest_standard`                   |

Returns `scope_key`, `current[]`, `has_updates`, `comparison`, `history_complete`, `changes[]` and `checked_at`.

Without a baseline, `comparison=baseline_not_provided`, `has_updates=false` and `changes=[]`. With a baseline, the component defaults to its dataset kind. `has_updates` compares current UUIDs, not row counts. Specify `alias` to follow one stream when several aliases exist for a component.

Change entries contain `reason`, `revision_records`, `affected_interval` and `summary`. They aggregate the journal by reason. The interval is an envelope, not a claim that every date changed. `revision_records` counts journal entries, not distinct partitions or incidents.

If the baseline is not an ancestor of a changed current release, the response contains `history_complete=false` and warning `BASELINE_NOT_ANCESTOR`. It includes the current release's direct changes without inventing a complete history.

Unknown alias/component selections return `422 UNKNOWN_RELEASE_FILTER` when the scope otherwise has a published snapshot. A scope without any published alias returns `503`. A baseline in another scope/component returns `422 INCOMPATIBLE_BASELINE`.

```bash
curl "http://localhost:3000/api/v1/updates?scope_key=morocco&alias=latest_standard&after_release_id=RELEASE_UUID"
```

This route only reads the database and sends `Cache-Control: no-store`. Polling does not replace a previously pinned analysis or fetch NASA data.

## Health and data prerequisites

`GET /health/live` (under `/api/v1`) reports process liveness without a database query. `/health/ready` probes PostgreSQL, Redis and the configured default catalog, with bounded checks. The catalog provider is wired per Fastify application. A failing dependency returns `503`; external providers are not polled. Worker health is `not_checked`; the worker registers `analysis.requested` and `ingestion.plan.requested` separately.

The application does not seed synthetic releases. Ingestion must publish real metadata, membership and aliases using the [documented JSON conventions](docs/PHASE_1.md#contrat-à-respecter-côté-ingestion). Test fixtures run in an isolated embedded database and never populate the application database.

## Sources and Phase 0 integration

`GET /sources` accepts strict filters `kind`, `provider`, `limit` (1–100; default 50) and `cursor`. It reads the Prisma Source model mapped to `firebridge.sources`. Source cursors use `PAGINATION_SECRET` and the `v1.payload.signature` format; they are independent from release membership cursors signed with `CURSOR_SECRET`.

`POST /sources` validates `name`, `provider`, `kind`, `product`, `collection`, `processingStream`, `documentationUrl` (HTTP/HTTPS), `citation`, `licenseInfo` and `schemaVersion`. Optional fields include `platform`, `instrument`, `nativeResolutionM` and `metadata`. Unknown fields are rejected. Successful creation returns 201 with the generated source UUID. Registration does not acquire NASA data or publish a release.

Sources retain the Phase 0 `status`, `message` and `data` fields, enriched with `request_id`, `schema_version` and `warnings`. Invalid source queries/bodies return 400 with `INVALID_QUERY`/`VALIDATION_ERROR`; Phase 1 JSON Schema validation keeps its documented 422 contract. Error responses include both the stable top-level `code`/`message` fields and the nested `error` object.

`POST /sources` accepts an optional `Idempotency-Key`. With a key, its default Redis store fails closed with 503 when unavailable. Reusing a completed key with the same scoped method, path, query and body replays the response; a conflicting or in-progress request returns 409 (`Retry-After: 2` for in-progress work). Keys contain 1–256 printable non-space ASCII characters. The default scope uses a trusted authenticated identity when available and otherwise `unauthenticated`; caller-controlled tenant headers are not trusted by default.

Sources idempotency uses native Fastify route hooks. Atomic Redis ownership tokens, optional lease renewal, safe replay headers and text/binary responses are retained. Response metadata uses the current request ID even on replay. The in-memory store is limited to tests/single-process development. This Redis boundary cache is distinct from the PostgreSQL job ledger and transactional outbox used by analysis and ingestion requests.

`CORS_ORIGINS` configures the browser-origin allowlist. Set a custom `PAGINATION_SECRET` in production. Readiness probes have 3-second bounds; the API supplies a per-application `Phase1ReadinessProvider` so a connected database is not mistaken for a servable catalog.

The five additive migrations create HealthCheck, Sources, the complete v2 business schema and the analysis request-key ledger. Apply them explicitly using the deploy command in the README. No fixture or provider acquisition runs at application startup.

## Phase 3: native analysis results

### Creation, result caching and request retries

`POST /analyses` resolves the satellite and optional weather/reports releases before computing the result-cache key. Selection, cache lookup, analysis/components/job creation, request-key binding and outbox insertion use one `REPEATABLE READ` transaction. The cache identity includes the exact release UUIDs (null for missing context), normalized request parameters and all baseline/weather/news policies, plus the trusted requester identity. JSON object-key order does not change the identity. Changed versions or policies give distinct results; existing analyses retain their pinned inputs.

An explicit `Idempotency-Key` is a retry identity, separate from the result-cache identity: the same key and normalized intent return the original analysis/job (`200`), even after a new publication. Changed intent under the same key returns `409 IDEMPOTENCY_CONFLICT`. Use a fresh key, or omit the optional header, for an intentional request using newly selected versions. Keys contain 1-256 printable non-space ASCII characters. `analysis_request_keys` durably binds additional retry keys to an existing cached job without creating duplicate jobs. Retries of pre-migration analysis jobs remain supported through their original job key and request specification.

Old analysis cache keys are not rewritten or treated as version-aware identities. An unkeyed request may therefore create one new analysis after the upgrade even when its inputs are unchanged; old analysis URLs remain readable. The migration is additive and does not delete analyses. Concurrent creations retry serialization/uniqueness races up to three times, then return a sanitized `503` if still contended. This change does not replace the existing release-selection policy with a new scope/alias contract or implement provider acquisition/publication.

Read the exact analysis selected by Phase 2. All paths below start with `/api/v1/analyses/{id}` and never resolve a current alias again.

| GET path      | Query                                                                                            | Response data                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `/detections` | `limit` 1-5000 (default 500), `cursor`, subset `source_ids`, UTC `start`/`end_exclusive`, `bbox` | GeoJSON `features[]`, `returned`, `next_cursor`, `truncated`, explicit inventory scope                  |
| `/summary`    | None                                                                                             | `native_detections_by_source[]`, null comparable response and unknown observation coverage, limitations |
| `/calendar`   | `resolution` (day, week or month), narrowed `start_date`/`end_date_exclusive`                    | Every selected period with `counts_by_source[]`; unknown values remain null                             |
| `/provenance` | `limit` 1-100 (default 50), `cursor`, `asset_id`                                                 | Pinned release versions and paginated input hashes, source citations and roles                          |

Each response includes the analysis/release IDs, unit, time basis and selection metadata. Counters and bigint IDs are strings. Detection ordering preserves PostgreSQL microseconds and `(acquired_at,id)` keyset ordering. Duplicate partition membership does not duplicate a canonical detection.

A cursor is bound to the analysis, release, normalized filters, page size, endpoint and server identity context. Reuse under another selection returns `422`. `truncated=true` means that another page exists.

`count="0"` requires verified complete point inventory for the exact source, area revision and closed interval. Otherwise an observed positive count is labelled `lower_bound`, or `count=null` if the inventory cannot establish a value. This never establishes observation coverage or a unique incident count. See the publication marker contract in [PHASE_3.md](docs/PHASE_3.md).

`409 SERVING_NOT_READY` prevents the detections route from serving incomplete SQL slices. Summary/calendar can instead return explicit unavailable values. Unsupported metrics, time bases, mixed stream modes and unknown quality policies return `200` with `status=unsupported` and no invented numeric result. Unknown analyses return `404`; invalid filters return `422`; database failures remain sanitized `503` responses.

Logical representations have weak ETags because request identifiers change independently. Conditional requests can return `304`; `X-Data-Release-Id` identifies the pinned satellite release. Provenance never exposes raw configuration, private storage paths or secret-bearing provider URLs. Unimplemented optional fact/cell provenance filters are rejected rather than silently ignored.

## Phase 5: ingestion operations

All paths below start with `/api/v1`. Five administrative routes require the dedicated bearer token configured by `INGESTION_ADMIN_TOKEN`; missing server configuration returns `503`, invalid/missing authorization returns `401`. The source availability route is public. Swagger declares the bearer security scheme.

| Method and path                                    | Input                                                                                                                                                                      | Response data                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/ingestion/subscriptions`               | Optional `scope_key`, `feed_id`, `mode` (backfill, incremental, reconciliation), feed `state`, string `enabled=true/false`, `limit`, `cursor`                              | Safe subscription metadata, adapter version, credential configuration status, actual checkpoints, latest run and open gap count                      |
| `POST /admin/ingestion/backfills`                  | Registered `feed_id`, `area_id`, `scope_key`, UTC `start`/`end_exclusive`, `source_ids[]`, `products[]`, `collection`, `resource_budget`; optional empty `adapter_options` | `202` with job/subscription IDs, planned chunk count, unknown byte estimate, missing access requirements and explicit planning-only support          |
| `POST /admin/ingestion/subscriptions/{id}/refresh` | `mode` (poll, repair, reconcile), `resource_budget`, optional UTC window and enum `reason`                                                                                 | `202` with bounded plan for the existing feed/product/adapter selection; unchanged idempotent replay is `200`                                        |
| `GET /admin/ingestion/runs/{id}`                   | Fetch attempt UUID                                                                                                                                                         | Safe window/basis, attempt status, page and record counts, hashes, successful emptiness, related pipeline status and quality gate outcomes           |
| `GET /admin/ingestion/gaps`                        | Optional `scope_key`, `feed_id`, `status`, UTC `start`/`end_exclusive`, `limit`, `cursor`                                                                                  | Source-specific gap intervals, resolution IDs and retry timing, without raw evidence or provider error bodies                                        |
| `GET /sources/{source_id}/availability`            | Required `scope_key`, optional UTC `start`/`end_exclusive`                                                                                                                 | Provider state, last attempt/success, checkpoint boundary, actual source acquisition time, publication time, stale reason, per-feed details and gaps |

`resource_budget` requires positive integer `max_chunks` (maximum 366) and `max_bytes` (maximum 1,000,000,000,000). Windows are UTC, half-open, not future and at most 366 days; verified feed limits and configured AOI limits can be stricter. The plan's chunk count must fit the submitted budget. Byte volume is not inferred from absent inventory. Unknown fields and nonempty adapter options are rejected (`422`).

The feed must be active, verified and declare `capability_spec.ingestion_v1` with positive integer `max_chunk_seconds`, `max_window_seconds` and `query_basis="observation_time"`. Products and collection must match its registered sources. Refresh cannot silently change the configured adapter/version; legacy subscriptions without explicit source/product configuration return `409`.

Both POSTs require an `Idempotency-Key` of 8-128 characters from letters, digits, `.`, `_`, `:` and `-`. PostgreSQL serializes concurrent retries and atomically stores subscription, job and outbox event. Same normalized request/key/admin identity returns `200` with the same job and `Idempotent-Replayed: true`; another request under that key returns `409`. A new key creates a new job and may reuse the subscription. No provider call or Redis write occurs in the request handler.

The worker handles `ingestion.plan.requested` by creating/reusing bounded queued `fetch_runs`. **Execution is planning-only:** no provider adapter, periodic scheduler, fetch/normalization, checkpoint advancement or release publication is implemented here. The requested job remains `queued`, `progress.stage="awaiting_fetch_executor"`, with no completed timestamp or invented success. The plan and Swagger expose this limitation.

List limits are 1-100 (default 50); signed cursors bind route, filters, limit and admin identity. Run assets/quality issue lists are capped at 100 with total/truncation metadata. Source availability exposes at most 100 gaps with a total/truncation flag; freshness uses all relevant unresolved gaps. Availability separates successful empty transport from actual source observations, constrains acquisitions to the exact area/fetched window/stream, and never fabricates an Aqua acquisition from a Terra timestamp. The aggregate fetch checkpoint is conservative (minimum, or null if a subscription lacks one).

Retired feed gaps are presented as `accepted_unavailable` without retries; reads do not rewrite the ledger. Observation coverage stays unknown and no gap-free result is presented as proof of complete ingestion. Raw credentials, provider URLs, headers and free-form sensitive evidence are not returned. See [PHASE_5.md](docs/PHASE_5.md) for environment setup, examples and the dedicated fixture workflow.

## Phase 4 — map tiles and exports

| Method | Path                                                     | Result                                                                                              |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/analyses/{id}/tiles/detections/{z}/{x}/{y}.mvt` | Binary MVT with bounded point aggregation at all zoom levels                                        |
| POST   | `/api/v1/analyses/{id}/exports`                          | `202` with job ID; JSON `{"format":"csv"}`, also `geojson` or `parquet`; `Idempotency-Key` required |
| GET    | `/api/v1/jobs/{id}/download`                             | Stream the completed, unexpired export; `409` pending, `410` expired                                |

Optional export filters are `source_id` and `day_night`; source filters must narrow the frozen selection. All paths honor the saved satellite release, sources, mode, UTC interval and exact AOI. Prepared partitions must all be valid, complete and consistent with SQL membership. A satellite component mismatch or incomplete serving slice returns `409`, including before a tile cache hit. Unsupported modes/quality policies are refused. Tile and export HTTP responses are private/no-store; Redis stores version-bound tiles internally for the configured TTL. Worker exports use a consistent database snapshot, bounded streaming and shared local storage. The current API has no identity provider; requester fields do not establish authenticated ownership. See [integration validation](docs/PHASE_4_REVIEW.md).

## Phase 6 — prepared context and factual explanations

These routes use the saved analysis and pinned releases. Context reads never download data or train models. All seven operations are tagged **Phase 6** in Swagger and return `Cache-Control: private, no-store`.

| Method | Path                                    | Parameters/body                                                                                                                 |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/analyses/{id}/coverage`        | Optional `start_date`, `end_date_exclusive`, `cell_id`                                                                          |
| GET    | `/api/v1/analyses/{id}/cells/{cell_id}` | Optional dates, `limit`, `cursor`                                                                                               |
| GET    | `/api/v1/analyses/{id}/comparison`      | `view=native_counts\|common_response\|withheld_reference`, `resolution=week\|month`                                             |
| GET    | `/api/v1/analyses/{id}/weather`         | `context=historical\|recent\|both`, `resolution=hour\|day\|period`, comma-separated `variables`, pagination                     |
| GET    | `/api/v1/analyses/{id}/reports`         | `relation=candidate\|consistent\|conflicting\|unresolved\|rejected`, `review_status=unreviewed\|reviewed\|rejected`, pagination |
| POST   | `/api/v1/analyses/{id}/explanations`    | JSON `{"language":"fr","question":""}`; optional `Idempotency-Key`                                                              |
| GET    | `/api/v1/explanations/{id}`             | No query parameters                                                                                                             |

Pagination defaults to 50, maximum 100. Cursors bind the analysis, component versions, filters, limit and actor. Date filters only narrow the saved selection. Invalid requests return `422`, absent analyses/cells/explanations `404`, and inconsistent pinned versions `409`.

Coverage returns its fraction/denominator and observed/estimated/missing cell-days only for consistent prepared scientific inputs. Point-only analyses return `status=unsupported`, `observation_coverage_status=unknown` and null numeric coverage. Unique cloud/invalid/unobserved land unions and cell-specific coverage aggregates are not prepared by this implementation. Cell reads expose approved release-local observations, QA, asset IDs/hashes, selected days and approved-model predictions. Scientific comparisons require an explicitly pinned, validated, precomputed experiment; native comparisons remain separate per-source counts, with no harmonization or unique incident claim.

Weather returns `series[]`, exact `context_release_ids`, provenance and native spatial support. Hourly values retain native locations; day/period summaries must be precomputed and bound to the exact input manifest. Missing values remain null. Reports return exact release members linked to this analysis, with claim/document review, matching relation, independence and geographic precision preserved. Public article URLs are sanitized; private storage references are omitted.

Missing context returns `200` with `status=missing`. Missing scientific prerequisites return `200` with `status=unsupported`; incoherent prepared membership returns `status=unavailable`, rather than invented numbers. A prepared result does not prove complete ingestion.

Explanation creation returns cached `200` or queued `202` with `explanation_id`, `job_id`, status and links. PostgreSQL freezes native count facts, citations and limitations atomically with the job and outbox event. The worker validates the evidence and renders a deterministic `template_fallback`, without any external language-model call. Freeform questions are recorded but not answered; weather/report/scientific evidence is not yet included in this native factual template. Pending/failed/rejected outputs are null; GET verifies a completed output against the frozen evidence before returning it. Retries reuse the original idempotency key; a changed request under the same key returns `409`.

Explanation ownership follows the existing identity resolver; anonymous requests share `unauthenticated` until a trusted identity provider is added. Full producer contracts, migration and isolated fixture instructions are in [PHASE_6.md](docs/PHASE_6.md).
