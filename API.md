# FIREBRIDGE API — Phase 1

Base path: `/api/v1`. Fastify serves OpenAPI at `/api-docs/json` and Swagger UI at `/api-docs`.

The implemented read-only Phase 1 routes are `/catalog`, `/releases/{release_id}` and `/updates`. `GET /sources` and `POST /sources` are also implemented; other resource groups remain planned (`501`). The French [phase guide](docs/PHASE_1.md) explains implementation and ingestion conventions.

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

`GET /health/live` (under `/api/v1`) reports process liveness without a database query. `/health/ready` probes PostgreSQL, Redis and the configured default catalog, with bounded checks. The catalog provider is wired per Fastify application. A failing dependency returns `503`; external providers are not polled. Worker health is `not_checked`, and the worker itself has no processors configured.

The application does not seed synthetic releases. Ingestion must publish real metadata, membership and aliases using the [documented JSON conventions](docs/PHASE_1.md#contrat-à-respecter-côté-ingestion). Test fixtures run in an isolated embedded database and never populate the application database.

## Sources and Phase 0 integration

`GET /sources` accepts strict filters `kind`, `provider`, `limit` (1–100; default 50) and `cursor`. It reads the Prisma Source model mapped to `firebridge.sources`. Source cursors use `PAGINATION_SECRET` and the `v1.payload.signature` format; they are independent from release membership cursors signed with `CURSOR_SECRET`.

`POST /sources` validates `name`, `provider`, `kind`, `product`, `collection`, `processingStream`, `documentationUrl` (HTTP/HTTPS), `citation`, `licenseInfo` and `schemaVersion`. Optional fields include `platform`, `instrument`, `nativeResolutionM` and `metadata`. Unknown fields are rejected. Successful creation returns 201 with the generated source UUID. Registration does not acquire NASA data or publish a release.

Sources retain the Phase 0 `status`, `message` and `data` fields, enriched with `request_id`, `schema_version` and `warnings`. Invalid source queries/bodies return 400 with `INVALID_QUERY`/`VALIDATION_ERROR`; Phase 1 JSON Schema validation keeps its documented 422 contract. Error responses include both the stable top-level `code`/`message` fields and the nested `error` object.

`POST /sources` accepts an optional `Idempotency-Key`. With a key, its default Redis store fails closed with 503 when unavailable. Reusing a completed key with the same scoped method, path, query and body replays the response; a conflicting or in-progress request returns 409 (`Retry-After: 2` for in-progress work). Keys contain 1–256 printable non-space ASCII characters. The default scope uses a trusted authenticated identity when available and otherwise `unauthenticated`; caller-controlled tenant headers are not trusted by default.

Idempotency uses native Fastify route hooks. Atomic Redis ownership tokens, optional lease renewal, safe replay headers and text/binary responses are retained. Response metadata uses the current request ID even on replay. The in-memory store is limited to tests/single-process development. This Redis boundary cache is not a transactional exactly-once business ledger; durable jobs and outbox work remain future implementation.

`CORS_ORIGINS` configures the browser-origin allowlist. Set a custom `PAGINATION_SECRET` in production. Readiness probes have 3-second bounds; the API supplies a per-application `Phase1ReadinessProvider` so a connected database is not mistaken for a servable catalog.

The two migrations currently create HealthCheck and Sources only. Apply them explicitly using the deploy command in the README. The complete Phase 1 data schema remains to be migrated.
