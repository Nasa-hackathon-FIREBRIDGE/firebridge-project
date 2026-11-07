# Astra product implementation

Historical record of the earlier product pass. Its graphite/lime visual direction
has been superseded by the restored original FIREBRIDGE dark blue identity.
See [the current UI/UX report](FIREBRIDGE_UI_UX_POLISH.md). The navigation and
functional improvements described below remain in use.

## Audit and decisions (7 November 2026)

The entry point is `src/main.tsx`. `App.tsx` owns BrowserRouter, the single
QueryClientProvider and AppStateProvider. Demo state lives in `state.tsx`;
server state lives in TanStack Query. Axios and all existing service boundaries
remain in place. No backend or environment changes are required.

Before this change `/analyses` selected a different sidebar (`WorkspaceSidebar`),
shell class (`fb-shell`), branding, header and CSS variables. The demo, original
analysis workspace and newer API screens also had separate error renderers;
several rendered arbitrary backend messages. The overview at `/` is explicitly
synthetic and cannot represent real analysis activity.

Backend routes, controllers, validators and contracts were inspected in
`../backend_FIREBRIDGE/apps/api/src` and `packages/contracts/src/http.ts`.
`GET /analyses`, `/areas` and `/jobs` already exist. They return cursor pages with
`analyses`, `areas`, or `jobs` plus **`nextCursor`**. Analysis lists support status
and area filters. There is no server-wide total or account-specific activity
contract. Job lists do not supply signed download links; downloads must continue
through the existing job detail and download service. Catalogue and native
summary/calendar/detection/provenance/context routes already support the
research workflow. Ingestion is an operator-only planning interface; it does not
execute downloads or publish releases.

## UX architecture

- One Astra shell, sidebar, breadcrumb and mobile drawer for every route.
- `/dashboard`: real public server activity; statistics explicitly describe
  loaded records, never global totals. Each resource can fail independently.
- `/analyses`: guided area/configuration/map workflow and a results navigator.
  Preserve query-string reopening, existing forms, polling, idempotency, MVT
  cancellation, signed pagination and CSV/GeoJSON/Parquet downloads.
- `/api-analysis`: retained advanced results explorer; `/ingestion`: retained
  operator tools. `/catalog`: direct access to the existing catalogue.
- `/`, `/explore`, `/compare`, `/calendar`, `/weather`, `/reports`, `/explain`,
  `/alerts`, `/evidence`, `/settings`: preserve existing URLs and behavior.
  Synthetic demonstration views remain explicitly labelled.
- Use graphite surfaces, a restrained lime research accent, legible system
  typography, shared semantic states and consistent form/table treatments.
- Use a single safe error presentation with authored validation messages,
  contextual recovery and optional sanitized support references. Writes never
  retry automatically. Keep unexpected rendering failures inside the app shell.

## Implemented application structure

`App.tsx` retains routing, demonstration pages and the original providers.
`ApplicationShell.tsx` now owns the one live sidebar, header, breadcrumb, mobile
drawer, data notices and route error boundary. Opening an analysis changes the
page content; it does not change the product identity or application shell.
The old standalone sidebar source is retained but is no longer mounted.

| Navigation | URLs and behavior |
| --- | --- |
| Research | `/dashboard`, `/analyses`, `/api-analysis`, `/catalog` |
| Demonstration | `/`, `/explore`, `/compare`, `/calendar`, `/weather`, `/reports`, `/explain`, `/alerts` |
| Workspace tools | `/evidence`, `/ingestion`, `/settings` |

All 13 pre-existing URLs remain registered. `/` remains the synthetic overview;
it has not been silently replaced with a production dashboard. Demonstration
navigation is expandable and opens on demonstration routes. Its local assistant
and synthetic-data notice remain scoped to demonstration views. Methods and
preferences remain accessible from the common navigation. The existing
advanced results and ingestion screens retain their supported operations.

## Dashboard and actual server data

The new read-only `workspace.service.ts` consumes the existing list endpoints.
It validates collection shapes and camel-case `nextCursor` before rendering.
The first page requests 20 analyses, 6 jobs and 6 areas. Metrics describe the
**loaded analysis selection**, including an applied status filter. They are
never presented as server-wide totals or a personal account's activity.

The analysis register sorts loaded records by creation timestamp and initially
shows eight rows. “Show more loaded analyses” reveals cached rows; “Load more
analyses” follows the server's cursor. This does not claim global chronological
ordering, which the list API does not support. Names are joined only from loaded
areas, with an explicit area identifier when a name is not available. There is
no automatic detail request for every table row or job.

The dashboard includes saved areas, available catalogue sources and exact
published dataset names, processing/export job states, and existing service
health checks. Job details and downloads use the existing `JobPanel` and signed
download service only when opened. Each resource has an independent loading,
empty or failure state. Previously loaded analysis data is identified when a
refresh fails. No chart or data is fabricated to fill an empty dashboard.

New list hooks share the existing QueryClient and cancellation signals. Active
analyses/jobs are checked every three seconds and stop polling on terminal
states or query errors. Existing detail polling rules remain unchanged.
Successful area, analysis, export, explanation and ingestion mutations also
invalidate the relevant new workspace lists. The catalogue and provenance
views now share a catalogue query instead of issuing competing catalogue reads.

## Analysis workflow and results

The area form, analysis configuration, job history, MapLibre spatial tools and
underlying services are reused. The new workflow indicator and selected-area,
UTC-interval and status summary establish context before the result sections.

Five accessible sections organize the work:

1. **Set up & map:** save/open an area, configure/request an analysis, inspect
   component availability and processing history, draw a boundary and view MVT.
2. **Observations:** source filters, signed pagination, the observation table
   and daily native inventory activity.
3. **Data & provenance:** catalogue, pinned inputs, fingerprints and source
   availability.
4. **Context & notes:** coverage, comparison, weather, reports and the existing
   deterministic factual note workflow.
5. **Exports:** existing CSV, GeoJSON and Parquet preparation, job status,
   expiry checks and browser download handoff.

Sections load on their first visit and stay mounted afterward so forms and
export jobs retain state across tabs. Hidden map layers are disabled through
the existing visibility/cancellation path. Area/analysis query-string reopening
and the existing section anchor names remain supported. No creation operation
is retried automatically, and existing intent keys and submission locks remain.

### Correcting the observed nullable-count mismatch

The backend's `native-results.service.ts` explicitly sends `count: null` with
`count_status: 'unknown'`, including daily inventory counts. The original primary
reader incorrectly required every count to be a string. Its client-side
declarations and validation now match that actual response. **No backend DTO,
shared contract, database schema or endpoint was changed.**

`nativeCounts.ts` preserves bigint precision, distinguishes a confirmed zero
from unknown inventory and marks lower bounds with “≥”. Unknown periods have no
invented bar. Native counts still do not imply unique incidents or observation
coverage. Missing FRP remains “Not measured”. Exact synthetic release names
remain visible beside results and in the dashboard catalogue preview.

## Error communication

`FeedbackMessage.tsx` and `userFeedback.ts` replace the separate raw-error
renderers. They distinguish connection failures, timeouts, validation, missing
resources, permissions, conflicts, expiry, throttling, readiness, malformed
responses and execution failures. Oversized-area and absent-release guidance
from the pre-existing local feedback work is retained.

Only frontend-authored `UserInputError` messages can be displayed verbatim.
Arbitrary HTTP messages, unknown Error messages and map style errors are not
forwarded into the interface. Developer diagnostics retain bounded error codes,
HTTP status and restricted request references, excluding raw bodies, URLs,
tokens, arbitrary messages and internal paths. Support references are optional.

Geometry, timezone and date fields expose inline errors with `aria-invalid`
and associated descriptions. Read failures can offer a safe retry. An uncertain
write explains that the server may have received the request and directs the
user to check status before resubmitting. No unsupported public job retry action
or preservation guarantee is invented. Job/download failures, partial outcomes
and expiry remain distinct. Clipboard, acceptance, download and existing demo
notifications continue to use contextual status announcements.

A route error boundary preserves navigation if rendering fails; the map has a
separate recovery boundary. Basemap configuration and style failures use
authored explanations, without leaking a provider URL or raw error details.

## Design system and accessibility

`src/astra.css` is the shared product layer: graphite surfaces, restrained lime
accent, semantic success/warning/failure states, system typography, monospace
data labels, consistent controls, borders, tables and spacing. Existing map and
demonstration styles remain as compatible component foundations. The sidebar,
buttons, active navigation and headers no longer switch styles by route.
Metadata and the favicon now identify Astra.

The common mobile drawer supports Escape, focus trapping, return focus and
scroll locking. Closed off-screen navigation and an open drawer's background
use `inert`. A skip link, labelled navigation, document titles, visible focus,
table captions and tab/tabpanel relationships are present. Tabs support arrow,
Home and End keys. Reduced motion is respected. Small-screen forms use readable
16 px controls. Tables scroll inside their containers; their positioned wrappers
also prevent clipped screen-reader labels from expanding the document width.

## Files created, modified and retained

14 new tracked-source candidates were created:

- `ASTRA_PRODUCT_REDESIGN.md`, `src/astra.css`
- `src/components/ApplicationShell.tsx`, `src/components/FeedbackMessage.tsx`,
  `src/components/RouteErrorBoundary.tsx`
- `src/hooks/useWorkspace.ts`, `src/services/workspace.service.ts`
- `src/lib/userFeedback.ts`, `src/lib/userFeedback.test.ts`,
  `src/lib/nativeCounts.ts`, `src/lib/nativeCounts.test.ts`
- `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`,
  `src/pages/CatalogPage.tsx`

37 existing files were modified relative to the index at task start:

| Area | Files |
| --- | --- |
| Entry, identity and documentation | `README.md`, `index.html`, `public/favicon.svg`, `src/App.tsx`, `src/main.tsx` |
| Map and fallback feedback | `src/basemap.ts`, `src/basemap.test.ts`, `src/components/MapView.tsx`, `src/components/MapView.test.tsx`, `src/features/analyses/SpatialPanel.tsx` |
| Shared feedback adapter | `src/features/analyses/Feedback.tsx` |
| Analysis workflow | `src/features/analyses/AreaPanel.tsx`, `AnalysisPanel.tsx`, `AnalysisWorkspace.tsx`, `AnalysisWorkspace.test.tsx`, `ExportPanel.tsx`, `HealthStatus.tsx`, `JobPanel.tsx`, `validation.ts` |
| Observation views | `src/features/observations/ContextPanel.tsx`, `ObservationSummary.tsx`, `ObservationsPanel.tsx`, `ProvenancePanel.tsx`, `types.ts`, `useResults.ts` |
| Services and hooks | `src/services/catalog.service.ts`, `results.service.ts`, `results.service.test.ts`; `src/hooks/useCatalog.ts`, `useDataApi.ts`, `useFirebridge.ts`, `useIngestion.ts` |
| Existing advanced tools | `src/components/CatalogPanel.tsx`, `src/components/api/ApiPrimitives.tsx`, `ExplanationRequestPanel.tsx`; `src/pages/ApiAnalysisPage.tsx`, `IngestionPage.tsx` |

No source files were removed. No dependencies were added. Existing staged merge
work remains intact. Browser scripts, screenshots and machine-readable evidence
are retained under the already-ignored `.qa/astra-redesign/` directory.

## Executed verification

| Command or check | Final result |
| --- | --- |
| `npm.cmd run lint` | Passed, exit 0 |
| `npx.cmd tsc -b --pretty false` | Passed, exit 0; production build also runs `tsc -b` |
| `npm.cmd run test -- --reporter=json --outputFile=.qa/astra-redesign/unit-results.json` | 171 passed, 0 failed, 14 skipped |
| `npm.cmd run build` | Passed; existing shared-contract prebuild and Vite build completed |
| `node .qa/astra-redesign/verify.mjs` | 30 route/viewport checks; 15 URLs at desktop and mobile |
| Main-page responsive checks | 1440, 1024, 390 and 320 px; no horizontal document overflow |
| Isolated browser workflow | Area creation, analysis submission, partial status, source records, calendar, provenance and deterministic notes passed |
| MVT behavior | Empty tiles, tile failure/recovery and no tile requests while disabled passed |
| Exports | CSV, GeoJSON and Parquet browser handoff passed; export state survives tab changes |
| Navigation | Common shell, mobile drawer, Escape/return focus and keyboard tabs passed |
| Loading/empty/failure | Checked with isolated HTTP responses; raw server error content was not shown |
| Live API reads | Health, analyses, areas, jobs and catalogue responded with expected shapes |
| Live published analysis | Observation table rendered with 0 alerts and 0 page errors; 0 write requests |
| Git checks | No unmerged paths or conflict markers; worktree `git diff --check` passes |

Unit tests cover safe error disclosure, uncertain write recovery, large/unknown
counts, malformed responses, independent resource failure, pagination/filter
reset, avoiding eager job detail requests and terminal polling. Existing API,
MapLibre, idempotency, cancellation and download checks remain in the suite.
Two 1-second DOM waits expired during an earlier simultaneous build/browser/test
run; the final standalone unit run above passed without changing timeouts.

The 14 skipped tests belong to the two optional HTTP integration suites. They
were not enabled or used to provision a database. Browser writes were fulfilled
entirely by isolated request interception. Fixture download bytes verify browser
handoff, not real worker encoding of CSV/GeoJSON/Parquet files.

Evidence includes [browser results](.qa/astra-redesign/browser-results.json),
[unit results](.qa/astra-redesign/unit-results.json),
[live read-only results](.qa/astra-redesign/live-results.json),
[desktop dashboard](.qa/astra-redesign/dashboard-live-1440.png),
[desktop observation results](.qa/astra-redesign/observations-live-1440.png),
and [mobile analysis](.qa/astra-redesign/analysis-fixture-390.png).

## Existing limits and remaining warnings

- Server records are public workspace data, not a user's authenticated history.
  There is no global-total or global-recency contract. Those features would
  require a separately approved backend addition; they are not implemented.
- The current published release is explicitly synthetic test data. Reading a
  real backend is not evidence of live NASA observation acquisition. Release
  names, provenance and limitations remain visible.
- Some older saved analyses reference unavailable releases or results. Read-only
  verification observed HTTP 404/409 for those records. They were not repaired,
  deleted, reset or replaced. A saved analysis matching the current published
  release was separately read successfully with no UI errors.
- Missing observation coverage, weather or reports remain missing. Ingestion
  remains planning-only. No authentication, migration, provider or deployment
  capability was added.
- Vite still warns about the existing large lazy chunks: MapView approximately
  1.18 MB minified and Charts approximately 559 kB. They remain lazy-loaded.
- Browser verification uses installed Chromium with software WebGL. It does not
  establish Safari/Firefox parity, external basemap availability or licensing,
  live worker execution, or scientific validation.
- The backend permits the existing `http://localhost:5173` development origin.
  A temporary 4173 preview was rejected by CORS and stopped; the existing 5173
  project server was reused. No environment or deployment configuration changed.
- The existing merge is still open. There are no unresolved conflicts, commits
  or pushes. This task's changes are left unstaged for review; the earlier merge
  index remains present. Previously reported blank lines at EOF in incoming
  staged files and Windows line-ending notices are not new functional failures.

No backend source, database records, schema, environment variables or deployment
settings were changed by this frontend work. The application can be reviewed at
`http://localhost:5173/dashboard` while the existing local dev server is running.
