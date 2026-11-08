# FIREBRIDGE — Phase 4 workspace report

Date: 8 November 2026. Scope: **Phase 4 only, `/analyses` presentation**. Stop for review before Phase 5. The existing branch and uncommitted work are preserved. No commit, push, deployment, dependency change, backend edit or contract-generation lifecycle hook.

## Completed implementation

- Desktop uses a collapsible **340px workflow column** beside the map; tablet/mobile retain map-first ordering. Map height is `clamp(480px, calc(100dvh - 220px), 900px)` on desktop and `clamp(360px, 56dvh, 560px)` below 1024px. Existing 820px sidebar coordination is unchanged.
- A normal-flow action strip **above the map** exposes workflow, Save and Request actions with a visible blocking reason. External submit buttons target the original forms. Native form buttons remain beside their fields in normal flow, avoiding sticky-button/field and keyboard overlap. No fixed action layer covers map controls.
- Define → Interval → Run → Review uses the existing area, date, pending-request and selected-analysis states. Reasons reuse the existing date validator. Both complete submit handlers, their defaults, payloads, idempotency/locking and mutation calls are unchanged.
- **Draw on map** activates the existing drawing control. GeoJSON is an advanced disclosure; invalid geometry opens it and focuses the original textarea. Metadata also opens for invalid required fields or timezone errors. Names, geometry validation and supplied metadata remain intact. Saved-area selection consumes only already-cached list/current-area data, with the original identifier loader retained; it adds no list request.
- The approved Radix **Popover** wraps a DateRangePicker presentation mirror. The original visible named native inputs still own FormData and submission. Popover inputs call the same field callbacks and have no FormData names. ISO values and **end excluded · UTC** remain visible; Escape, dismissal and trigger-focus restoration work. Presets are omitted because availability bounds are not established.
- Map glass uses the approved palette, 92% panel background and 8px blur with opaque fallback. Native controls are 44px, mobile extra tools collapse, map stacking is isolated, and open panels reserve room for loading/empty messages. Map renderer, drawing implementation, providers, imagery colors, fetching and attribution remain unchanged. Optional street darkening was not implemented.
- All eight tabs are larger and scroll horizontally. Existing keyboard/hash/query/mounted-panel logic is preserved. Filters now state exactly what they affect: matching loaded/paginated records, table and timeline selection; aggregate tiles, inventories and exports retain saved-analysis scope.
- Observation, timeline, source comparison, detection detail, provenance/context, job and export presentation reuse the foundation. IDs are copyable; mobile table rows retain labels; native-unit/support caveats, partial/unsupported states and scientific limitations stay visible. Missing job progress says **Progress not supplied**. No ETA, history, scientific result, example area or backend capability was invented.
- Loading skeletons reserve presentation space. Existing API/missing/empty/stale and unavailable/downloadable export behavior is retained. Reduced-motion presentation is immediate; no animated tab indicator or Phase 5 work was added.

## Files changed or added in this phase

The phase-start SHA-256 snapshot distinguishes these edits from the earlier dirty working tree.

| Group | Files |
| --- | --- |
| Workspace/workflow/map presentation | `src/features/analyses/AnalysisWorkspace.tsx`, `AreaPanel.tsx`, `AnalysisPanel.tsx`, `SpatialPanel.tsx`; `src/components/MapWorkspaceControls.tsx` |
| Jobs and exports | `src/features/analyses/JobPanel.tsx`, `ExportPanel.tsx` |
| Observation presentation | `src/features/observations/ObservationFilters.tsx`, `ObservationSummary.tsx`, `ObservationsPanel.tsx`, `TemporalPanel.tsx`, `DetectionDetails.tsx`, `ProvenancePanel.tsx`, `ContextPanel.tsx` |
| Existing tests/documentation | `src/features/analyses/AnalysisWorkspace.test.tsx`, `src/features/observations/TemporalPanel.test.tsx`, `src/components/ui/README.md` |
| New UI components/tests | `src/components/ui/Popover.tsx`, `DateRangePicker.tsx`, `DateRangePicker.test.tsx` |
| New workspace presentation | `src/features/analyses/workspace.presentation.ts`, `workspace.presentation.test.ts`, `workspace.presentation.css` |
| Report and ignored evidence | This report; `.qa/phase4/` browser scripts, hashes, logs and screenshots |

**17 pre-existing files changed; 6 new application/test files.** No new dependencies. The existing `@radix-ui/react-popover@1.3.1` is now consumed. Package manifest/lockfile, dashboard, global tokens, shell, routes and full `MapView.tsx` remain identical to the phase-start snapshot.

## Exact validation

| Check | Result |
| --- | --- |
| `npx.cmd tsc -b` | **PASS**, exit 0, no diagnostics |
| `npm.cmd run lint` | **PASS**, exit 0, no diagnostics |
| `npm.cmd test -- --reporter=dot` | **PASS**, exit 0: **275 passed, 14 skipped (289)**; **33 files passed, 2 skipped (35)**; **17.67s**. Expected error-path logs remain. |
| `npm.cmd --ignore-scripts run build` | **PASS**, exit 0: **3,246 modules**, Vite **1.72s**; includes `tsc -b`. No prebuild/backend contract generation. |
| `git diff --check` | **PASS**, exit 0; existing LF/CRLF normalization warnings are not whitespace errors |
| Contract resolution | **PASS**: `@firebridge/contracts@1.0.0` → existing `../projet nasa/backend_FIREBRIDGE/packages/contracts` |
| Original palette | **14/14** declarations equal `746e7c9:src/index.css`; `index.css` is unchanged this phase |
| Protected SHA-256 comparison | **355 protected files unchanged**, including **299 backend files**; **zero protected changes** |
| Broader phase-start snapshot | **471 existing files** checked: **454 unchanged**, the **17 UI/test/documentation edits** listed above changed |
| Preserved source blocks | Both complete form submit handlers and the tab selection/hash/mounted-panel block compare equal after line-ending normalization; hashes recorded |

Protected hashes cover hooks, services, contracts/backend, fixtures, API/geometry validation, observation filter/count boundaries, map renderer/basemap/tile integration, manifest/lockfile and shell/router entry points. Backend dependencies, virtual environments, Git internals and runtime caches are excluded. Protection is compared with the **phase-start working tree**, preserving earlier uncommitted integration work; it does not claim every protected file is clean relative to Git HEAD.

Tests add stepper/reason coverage, popover/native-fallback/FormData callbacks and keyboard focus, hidden geometry/metadata validation, tab keyboard/hash/map identity, filter scope, missing progress and comparison caveats. Existing request-default, duplicate-submit, API failure, missing analysis and unavailable/expired export tests continue to pass. The 14 optional live-integration tests remain skips.

Evidence: [.qa/phase4/tests.log](.qa/phase4/tests.log), [build.log](.qa/phase4/build.log), [integrity.json](.qa/phase4/integrity.json).

## Bundle delta versus Phase 3

Minified Vite kB, using the same entry-chunk definition of initial JS as Phase 3. These are emitted artifact sizes, not measured page-load performance.

| Asset | Phase 3 | Phase 4 | Raw delta | Gzip Phase 3 → Phase 4 |
| --- | ---: | ---: | ---: | ---: |
| Initial entry JS | 365.20 | **365.34** | **+0.14** | 111.89 → **111.96** |
| MapView | 1,184.38 | **1,184.27** | **−0.11** | 320.22 → **320.17** |
| Charts | 562.47 | **560.15** | **−2.32** | 189.14 → **188.31** |
| Global CSS | 242.69 | **242.69** | **0.00** | 42.27 → **42.27** |
| Dashboard CSS | 11.10 | **11.10** | **0.00** | 2.34 → **2.34** |
| New lazy workspace CSS | — | **22.20** | **+22.20** | — → **3.70** |
| Total CSS | 253.79 | **275.99** | **+22.20** | 44.61 → **48.31** |
| `/analyses` route JS | 62.82 | **89.50** | **+26.68** | 16.87 → **26.29** |
| Shared `HealthStatus` JS artifact | 8.45 | **58.93** | **+50.48** | 3.14 → **21.18** |

The existing Popover runtime now emits a shared `rotate-ccw`-named artifact (**62.72 kB / 23.48 gzip**), plus `tslib` (**2.56 / 1.16**). Tooltip/foundation sharing shifts code out of the dashboard route (**77.73 → 29.86 kB**, gzip **26.37 → 9.68**). Chunk filenames are bundler labels, not proof of single-component contents. Shared costs must be considered alongside the route cost; the small entry/map/chart deltas do not establish a performance improvement. Existing >500kB map/chart warnings remain visible. No Lighthouse or new performance score is claimed.

## Production browser verification

Installed headless Chrome/Playwright with software WebGL, production preview, reduced-motion contexts, viewport height **1000px**. Both **no-selection and selected-analysis** states were tested at **1920, 1440, 1280, 1024, 768 and 390px**.

The browser harness intercepts API calls with explicitly labelled **isolated synthetic fixtures** and keeps server transport separate from dataset identity. Actual NASA GIBS background images load; they remain geographic context. Real backend requests/writes are not performed. Native MVT responses are deliberately empty HTTP 204 fixtures, so these checks do **not** verify real aggregate tile payloads or scientific map results. Filtered JSON fixture records are actually rendered and inspected.

Final browser result: **PASS, 80 state/overlay/interaction checks**, all six widths, **zero runtime or console errors**, **zero horizontal overflow or checked overlay collisions**. **84 actual NASA image responses returned HTTP 200**. Fixture API requests were GET-only. Before capture checks covered the four requested state/width combinations, with 23 NASA HTTP 200 image responses. Evidence: [.qa/phase4/after-browser.json](.qa/phase4/after-browser.json), [before-browser.json](.qa/phase4/before-browser.json).

Checks include actual Terra Draw polygon completion and original GeoJSON output; boundary layer off/on; source filter/reset and aggregate-mode availability; opening all eight tabs; Arrow/Home/End keyboard focus with exact hash/query retention; popover field mirroring, Escape and restored focus; visible disabled reasons; native required-metadata validation focus; form-button/field spacing; no page horizontal overflow; and retained **same canvas DOM node** across workflow, filter, layer and tab interactions. Bounding-box overlap checks cover default, layers, legend, basemap-choice and drawing overlays at all six widths, plus expanded mobile tools at 390px. Popovers stay inside the viewport.

Browser QA discovered and fixed toolbar stretching from old CSS, panel/loading-message overlap at 1280px, and sticky Save/field overlap. Source-level tab behavior did not need alteration.

Browser scope is `/analyses`. Missing/API-failure, stale refresh, job states and unavailable/downloadable exports are covered by the automated suite/source guards; this browser run does not certify every backend-result state, actual export bytes or backend job execution. No real-device, virtual-keyboard, screen-reader, Safari/Firefox, 200% zoom or Lighthouse pass is claimed. No real distance scale or cursor coordinate readout was added: the existing WGS 84 reference, boundary geometry and record-coordinate details are retained.

## Glass contrast

Actual computed control background: **rgba(12, 22, 39, 0.92)**; backdrop filter **blur(8px)**; primary text **rgb(227, 235, 247)**. The QA script temporarily places the existing control group over the brightest sampled patch of the displayed NASA map, samples the composited content-free padding pixels, then restores the DOM styles. This is a sampled patch, not the brightest possible satellite image.

| Background measurement | Composite RGB | Primary text | Muted text `#8a9bb5` |
| --- | --- | ---: | ---: |
| Actual sampled NASA imagery (mean underlying patch RGB approximately 147.79, 126.08, 80.94) | 23, 30, 42 | **13.93:1** | **5.92:1** |
| Explicit QA dark reference `#101c31` behind the real glass | 12, 22, 40 | **15.07:1** | **6.40:1** |

The second measurement is **a reference patch, not live OSM street imagery**. Public OSM tile scanning is disabled in this harness, and no dark street paint change was introduced. **Live street-layer contrast remains unverified.** For a pure-white background, analytical alpha compositing with the approved 92% glass gives approximately **12.24:1 primary / 5.20:1 muted**; that is a calculated bound, not another browser capture. These ratios do not certify accessibility or arbitrary content/states.

## Before/after screenshots

All eight captures are labelled QA fixture scenarios; NASA pixels are contextual backgrounds. Before captures use the prior production UI, not reconstructed mockups. After captures are reset to the top before interactions. Stored locally in ignored `.qa/phase4/`.

| State | 1440px | 390px |
| --- | --- | --- |
| No selection | [Before](.qa/phase4/before-empty-1440.png) · [After](.qa/phase4/after-empty-1440.png) | [Before](.qa/phase4/before-empty-390.png) · [After](.qa/phase4/after-empty-390.png) |
| Selected synthetic analysis | [Before](.qa/phase4/before-selected-1440.png) · [After](.qa/phase4/after-selected-1440.png) | [Before](.qa/phase4/before-selected-390.png) · [After](.qa/phase4/after-selected-390.png) |

## Remaining verification and review boundary

No implementation blocker remains. Live OSM/dark-street contrast, real-backend aggregate tiles/export output, real-device/keyboard/screen-reader checks and performance measurement are **not verified** here. They must not be represented as passes. No new scientific or backend capability is implied.

The final spacing/native-validation rerun passes at all six widths. Phase 4 implementation is ready for review with the verification limits above. **Stop here; Phase 5 requires approval.**
