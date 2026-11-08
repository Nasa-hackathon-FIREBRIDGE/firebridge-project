# FIREBRIDGE — Phase 5 motion and shell report

Date: 8 November 2026. **Phase 5 only; stop for review before Phase 6.** Existing branch and dirty work are preserved. No commit, push, deployment, new dependency, backend edit or contract-generation lifecycle hook.

## Completed work

- Added a decorative, non-focusable `TabIndicator` to the existing `/analyses` tablist. It follows focused/selected tabs using content coordinates, observes tab/strip resizing and selection, and remains aligned during horizontal scrolling. Only transform/width animate, for **200ms**. Reduced motion places the final geometry immediately. Existing tab selection, keyboard, hash/query and mounted-panel source blocks are unchanged.
- Applied the approved type scale to shared navigation, section labels, brand subtitle, header context, published/demo notices, eyebrows and footers: meaningful small text is **at least 12px**, navigation labels are **14px**, with muted/primary/accent roles. Long labels have no tracked uppercase styling. Navigation structure, route destinations, labels’ meaning and synthetic/server separation are unchanged.
- Mobile menu/close controls and demonstration-header controls have **44px targets**. The demonstration header wraps on narrow screens; its existing search and satellite popovers stay inside the viewport. Drawer transform is **200ms**; closing visibility waits for the transform while the existing inert/focus behavior applies immediately. Reduced motion removes the transition. The **820px CSS/JavaScript boundary and all drawer focus/Escape logic remain unchanged**.
- Centralized **120ms** button, row and card feedback through existing tokens, with visible cyan keyboard focus and inset press feedback. No content is gated by an animation.
- Accepted analysis/job IDs now use the existing `CopyableId`, completing the gap in success feedback. Full-value copying, failure fallback and stale-feedback protection retain their existing implementation/tests. Success content is still conditional on the existing mutation result; it does not appear on mount.

Deliberate omissions: KPI count-up stays **off**, preserving immediate factual values and avoiding additional runtime work on refresh. No route/page presence wrapper, new toast consumer, command palette, decorative background, shimmer or synthetic progress was added. Existing inline success/error announcements are retained rather than duplicated in notifications. Optional street paint, scale bar and cursor-coordinate changes are omitted: no map-integration change or additional live OSM verification was undertaken in this phase. This is not a claim that MapLibre lacks those features.

## Changed files

| Existing file | Change |
| --- | --- |
| `src/main.tsx` | One CSS import, after the existing foundation stylesheet |
| `src/features/analyses/AnalysisWorkspace.tsx` | Import and decorative indicator child only |
| `src/features/analyses/AnalysisPanel.tsx` | Existing accepted analysis/job values rendered with CopyableId |
| `src/features/analyses/AnalysisWorkspace.test.tsx` | Success-only copy controls/no duplicate notification assertions; jsdom-only scroll stub |
| `src/components/ui/README.md` | Indicator and shell-polish composition/limits |

New: `src/components/shell.polish.css`, `src/components/ui/TabIndicator.tsx`, `src/components/ui/TabIndicator.test.tsx`, `src/components/ApplicationShell.test.tsx`, and this report. Ignored evidence lives under `.qa/phase5/`.

**5 existing files changed; 4 new application/test files.** `ApplicationShell.tsx` itself is byte-identical to the phase-start file; shell changes are CSS-only. Package manifest/lockfile, dashboard, map renderer/controls, date popover, workflow styles, routes and data boundaries are unchanged.

## Exact validation

| Check | Result |
| --- | --- |
| `npx.cmd tsc -b` | **PASS**, exit 0, no diagnostics |
| `npm.cmd run lint` | **PASS**, exit 0, no diagnostics |
| `npm.cmd test -- --reporter=dot --maxWorkers=4` | **PASS**, exit 0: **281 passed, 14 skipped (295)**; **35 files passed, 2 skipped (37)**; **32.81s**; no unhandled errors. Existing expected error-path logs remain. |
| `npm.cmd --ignore-scripts run build` | **PASS**, exit 0: **3,248 modules**, Vite **2.18s**, including TypeScript build. No prebuild/backend contract generation. |
| `git diff --check` | **PASS**, exit 0; historical LF/CRLF normalization warnings remain separate |
| Contract resolution | **PASS**: existing `@firebridge/contracts@1.0.0` → `../projet nasa/backend_FIREBRIDGE/packages/contracts` |
| Palette | **14/14** original declarations equal `746e7c9:src/index.css`; token source unchanged |
| Protected hashes | **354 protected files unchanged**, including **299 backend files**, zero protected changes |
| Full phase-start snapshot | **478 existing files** checked: **473 unchanged**, only the five listed existing files changed |
| Preserved logic | Both complete submit handlers, tab selection/hash/mounted-panel block and exact tab keyboard JSX handler compare equal after line-ending normalization |
| Entry-point exception | Removing the one new presentation CSS import reproduces the phase-start `main.tsx` hash, allowing line-ending normalization |

Four test workers cap concurrent jsdom resource use; the entire suite runs, with no test exclusions added. New tests cover visual-only indicator behavior, selection/focus/scroll/resize coordinates, reduced-motion updates, drawer Escape/Tab wrapping/inert boundaries/focus restoration, existing scope text, and absence of unsolicited notifications. Existing CopyableId, request-default/locking, scientific caveat, map and export tests pass. The 14 optional live-integration tests remain skips.

Hashes compare against the **phase-start dirty working tree**, not Git HEAD. Protected scope includes hooks, services, contracts/backend, fixtures, API/geometry validation, observation filter/count boundaries, renderer/basemap/tile integration, manifest/lockfile, shell and router. `main.tsx` is the explicitly checked CSS-import exception; no route or mount code changed. Backend vendor/runtime folders and Git internals are excluded.

Evidence: [tests.log](.qa/phase5/tests.log), [build.log](.qa/phase5/build.log), [integrity.json](.qa/phase5/integrity.json).

## Bundle delta versus Phase 4

Minified Vite kB, same entry-chunk definition as previous phases. Sizes are emitted artifacts, not measured page-load performance.

| Asset | Phase 4 | Phase 5 | Raw delta | Gzip Phase 4 → Phase 5 |
| --- | ---: | ---: | ---: | ---: |
| Initial entry JS | 365.34 | **365.34** | **0.00** | 111.96 → **111.95** |
| MapView | 1,184.27 | **1,184.27** | **0.00** | 320.17 → **320.17** |
| Charts | 560.15 | **560.15** | **0.00** | 188.31 → **188.31** |
| Global CSS | 242.69 | **248.92** | **+6.23** | 42.27 → **43.24** |
| Dashboard CSS | 11.10 | **11.10** | **0.00** | 2.34 → **2.34** |
| Workspace CSS | 22.20 | **22.20** | **0.00** | 3.70 → **3.70** |
| Total CSS | 275.99 | **282.22** | **+6.23** | 48.31 → **49.28** |
| `/analyses` route JS | 89.50 | **90.94** | **+1.44** | 26.29 → **26.78** |
| Shared HealthStatus artifact | 58.93 | **58.93** | **0.00** | 21.18 → **21.18** |

Growth comes from the small indicator implementation/copy consumers and shared readability/feedback CSS. No additional UI library or eager Motion consumer was introduced. The dashboard route remains **29.86 kB / 9.68 gzip**; the unused lazy AnimatedNumber artifact remains **71.54 / 25.72**, with count-up disabled. Tiny compression differences do not establish a performance improvement. Existing >500kB map/chart warnings remain visible. No Lighthouse/performance-score claim is made.

## Production browser QA

Installed headless Chrome/Playwright, software WebGL, production preview, viewport height **1000px**. API responses are intercepted with **isolated synthetic fixtures**; selected area names and release banners identify them. Actual NASA background pixels remain contextual. API requests are GET-only; no real backend requests or writes occur. Empty HTTP 204 native MVT fixtures do not verify real aggregate tile content.

- **120 Phase 5 checks** at **1920, 1440, 1280, 1024, 768 and 390px**, each with **normal and reduced motion**: 96 individual-tab alignment checks, 12 combined interaction/readability checks, and 12 demonstration-header checks.
- Every tab aligns within **1.5px** in left edge and width after its transition. Checks include scrolled tab strips, viewport resize, Home/Arrow keyboard behavior, retained query/hash and same map-canvas DOM node. Normal indicator duration is **0.2s**; reduced-motion duration is **0s**. Reduced-motion contexts report no active CSS transitions/animations in the tested shell DOM.
- Drawer checks at 768/390 verify initial close-button focus, forward/reverse Tab wrapping, Escape and explicit-close focus restoration, and retained canvas identity. Desktop navigation stays visible with the existing structure. No desktop collapse feature was invented.
- Actual keyboard focus shows the approved **2px outline**. Hover reaches the raised-surface color; held press produces inset feedback; copy activates the existing success message. No animation steals focus.
- Visible shell type samples are at least **12px**. Demonstration-header inputs/buttons have **44px targets**; satellite/search popovers remain inside the viewport. Existing Escape on the satellite trigger restores/retains its focus, and search opens with its existing input focus behavior.
- **Zero runtime exceptions, console errors or page horizontal overflow**. **12 NASA image responses returned HTTP 200** in this pass.
- Separate workspace regression: **80 state/overlay/interaction checks**, both empty and selected synthetic states at all six widths, **zero runtime/console errors or checked collisions/overflow**, **84 NASA HTTP 200 images**. Actual Terra Draw polygons complete and populate the existing GeoJSON field. Filters/reset, layers, all tabs, popover Escape/focus restoration, native validation, form spacing and canvas identity pass.

The workspace regression preceded the final demonstration-header spacing and global eyebrow-tracking refinements; the final 120-check run uses the final production build and rechecks workspace tab/drawer/canvas behavior, header geometry and computed eyebrow spacing. The map integration, workflow logic and workspace stylesheet are unchanged between these runs.

Evidence: [after-browser.json](.qa/phase5/after-browser.json), [regression-after-browser.json](.qa/phase5/regression-after-browser.json). No new map-glass contrast measurement was made: glass and imagery styling remain unchanged. Live OSM/dark-street contrast, real aggregate payloads, backend job/export execution, real devices/virtual keyboards, screen readers, Safari/Firefox, zoom certification and Lighthouse remain **unverified**. Existing Toast semantics are unit-tested; no new browser toast transition is claimed because no consumer was added.

## Before/after screenshots

Before captures use the actual Phase 4 production build. After captures use Phase 5; synthetic dataset identity remains visible. Screenshots were visually inspected. All are local ignored artifacts.

| Capture | Before | After |
| --- | --- | --- |
| Shell navigation, 1440px | [Before](.qa/phase5/before-shell-1440.png) | [After](.qa/phase5/after-shell-1440.png) |
| Open mobile drawer, 390px | [Before](.qa/phase5/before-shell-390.png) | [After](.qa/phase5/after-shell-390.png) |
| Analysis tabs, 1440px | [Before](.qa/phase5/before-tabs-1440.png) | [After](.qa/phase5/after-tabs-1440.png) |
| Analysis tabs, 390px | [Before](.qa/phase5/before-tabs-390.png) | [After](.qa/phase5/after-tabs-390.png) |
| Dashboard, 1440px | [Before](.qa/phase5/before-dashboard-1440.png) | [After](.qa/phase5/after-dashboard-1440.png) |

Additional demonstration-header captures: [1440px](.qa/phase5/after-demo-shell-1440.png), [390px](.qa/phase5/after-demo-shell-390.png). Demonstration route body redesign is outside this phase.

## Open questions and review boundary

No implementation blocker or new dependency approval is needed. The unverified platform/device/backend checks above remain explicit limitations for later QA. **Phase 5 is complete with those limits; stop here and wait for Phase 6 approval.**
