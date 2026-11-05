# FIREBRIDGE frontend integration — 5 November 2026

## Audit and implementation plan (before code changes)

The existing frontend is React 19 / TypeScript / Vite, with BrowserRouter, one
TanStack Query provider, Axios services and shared `@firebridge/contracts` DTOs.
`App.tsx` contains the existing synthetic demonstration pages. MapLibre / Terra
Draw and ECharts are lazy loaded. Server state belongs in Query; demo filters
belong in the existing local context. Tailwind 4 is installed but its Vite plugin
and CSS import were not enabled. Lint is **Oxlint**, not ESLint. No AGENTS.md was found.

Backend inspection covered Fastify route registration, controllers, validators,
services, repositories, response/error middleware, idempotency, result availability,
signed downloads, shared DTOs and tests. All ten routes use `/api/v1`. No assigned
endpoint is paginated; list endpoints/cursors remain outside this task.

Incremental plan:
1. Keep the services and provider; strengthen payload validation and preserve
   HTTP creation/reuse outcomes. Retain readiness checks on HTTP 503.
2. Add meaningful service and polling tests, run existing frontend and targeted
   backend suites, typecheck, lint and production build; document this gate.
3. After that gate, connect a separate public analysis workspace using the real
   services. Preserve the labelled synthetic demonstration and unrelated routes.
4. Only after Phase 2 tests pass, connect the whitelisted MVT layer and export
   workflow, including terminal jobs, safe signed downloads and expiration.
5. Verify the final interface, rerun checks, record exact results and limitations.

## Contract mismatches found

- Existing services/hooks were disconnected from all visual pages.
- Area POST discarded HTTP 201/200, preventing created/reused feedback.
- Readiness 503 carried valid checks but was reduced to a generic HTTP error.
- Envelope checks did not verify request IDs, null payloads or error status;
  successful JSON payloads were trusted solely through TypeScript assertions.
- Analysis defaults were allowed by the backend but not explicitly sent by the client.
- Types alone did not prevent unsupported tile layers/XYZ or export formats at runtime.
- Query interval callbacks could continue polling stale queued data after errors.
- Download preflight trusted a URL without independently checking job kind/status.

## Initial test evidence

- Frontend `npm.cmd test`: PASS, 64 tests; 8 real-HTTP integration tests SKIPPED
  because `FIREBRIDGE_INTEGRATION_URL` is unset.
- Targeted backend Vitest: PASS, 169 tests in 15 files. Existing Fastify route
  injection, repository/service doubles and isolated tests; this is not proof of
  current live database/worker health. Initial sandbox startup was blocked by a
  Windows parent-directory restriction; the same command passed with escalation.
- Backend source/database/infrastructure files remain outside the modification scope.

The final endpoint matrix, commands and UI evidence follow below.

## API integration gate — completed before UI work

Available checks PASS: 95 frontend tests, 169 targeted backend tests, TypeScript
(`tsc -b` through build), Oxlint, production build. Eight external-HTTP tests are
BLOCKED / skipped: the guarded runner's URL is unset, both direct health probes
on localhost:3000 return ECONNREFUSED, and Docker CLI is unavailable in this
execution environment. No fixture reset, migration or infrastructure command was
run. These limitations do not validate a live database, worker or NASA data.

| Endpoint (prefix `/api/v1`) | Backend verified | Frontend integrated | Test result at gate | Issues |
|---|---|---|---|---|
| GET /health/live | Source + route tests | Service/hook | PASS isolated; live BLOCKED | API not listening |
| GET /health/ready | Source + bounded-probe tests | 503 checks retained separately | PASS isolated; live BLOCKED | Catalogue/DB not inspected live |
| POST /areas | Validator, service, route | 201/200 outcome preserved | PASS isolated; live BLOCKED | Surface/topology require PostGIS |
| GET /areas/{area_id} | Repository + route | Geometry + coverage | PASS isolated; live BLOCKED | `not_prepared` is valid |
| POST /analyses | Transaction/idempotency source + tests | Explicit defaults + intent key | PASS isolated; live BLOCKED | No worker end-to-end evidence this run |
| GET /analyses/{id} | Controller/service + tests | Independent components/partial | PASS isolated; live BLOCKED | Poll partial only if job active |
| GET /jobs/{id} | Controller/service + tests | Active-only polling | PASS isolated; live BLOCKED | Stop on terminal status/error |
| GET /analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt | Registry/query + binary route tests | Service validates layer/XYZ | PASS isolated; live BLOCKED | `detections` only; map connection next |
| POST /analyses/{id}/exports | Result access/idempotency + route tests | Three formats + required key | PASS isolated; live BLOCKED | Export UI next |
| GET /jobs/{id}/download | Streaming/signature source + route tests | Safe signed path + race errors | PASS isolated; live BLOCKED | Actual backend streams; no redirect contract |

Gate test cases include malformed success, success, missing/invalid resources,
network failure, readiness 503, unprepared weights, partial components, all job
terminal states, stale data after error, empty tile, bad XYZ/layer/format,
idempotency-key reuse, incomplete/expired downloads, signed-path validation and
download races. Frontend adapter doubles are labelled as tests and never replace
the application API. UI work can proceed with the documented live-test limitation.

## Final implementation

Open **Analysis workspace** in the sidebar, or visit `/analyses`. Existing demo
routes remain intact and labelled. The API route has its own forms and filters;
the synthetic record repository and local assistant never supply its results.
Area/analysis selection is stored in URL query parameters for reopening a session.

- **Foundation:** separate liveness and readiness probes; expected readiness 503
  is validated with the shared envelope and displayed with database, Redis and
  catalogue checks. Missing catalogue readiness does not crash the page.
- **Areas:** Polygon JSON or the existing Terra Draw controls; required metadata,
  WGS 84 coordinate/ring and IANA-timezone validation. All holes/elevation and
  antimeridian edges are preserved on JSON submission. Backend PostGIS remains
  authoritative for topology, surface and configured vertex budgets. HTTP 201/200
  determines created/reused feedback. Saved geometry, surface, provenance and
  weights status are fetched; no weights are fabricated.
- **Analyses:** explicit `native_detections_v1`, `grid_id: null`, `standard_only`;
  UTC interval with an exclusive end date; stable intent key across retries;
  synchronous duplicate-submit guard. Accepted identifiers are shown immediately,
  followed by real analysis/component/job reads, including partial results.
- **Jobs:** server progress is shown only when supplied and valid. Polling runs
  every three seconds only for queued/running jobs and active analyses (including
  partial analyses whose job remains active). It stops on terminal states or
  failed reads. React Query's background-polling default remains off. Retryability,
  attempts, errors, cancellation and expiration remain distinct.
- **Mapping:** existing lazy MapLibre renderer, isolated API tile hook/protocol,
  `detections` whitelist and service-level XYZ validation. No tile source is added
  before satellite availability or while the layer is hidden. Source removal
  cancels unneeded work; API requests retain AbortSignals. Empty MVTs, loading and
  source errors have distinct feedback. Saved geometry is fitted with antimeridian
  bounds handling. The API schematic has a global 10° reference grid, explicitly
  labelled as schematic, with no invented imagery or observations.
- **Exports:** CSV/GeoJSON/Parquet are queued through the backend with an intent
  key. Jobs determine availability; downloads re-read current job state, reject
  incomplete/expired/non-export jobs, validate the same-origin signed path and
  preserve server 409/410 race errors. Links are never rendered/logged. Blob URLs
  are revoked and the download mutation reset after handing the file to the browser.

The backend currently streams bytes; it does not implement an external signed
redirect for these downloads. No redirect contract was invented.

## Final endpoint status

“Backend verified” here means source inspection and the executed isolated tests,
not a claim that the current live environment is working.

| Endpoint (prefix `/api/v1`) | Backend verified | Frontend integrated | Test result | Issues |
|---|---|---|---|---|
| GET /health/live | Yes, source + isolated tests | Health panel | PASS isolated/UI; live BLOCKED | Connection refused on port 3000 |
| GET /health/ready | Yes, bounded checks + isolated tests | Independent checks and 503 state | PASS isolated/UI; live BLOCKED | Current database/catalogue state unknown |
| POST /areas | Yes, schemas/PostGIS repository + route tests | JSON/drawing form, duplicate guard, 201/200 | PASS isolated/UI; live BLOCKED | Real spatial execution not repeated |
| GET /areas/{area_id} | Yes, repository/controller + route tests | Details, geometry, not_prepared | PASS isolated/UI; live BLOCKED | No invented grid weights |
| POST /analyses | Yes, transaction/idempotency implementation + tests | Defaults, stable key, identifiers | PASS isolated/UI; live BLOCKED | Current worker execution unverified |
| GET /analyses/{id} | Yes, components/status + tests | Monitoring and partial components | PASS isolated/UI; live BLOCKED | Backend remains authority for result eligibility |
| GET /jobs/{id} | Yes, progress/retryability/expiry + tests | Progress, terminal state, polling | PASS isolated/UI; live BLOCKED | No out-of-scope retry endpoint |
| GET /analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt | Yes, registry/query/binary routes + tests | MapLibre MVT source via Axios | PASS isolated/Chromium; live BLOCKED | Only detections; source uses default server zoom cap 18 |
| POST /analyses/{id}/exports | Yes, result access/jobs/outbox + tests | Three formats, job monitoring | PASS isolated/UI; live BLOCKED | Backend does all file generation |
| GET /jobs/{id}/download | Yes, streaming/signature/error tests | Signed same-origin Blob download | PASS isolated/Chromium; live BLOCKED | Large-file memory not benchmarked |

## Executed verification

| Check | Result | Evidence / practical limit |
|---|---|---|
| Frontend `npm.cmd test` | **PASS** | 117 tests across 12 passed files; 8 real-HTTP tests in 1 skipped file |
| Frontend `node_modules/.bin/tsc.cmd -b --pretty false` | **PASS** | No TypeScript errors; build also repeats type checking |
| Frontend `npm.cmd run lint` | **PASS** | Existing Oxlint configuration; no final warnings/errors |
| ESLint | **NOT RUN** | Frontend has no ESLint dependency/configuration/script; existing Oxlint was used |
| Frontend `npm.cmd run build` | **PASS** | Shared contracts prebuild, TypeScript and Vite production output |
| Targeted backend Vitest | **PASS** | 169 tests / 15 files; exact command below |
| Optional frontend real-HTTP/PostGIS/Redis/worker suite | **BLOCKED** | 8 tests skipped: guarded runner URL absent; local API health connections refused |
| Direct live/ready health probes | **BLOCKED** | Both requests to localhost:3000 returned ECONNREFUSED; no HTTP readiness status can be inferred |
| Chromium against production preview, actual unavailable API | **PASS** | Honest failure state, WebGL canvas, no page errors or horizontal overflow at 1440×1000, 1024×900 and 390×844 |
| Chromium full workflow with explicitly isolated response fixtures | **PASS** | Real React/Axios/MapLibre/browser download: create area, analysis defaults, partial components, empty MVT, tile 503/recovery, no requests while layer hidden, export, signed Blob download, mobile navigation |
| Nonempty live PostGIS tile and live worker-generated CSV/GeoJSON/Parquet | **BLOCKED** | No current API/worker/database environment was started or provisioned |
| Git whitespace check | **PASS** | `git diff --check` |
| Backend source preservation | **PASS** | Backend `git status --short` remains empty |

Backend command (from `backend_FIREBRIDGE/apps/api`; Windows sandbox directory
restriction required escalation for this isolated test command):

```powershell
..\..\node_modules\.bin\vitest.cmd run `
  tests/health.service.test.ts tests/health.controller.test.ts `
  tests/areas.service.test.ts tests/areas.routes.test.ts `
  tests/analyses.validator.test.ts tests/analyses.service.test.ts tests/analyses.routes.test.ts `
  tests/jobs.service.test.ts tests/jobs.routes.test.ts tests/results.routes.test.ts `
  tests/http-contract.test.ts tests/idempotency.test.ts tests/tiles.query.test.ts `
  tests/download-link.test.ts tests/exports.repository.test.ts
```

Browser evidence and its fixture verification script are kept locally under
`.qa/` (ignored by Git). The fixture browser test explicitly intercepts HTTP in
the test browser; this is not application fallback data or live backend proof.
The final fixture result is `.qa/browser-fixture-result.json`; screenshots are
`.qa/fixture-analysis-{1440,1024,390}.png`. Browser testing used installed Chrome
through Playwright, headless software WebGL, on the production preview at port 4173.

## Files created

All paths below are within the frontend:

```text
INTEGRATION_REPORT.md
src/lib/api.validation.ts
src/services/contracts.test.ts
src/services/test-fixtures.ts                 # tests only; absent from production imports
src/features/analyses/AnalysisWorkspace.tsx
src/features/analyses/AnalysisWorkspace.test.tsx
src/features/analyses/AnalysisPanel.tsx
src/features/analyses/AreaPanel.tsx
src/features/analyses/ExportPanel.tsx
src/features/analyses/JobPanel.tsx
src/features/analyses/HealthStatus.tsx
src/features/analyses/Feedback.tsx
src/features/analyses/validation.ts
src/features/analyses/validation.test.ts
src/features/analyses/workspace.css
src/features/maps/tileProtocol.ts
src/features/maps/tileProtocol.test.ts
src/features/maps/useAnalysisTiles.ts
```

## Files modified

```text
.gitignore                                  # ignore local browser QA artifacts
README.md                                   # explain API workspace versus existing demo
src/App.tsx                                 # lazy route/nav, context-specific banner and controls
src/components/MapView.tsx                   # reuse renderer for API geometry/MVT, labelled grid
src/components/MapView.test.tsx              # renderer source lifecycle and error tests
src/hooks/useFirebridge.ts                   # bounded polling and precise invalidation
src/hooks/useFirebridge.test.tsx             # active/terminal/error polling and deduplication
src/lib/axios.ts                            # validate common envelope, preserve readiness body
src/services/health.service.ts              # independent validated readiness 503
src/services/areas.service.ts               # validated DTOs and creation/reuse outcome
src/services/analyses.service.ts            # defaults, validated DTOs/layer/XYZ/format
src/services/jobs.service.ts                # validated state and safe download preflight
src/index.css                              # Tailwind 4 theme/utilities; preserve existing reset
vite.config.ts                             # activate already-installed Tailwind 4 plugin
```

No files were moved or removed. No backend source, database schema, migration,
infrastructure, authentication module or dependency manifest was modified. The
normal frontend prebuild regenerated shared contract build artifacts only.

## UI/UX, performance and security

Feature components separate API workflow UI from the existing demo context.
The design reuses semantic color variables, precise section spacing, compact
component tables and legible status badges. Tailwind 4 uses the installed Vite
plugin and theme/utilities without introducing Preflight changes to demo pages.
Forms have semantic labels, fieldsets, keyboard focus, announced errors and
status feedback. The map takes precedence on smaller screens; navigation and
all forms were exercised at mobile size. No formal screen-reader or automated
WCAG audit was run (**NOT RUN**).

Server state stays in the existing QueryClient with shared reads and cancellation.
The workspace, map, charts and worker remain split into lazy chunks. Export jobs
do not invalidate unrelated analysis/tile data. Polling does not continue after
terminal failures, and hidden layers have no active tile source. No new packages
were installed. The production build still reports the existing large-library
warning: MapView ≈1,180 kB / 318 kB gzip and Charts ≈559 kB / 188 kB gzip. The new
workspace itself is ≈28 kB / 8.75 kB gzip plus ≈6 kB CSS, loaded on demand. Bundle
warnings were not suppressed and no unmeasured performance claim is made.

There is no authentication, identity header or authentication cookie flow. No
secrets were added. React renders untrusted text without unsafe HTML. The backend
remains authoritative for validation, quotas, publication and download signatures.
Signed URLs are confined to download preflight/transport, and expiration is
checked again before requesting bytes. No backend CORS/security configuration
was changed.

## Remaining limitations and blockers

1. **Live integration remains BLOCKED.** Start or supply the existing isolated
   API/PostGIS/Redis/worker environment to execute the optional HTTP suite. This
   task did not provision infrastructure, reset databases, delete fixtures or
   infer readiness from old reports. Missing live evidence is not a frontend test pass.
2. Analysis reads do not expose every Phase 4 eligibility field (for example the
   selection policy and publication state). The UI uses only returned status,
   component readiness and time basis; server 409 remains authoritative.
3. The vector source uses the backend's configured default maximum zoom, 18. A
   deployment overriding `TILE_MAX_ZOOM` below that value needs a matching UI cap;
   there is no in-scope endpoint that advertises this deployment setting.
4. Downloads buffer a Blob before handing it to the browser. Very large export
   memory/throughput and cancellation during navigation were not benchmarked.
5. Real NASA provenance, published snapshots, complete observation coverage and
   scientific harmonization were not verified or invented. They remain backend
   data/pipeline concerns outside the ten-endpoint frontend scope.
