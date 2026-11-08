# FIREBRIDGE geospatial workspace transformation

The later [satellite/platform report](SATELLITE_PLATFORM_REDESIGN.md) supersedes
the browser-availability and basemap-default limitations recorded in this initial
pass. It records the latest 190-test gate, live read-only checks and production
Playwright verification of all 15 routes at four viewport sizes.

## Audit and implementation plan (before changes)

The application uses React 19, TypeScript, React Router, one TanStack Query
client, Axios, lazy MapLibre/Terra Draw and ECharts modules. Public services
preserve `/api/v1`; ingestion alone uses a temporary administration token.
The dashboard and analysis workspace read server records. Legacy demonstration
routes use labelled synthetic fixtures. These must remain distinct.

Palette verified against commit `746e7c9:src/index.css`: page `#060c19`,
sidebar `#08111f`, panel `#0c1627`, surface `#101c31`, line `#1b2a44`,
text `#e3ebf7`, muted `#8a9bb5`, cyan `#38bdf8`, blue `#5b9cf5`,
orange `#f08a4b`. Keep these tokens unchanged.

Read README.md, INTEGRATION_REPORT.md, INTEGRATION_PHASES_1_3_5_6.md,
frontend services, observation contracts, map tile transport and page components.
The originally specified sibling `../backend_FIREBRIDGE` was absent. The user
subsequently supplied the actual directory:
`C:\Users\Mohamed El Korchi\Desktop\projet nasa\backend_FIREBRIDGE`.
The dependency, lockfile and predev/prebuild scripts now use the correct relative
path `../projet nasa/backend_FIREBRIDGE`. npm resolves the real
`@firebridge/contracts@1.0.0` workspace package through a junction; it was neither
removed nor substituted. Read-only backend inspection covered the shared HTTP
and native-selection contracts, native-result routes, selection validation,
repositories and confidence fields. The record endpoint accepts `source_ids`,
`start`, `end_exclusive` and signed cursors; selections must stay inside the
saved analysis interval. Aggregate tiles do not use these inspection filters.

1. Establish a compact, consistent token-based shell and analytical surfaces.
2. Prioritize the map; make configuration collapsible and status secondary.
3. Share source/time filters between observation records and spatial inspection.
   Aggregate tiles describe the full saved analysis; filtered record mode shows
   only loaded server pages and must state this explicitly.
4. Add keyboard-accessible record inspection, scoped search/sort, real temporal
   counts and side-by-side source inventories with a shared scale.
5. Retain provenance, component availability and real asynchronous exports.
6. Verify lint, tests, TypeScript/build and desktop/mobile rendering. Document
   environment limits and distinguish intercepted fixtures from live evidence.

## Reference research

Accessible public pages: Motion (https://motion.dev/), Anime.js
(https://animejs.com/), Kokonut UI (https://kokonutui.com/), React Bits
(https://reactbits.dev/), Smooth UI (https://smoothui.dev/), Cult UI
(https://www.cult-ui.com/), Animata (https://animata.design/), Eldora UI
(https://www.eldoraui.site/), Skiper UI (https://skiper-ui.com/), Awwwards
(https://www.awwwards.com/), Mobbin (https://mobbin.com/), Land-book
(https://land-book.com/), Untools (https://untools.co/), Texture
(https://texture.agency/). Only public landing/catalogue content was accessible;
no claim is made to have inspected private Mobbin flows. Refero returned no
readable content; Godly redirected to an inaccessible page.

Applied direction: restrained state transitions, clear tab selection, structured
metadata, dense tables and purposeful hierarchy. Existing CSS handles small
opacity/transform transitions and reduced-motion preferences; no animation or
component dependency is needed for these interactions.

## Completed implementation

- Kept the restored palette, existing React routes, MapLibre, Terra Draw, Query,
  Axios services, `/api/v1`, and the real shared-contract dependency.
- Added a compact shell and map-first analytical layout with collapsible setup.
- Shared source/UTC filters and signed record-page cache keys across map/table.
  Filtered inspection cannot show whole-analysis aggregate tiles. Only loaded
  matching server records are rendered, with explicit pagination and scope text.
- Added selectable real calendar periods, comparable count scales for separate
  source inventories, scoped search/sort and keyboard-accessible record details.
  Nulls, lower bounds, raw confidence schemes and timestamp precision remain intact.
- Added a published-evidence page and explicit full-analysis export scope with
  the existing asynchronous CSV, GeoJSON and Parquet workflow.
- Kept selected-analysis errors visible above collapsed configuration.
- Added nine regression tests beyond the original 174, covering temporal query
  transport/pagination, inspection scope, invalid intervals, precision, focus
  restoration, unknown vs zero counts and large-integer source scales.

## Final validation — 7 November 2026

| Check | Result |
| --- | --- |
| `npm ls @firebridge/contracts --depth=0` | Pass: real package `1.0.0` linked to the confirmed backend path |
| `npx tsc -b` | Pass, exit 0 |
| `npm run lint` | Pass, exit 0, no diagnostics |
| `npm test -- --reporter=dot` | Pass: 183 tests passed, 14 skipped; 22 files passed, 2 skipped; 9.85 s |
| `npm run build` | Pass, exit 0, including backend shared-contract generation, TypeScript and Vite; 2,735 modules, Vite build 1.59 s |
| `git diff --check` | Pass, exit 0 |
| Original palette comparison | All 14 color tokens match `746e7c9:src/index.css` exactly |
| Browser visual QA | Blocked: browser access host unavailable; native computer-use pipe also unavailable |
| Live API/data integration | Not run; the 14 optional integration tests remain skipped |

Production build still reports large-library chunk warnings: MapLibre 1,181.26 kB
(318.79 kB gzip), ECharts 558.69 kB (187.89 kB gzip). These modules remain lazy
loaded. No measured map frame-rate or large-dataset benchmark is claimed.

Browser availability was checked again after the user's continuation. No browser
or native app was exposed. Therefore map rendering, responsive layouts, drawers,
timeline appearance, evidence and export visuals were **not visually verified**
in this session. jsdom tests exercise behavior and mocked map lifecycle, not WebGL.
Tests use isolated explicit fixtures; they do not prove live scientific observations.
Server-provided releases retain their identifying names, including synthetic/test
labels. No fixture fallback was introduced into the API workspace.

Only generated shared contract artifacts were rebuilt in the backend by its
existing prebuild script. No backend source or behavior was changed. No commit,
push, deployment or new dependency was made.
