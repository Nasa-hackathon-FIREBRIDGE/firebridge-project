# FIREBRIDGE — Phase 3 dashboard redesign

Date: 8 November 2026. Branch: `codex/firebridge-ui-phase1-20261107`. **Phase 3 only; stopped for review before Phase 4.** Existing dirty work was preserved. No commit, push, new dependency, backend write or contract-generating hook.

## Completed

- Replaced the dashboard composition with a token-based bento layout: hero/action card, four StatCards, one segmented status summary, an analysis register and supporting processing/area/source/next-step cards. One column on mobile, two at 768px, twelve-column main grid at 1024px with an 8/4 register/sidebar split. Content controls height; cards are not clipped to fixed heights.
- Kept **the original loaded rows, sort, four KPI definitions, server status filter, 8-at-a-time display expansion, nextCursor requests, refresh calls, polling and job inspection behavior**. No new aggregate/scientific logic was introduced.
- Added one dashboard Banner derived from already-loaded release metadata. Explicit affirmative Synthetic/Test Only release labels get synthetic wording; different release IDs get a neutral mixed-release banner; unmatched metadata stays unavailable. Unmarked published metadata never becomes a claim of real observations.
- Replaced repeated full release strings with visible short item tags. A tag provides the full supplied name in its supporting Tooltip and opens one shared keyboard-accessible release-details disclosure. Full names occur once per release in that detail, not in every record row. Mixed selections retain synthetic warnings and unknown-item tags.
- Made supplied area name and `YYYY-MM-DD → YYYY-MM-DD` the primary row label; kept visible **end excluded · UTC**, copyable secondary ID, icon-labelled status, quick open action, exact UTC/date/release-ID details and loaded-count footer. A stretched native link makes unused row space clickable while secondary controls remain separate and operable.
- Added factual job cards: analysis/export/explanation icon, CopyableId, status, relative creation time and exact UTC Tooltip/disclosure, supplied stage/attempts, finite 0–100 reported progress or **Progress not supplied**. Existing JobPanel is still loaded only when requested; no history, ETA, retry endpoint or streaming event was invented.
- Drew small SVG previews from area geometry already in the list response, preserving holes; otherwise used a neutral icon. Names/version/supplied km² remain factual. These are labelled shape previews, not basemaps or area calculations; no additional area fetch or last-used value.
- Kept published-source chips derived from actual loaded metadata and the caveat that availability does not establish observation coverage. Aqua/Suomi-NPP/Terra are not hardcoded when the server supplies fewer streams.
- Added reserved loading skeletons, actionable empty states, independent resource failures and visible stale-refresh warnings. Unavailable counts are shown as a dash, never a fabricated zero. The single status summary stays structurally reserved while loading.
- Added subtle background-only entrance stagger to the first six rows, maximum 120ms stagger offset; data and controls are visible immediately. Reduced motion disables it. Optional spotlight and KPI count-up were left off; final counts are immediate.

The existing shell's generic “Published data” notice remains unchanged; the dashboard has one release-specific Banner. Phase 2 primitives/tokens, application shell, other screens, routes, workspace/map behavior, sidebar coordination and scientific caveats were preserved.

## Files changed/added

| File | Purpose |
| --- | --- |
| `src/pages/DashboardPage.tsx` | Dashboard composition using approved primitives and existing hooks/actions |
| `src/pages/dashboard.css` — added | Dashboard-only grid/layout/record/state styles using existing tokens; no parallel primitive system |
| `src/pages/dashboard.presentation.ts` — added | Display-only UTC interval/relative time and affirmative metadata-label helpers, kept separate for Fast Refresh and unit tests |
| `src/pages/DashboardPage.test.tsx` | Updated human-label/StatCard expectations; retained original integration/pagination/filter/polling/error tests; added no-individual-area-fetch assertion |
| `src/pages/Dashboard.presentation.test.tsx` — added | Twenty presentation/boundary/state/keyboard/identity/progress/geometry tests |
| This report — added | Validation, exact bundle delta, screenshots and limitations |

No new dependency. `package.json`, lockfile and all Phase 2 primitives/tokens are unchanged. Ignored `.qa/phase3/` contains hash snapshots, isolated browser script/JSON and before/after screenshots.

## Exact validation

| Check | Final result |
| --- | --- |
| `npx.cmd tsc -b` | **PASS**, exit 0, no diagnostics |
| `npm.cmd run lint` | **PASS**, exit 0, no diagnostics |
| `npm.cmd test -- --reporter=dot` | **PASS**, exit 0: **250 passed, 14 skipped (264)**; **31 files passed, 2 skipped (33)**; **16.19s**. Existing expected error-path logs remain. |
| `npm.cmd --ignore-scripts run build` | **PASS**, exit 0: **3,203 modules**, Vite **2.03s**. No prebuild/backend contract generation. |
| `git diff --check` | **PASS**, exit 0 |
| Palette | **14/14** original palette declarations still byte-identical to `746e7c9:src/index.css`; token source unchanged this phase |
| SHA-256 integrity | **340 protected files unchanged**, including **299 backend files**. Broader snapshot: **467 existing files**, only DashboardPage and its existing test changed; **465 unchanged**. |

Protected hashes include hooks, services, contracts/fixtures, backend source/config/artifacts, map integration, API validation and native-count/filter boundaries. Backend vendor/runtime folders (`node_modules`, `.git`, `.venv`, coverage, logs and caches) were excluded. All existing application route, map/workspace and shared-component source files outside the dashboard retain their pre-phase contents. The contract dependency is unchanged.

Tests cover synthetic/mixed/unknown/unmarked metadata, no repeated full release strings in rows, human area/date labels, exact exclusive boundaries including leap-day/year rollover, keyboard activation, unchanged KPI definitions and six status counts, missing/out-of-range/nonfinite progress, supplied progress, existing geometry/no-geometry fallback, stale errors, loading and original empty/API-failure/pagination/polling behavior. New tests use isolated local test values and existing fixture imports; protected fixture files were not edited.

## Bundle delta versus Phase 2

Vite minified kB, using the same baseline entry-chunk definition of “initial JS.” Small map/chart emitted-size changes occur despite unchanged source hashes.

| Asset | Phase 2 | Phase 3 | Raw delta | Gzip Phase 2 → Phase 3 |
| --- | ---: | ---: | ---: | ---: |
| Initial entry JS | 365.05 | **365.20** | **+0.15** | 111.83 → **111.89** |
| MapView | 1,184.36 | **1,184.38** | **+0.02** | 320.21 → **320.22** |
| Charts | 562.42 | **562.47** | **+0.05** | 189.12 → **189.14** |
| Global CSS | 242.66 | **242.69** | **+0.03** | 42.26 → **42.27** |
| New lazy dashboard CSS | — | **11.10** | **+11.10** | — → **2.34** |
| Total CSS | 242.66 | **253.79** | **+11.13** | 42.26 → **44.61** |

The dashboard JS route chunk changes from **14.12 to 77.73 kB** (gzip **4.26 → 26.37**) as the approved Tooltip/Radix and StatCard foundation are now actually used. This route cost is separate from the entry delta. Optional AnimatedNumber is emitted as a **71.54 kB / 25.72 kB gzip** lazy asset but is not requested in the dashboard browser checks; count-up is not enabled. No new runtime library was added. Existing >500kB map/chart warnings remain visible, not suppressed.

## Browser verification

Installed Chrome/Playwright exercised the production build at **1920, 1440, 1280, 1024, 768 and 390 × 1000px**. Each run intercepts API requests with explicitly labelled **isolated synthetic QA responses**, including existing catalogue/DTO fixtures. No real backend request/write or live scientific observation is represented.

- Before: **10 state/viewport checks**, five requested states at 1440/390.
- After: **30 state/viewport checks**, five states at all six widths: loaded, loading, empty, retryable API error and 20 loaded analyses with display/server pagination.
- After: **6 interaction checks**, one per width: keyboard focus/visible 2px outline and ≥44px primary row link, full-ID copy feedback using a browser-local clipboard stub, release details, on-demand job inspection and visible stale-refresh errors.
- After: **6 loading-to-loaded geometry checks** for hero, release Banner, KPI region and status summary. Their top positions/heights remain stable for the tested fixtures at all six widths. This does not assert zero CLS for arbitrary server content or a Lighthouse result; loaded record/card height still follows actual content.
- Pagination preserves the existing behavior: 8 shown → 16 shown → 20 shown of 20 loaded; actual nextCursor fetch adds four test records and the already-expanded 24-record display capacity shows all 24. No invented total or altered request semantics.
- No page horizontal overflow, clipped cards/“Start with a place” card, unexpected console errors or runtime exceptions in these checks. Explicit 503 console resource errors in intentional error/stale tests are expected and excluded from the clean-console assertion.
- Reduced-motion browser contexts show row animation `none`; only six rows have stagger classes, with no opacity/pointer-event gate. Source metadata/full names remain reachable without hover. Captured before/after states were visually inspected.

This is dashboard-only verification. No new all-route/map/scientific-output/export/download audit, actual live-backend browser pass, real-device Safari/Firefox/screen-reader certification or Lighthouse score is claimed. The 14 optional live-integration tests remain skipped. No Phase 4 work was started.

## Contrast

Actual computed colors were sampled from the dashboard at 1440/390. Nine distinct built-in text/background combinations were observed, all at text opacity **1**. These reuse the approved palette; full state samples are in `.qa/phase3/after-browser.json`.

| Text / background | Ratio |
| --- | ---: |
| muted `#8a9bb5` / panel `#0c1627` | **6.41:1** |
| primary `#e3ebf7` / panel | **15.08:1** |
| page `#060c19` / filled cyan `#38bdf8` | **9.12:1** |
| muted / page | **6.92:1** |
| success `#86d6b1` / panel | **10.58:1** |
| partial blue `#5b9cf5` / panel | **6.48:1** |
| cyan / panel | **8.45:1** |
| danger `#f3a6a6` / panel | **9.33:1** |
| primary / raised `#101c31` | **14.19:1** |

The background-only entrance can use raised rather than panel color; its calculated muted-text endpoint is **6.03:1**. Other primary/semantic text colors also remain above 4.5:1 at that endpoint. No whole-control opacity is introduced. These are measured/calculated pair ratios, not accessibility certification or guarantees for arbitrary styled content.

## Screenshots

All images are QA-only synthetic scenarios, stored locally under ignored `.qa/phase3/`. The load-more state shows 20 records loaded with the existing initial eight-row display limit; pagination also expands and tests all 20 and the next server page.

| State | 1440px | 390px |
| --- | --- | --- |
| Loaded | [Before](.qa/phase3/before-loaded-1440.png) · [After](.qa/phase3/after-loaded-1440.png) | [Before](.qa/phase3/before-loaded-390.png) · [After](.qa/phase3/after-loaded-390.png) |
| Loading | [Before](.qa/phase3/before-loading-1440.png) · [After](.qa/phase3/after-loading-1440.png) | [Before](.qa/phase3/before-loading-390.png) · [After](.qa/phase3/after-loading-390.png) |
| Empty | [Before](.qa/phase3/before-empty-1440.png) · [After](.qa/phase3/after-empty-1440.png) | [Before](.qa/phase3/before-empty-390.png) · [After](.qa/phase3/after-empty-390.png) |
| Error | [Before](.qa/phase3/before-error-1440.png) · [After](.qa/phase3/after-error-1440.png) | [Before](.qa/phase3/before-error-390.png) · [After](.qa/phase3/after-error-390.png) |
| 20 loaded / load-more | [Before](.qa/phase3/before-many-1440.png) · [After](.qa/phase3/after-many-1440.png) | [Before](.qa/phase3/before-many-390.png) · [After](.qa/phase3/after-many-390.png) |

Additional after captures with all 20 shown: [1440px](.qa/phase3/after-many-expanded-1440.png) · [390px](.qa/phase3/after-many-expanded-390.png). Full-page captures are reset to the top so sticky chrome does not appear midway through the image.

## Open questions

None blocking. Dashboard Phase 3 is complete; workspace redesign and Phase 4 remain pending explicit approval.
