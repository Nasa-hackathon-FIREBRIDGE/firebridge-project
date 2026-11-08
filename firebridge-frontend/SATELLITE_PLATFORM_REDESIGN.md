# Satellite workspace and platform redesign

## Implementation plan — 7 November 2026

Continue from the completed map-first implementation; preserve its filters,
record details, provenance and export workflows. Existing changes are uncommitted.
Audit covers all routes in App.tsx, ApplicationShell, MapView, basemap resolution,
native/API panels, ingestion, catalogue, charts and shared forms. Original color
roles remain the values recovered from `746e7c9:src/index.css`.

1. Verify imagery provider metadata, tile/CORS availability and terms. Preserve
   configured styles, use an actual satellite service by default, retain an
   explicitly labelled offline mode and visible recovery choices.
2. Keep a persistent MapLibre instance across basemap changes; restore analysis,
   draft geometry and record layers after style changes. Add connected basemap,
   layer, orientation, extent and fullscreen controls with source attribution.
3. Move overview metrics out of the map's initial path. Use a compact geographic
   toolbar and bottom timeline; open setup and detail panels contextually.
4. Apply purposeful layouts to overview, results, comparison, catalogue,
   provenance, ingestion, context, exports and preferences. Improve shared forms,
   data tables, density, feedback, navigation and responsive behavior.
5. Verify real/synthetic labels, filtered vs aggregate scope, nulls and units.
   Run meaningful regressions, lint, type-check and production build. Use browser
   interaction/visual QA when available; document exact limitations.

No framework, backend behavior, API prefix or business contract changes. No
imagery is generated. No package is added unless evidence justifies it. No
commit, push or deployment.

## Delivered pages and workflows

| Page / route | Result |
| --- | --- |
| Dashboard `/dashboard` | Shared product heading, loaded-record metrics, analysis availability distribution, saved-area/register/processing composition, explicit dataset names |
| Analysis workspace `/analyses` | Map before configuration and metrics; compact source/UTC toolbar; persistent MapLibre renderer; contextual map controls and bottom timeline |
| Analysis overview | Full saved-analysis metrics, release identity, source inventories and explicit coverage limits |
| Observation records | Shared source/time constraints, scoped search/sort, row density, optional coordinate/confidence columns and contextual record inspection |
| Timeline | Actual returned periods, UTC/exclusive-end selection, unknown/zero distinction and synchronized map/table filters |
| Compare sources | Selectable source inventories on a fixed common scale, lower bounds, raw product metadata and non-equivalence explanation |
| Data & provenance | Pinned dataset identity, existing asset hashes, release membership and source availability retained |
| Context & notes | Existing coverage/comparison/weather/report states and deterministic factual-note workflow retained in the unified presentation |
| Exports | Full-analysis scope, area/interval/release metadata, CSV/GeoJSON/Parquet selection, real async job workflow; format cannot change during an existing export request |
| Results explorer `/api-analysis` | Bookmarkable analysis URL, link back to the map, dense result tabs and shared inspection tables |
| Catalogue `/catalog` | Scoped source search, selected source metadata, inventory facts, release/change/availability navigation and readable technical tables |
| Data & methods `/evidence` | Published-evidence hierarchy, source/release tools and scientific interpretation guide |
| Ingestion `/ingestion` | Memory-only operator access, session status, section navigation, existing subscription/gap/run/backfill/refresh operations |
| Preferences `/settings` | Logical demonstration selection/display sections, immediate application and accurate default basemap explanation |
| Demo overview `/` | Consistent shell, typography, surfaces, actual interactive imagery beneath explicitly synthetic records, themed accessible charts |
| Demo map `/explore` | Shared imagery/basemap/layer/navigation controls and existing local geometry/record exploration |
| Demo comparison `/compare` | Consistent comparison layout, native record units, original-token chart colors and preserved scientific limits |
| Demo calendar `/calendar` | Consistent temporal layout, actual fixture-date labels, readable date controls and existing shared-day selection |
| Demo weather `/weather` | Purposeful unavailable state with no invented measurements |
| Demo reports `/reports` | Structured editorial list, visible fixture/review metadata and explicit lack of independent validation |
| Demo notes `/explain` | Readable evidence/limitations layout; no new scientific conclusions |
| Demo watchlist `/alerts` | Honest unavailable states and retained disabled unsupported actions |

Every existing route is retained. The eight analysis sections are reached through
the existing analysis URL/hash workflow, not new invented backend resources.

## Component system and map implementation

- ApplicationShell navigation, active states, responsive drawer, breadcrumbs and
  a two-row mobile demonstration toolbar that does not overlap the data notice.
- Reusable PageHeader; original color roles and existing controls; consistent
  typography, forms, section navigation, facts, tables, feedback and empty states.
- MapWorkspaceControls: basemap chooser, collapsible layer panel, legend,
  zoom, orientation reset, study-area fit, polygon controls and native fullscreen.
  Duplicate built-in zoom controls were removed. Panel close restores focus.
- Basemap changes use `setStyle` on the existing map. A style revision restores
  native MVT/GeoJSON selection and study-area layers; event handlers are cleaned
  up. Source visibility changes do not recreate the map.
- Loaded-record map scope remains separate from full-analysis aggregate tiles.
  Filtering disables the aggregate display until inspection filters are reset.
- Shared tables provide client search/sort, density and columns for loaded rows.
  Long provenance values are expandable and retained in full. Nulls are never
  converted to zero. Original high-precision acquisition strings are preserved.
- Charts use the original CSS color roles, ECharts accessibility support and
  reduced-motion preferences from their initial render. Map points do not run
  continuous animations. Overlay transitions use opacity/transform only.

Dependencies added: **none**. Existing React, TypeScript, Vite, TanStack Query,
Axios, MapLibre, Terra Draw, ECharts, Lucide, Vitest and Playwright remain in use.
No new animation framework, Figma plugin, Storybook or Lighthouse dependency was
needed. Reference evaluation and accessible/inaccessible public design resources
are documented in GEOSPATIAL_TRANSFORMATION.md; no private reference flow is claimed.

## Imagery and provider verification

The default is the real NASA GIBS Blue Marble archival satellite composite, with
native maximum zoom 8. It needs no API key. Higher map zooms enlarge those tiles;
they do not add resolution or current imagery. Basemap dates are independent of
wildfire timestamps. Satellite + OSM reference labels and NASA shaded relief are
also backed by actual WMTS layers. Relief is a contextual raster, not a 3D DEM.

Live NASA capabilities verified the layer names, EPSG:3857 matrix sets, raster
formats and attribution sources. Direct NASA/Esri tile probes returned HTTP 200,
JPEG content and `Access-Control-Allow-Origin: *`. Browser checks additionally
loaded real NASA JPEG and reference-label PNG tiles.

Configured styles remain the initial choice when present. Esri World Imagery is
an explicit configured option and requires appropriate licensing. Choosing NASA
from an Esri failure is a genuine provider change, not an Esri retry under a NASA
label. No private key was introduced. Environment variables, public-token limits,
provider attribution and failure behavior are documented in README and .env.example.

Primary references: [NASA GIBS access](https://nasa-gibs.github.io/gibs-api-docs/access-basics/),
[NASA WMTS capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml),
[Esri usage summary](https://goto.arcgis.com/termsofuse/viewsummary),
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Validation

Final command results and browser summaries are recorded below. The ignored
`.qa/satellite-workspace/` directory contains reproducible audit scripts, screenshots,
provider probes, a fixture-only CSV download and live-read reports.

| Check | Result |
| --- | --- |
| `npm ls @firebridge/contracts --depth=0` | Real `@firebridge/contracts@1.0.0` linked to `../projet nasa/backend_FIREBRIDGE/packages/contracts` |
| `npx tsc -b` | Pass, exit 0 |
| `npm run lint` | Pass, exit 0, no diagnostics |
| `npm test -- --reporter=dot` | 190 passed, 14 skipped; 23 files passed, 2 skipped; 10.06 seconds |
| `npm run build` | Pass, exit 0; existing contract prebuild + TypeScript + Vite; 2,738 modules; Vite 1.57 seconds |
| Palette comparison | All 14 original color tokens match `746e7c9:src/index.css` exactly |
| `git diff --check` | Pass, exit 0 |
| Production Playwright rendering | 60 passed: 15 routes at 1920×1080, 1440×1000, 1024×768 and 390×844; no runtime errors, horizontal overflow or demonstration-toolbar/banner overlap |
| Production browser interactions | Pass: persistent canvas, hybrid/relief switching, attribution, layers, orientation, fullscreen, map/table record inspection, synchronized dates, fixture export/download, mobile focus restoration, catalogue search and fixture operator-session cleanup |
| NASA browser responses in final fixture audit | 72 JPEG and 23 reference PNG responses returned HTTP 200; these were real imagery requests, not intercepted fixtures |

Build warnings remain for large lazy-loaded libraries: MapView 1,184.36 kB /
320.21 kB gzip; Charts 562.42 kB / 189.12 kB gzip. Initial application JS is
364.28 kB / 111.50 kB gzip. Warnings were not suppressed.

Live read-only backend checks returned HTTP 200 for health/live, health/ready,
catalogue, analysis list, selected analysis, summary, detections, calendar and
provenance. A separate real-browser check used the actual API without fixtures:
two native vector-tile responses and six NASA responses returned HTTP 200;
record inspection and source filtering worked with no API/runtime errors or page
overflow. No write request was issued. The actual published release is explicitly
`SYNTHETIC TEST — synthetic-rif-v1 — NOT NASA observations`. This is evidence of
real integration with existing test data, not evidence of NASA fire observations.

## Remaining limits

- The 14 optional integration tests remain skipped. Manual live checks were
  read-only; no ingestion, analysis creation or export worker job was created.
  Export interaction/download checks used explicit isolated browser fixtures.
- NASA Blue Marble is an archival, relatively coarse background. Current or
  higher-resolution imagery needs an appropriately configured/licensed provider.
- OSM streets use the official interactive service configuration and visible
  attribution. Automated viewport scanning of that public service was blocked in
  the audit to respect its usage policy; live NASA imagery was actually rendered.
- Browser QA used installed Chrome with software WebGL. No formal screen-reader,
  cross-browser WCAG certification, large-dataset memory test or FPS benchmark is
  claimed. The native computer-use host was unavailable; requested Playwright
  testing was available and used instead.
- Weather, reports, common-response science, measurement tools and notifications
  are not fabricated where unavailable. Existing scientific limitations remain.

No backend source/behavior changes, commits, pushes or deployment. The normal
prebuild regenerates shared contract artifacts in the confirmed backend package.
