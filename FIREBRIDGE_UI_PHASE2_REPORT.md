# FIREBRIDGE — Phase 2 design system foundation

Status: complete; **stopped before Phase 3 for review**. Branch: `codex/firebridge-ui-phase1-20261107`. Existing uncommitted work was preserved. No commit, push, deployment, contract-generating hook or backend write.

## Completed scope

- Added approved role, surface, status, spacing, radius, border, shadow, layering, type, motion and breakpoint variables above the unchanged original palette.
- Added typed owned Button, Card/BentoCard, StatCard, StatusPill, Input/Select, Banner, Skeleton, EmptyState, Tooltip, Stepper, Toast and CopyableId primitives. Documented props, examples and accessibility boundaries in [the UI README](src/components/ui/README.md).
- Applied the foundation to PageHeader, SectionHeading, FeedbackMessage, analysis Status/Empty/ApiError and HealthStatus. Existing handlers, error classification, refresh behavior and copy remain intact.
- Added global visible focus and typography rules; changed ordinary `--dim` text usages to the readable secondary role. Original dim remains available for decoration/control outlines. Dates/metrics get tabular numerals.
- Configured Motion with `reducedMotion="user"`; count-up is optional and dynamically imported. Global reduced-motion CSS stops nonessential CSS animation/transition/smooth scrolling. Existing ECharts reduced-motion handling remains unchanged and has a new regression test.
- Disabled/loading buttons remain legible and outlined, with an optional associated visible reason. Copy failures expose an honest selectable full-ID fallback; feedback is tied to the current ID.

No dashboard or workspace layout redesign, DateRangePicker, Popover consumer, tab library/indicator, locale migration, fake trend/history/last-use/example data or capability changes were introduced. The map glass helper is prepared with a panel fallback and 92% panel RGB/8px blur; it is not adopted onto existing maps in this phase. The existing 820px sidebar coordination, focus handling, attribution, routes and scientific caveats remain unchanged.

## Exact dependencies

Verified with `npm view <package> version peerDependencies license time --json` before installation. Installed with `--ignore-scripts --save-exact`; no additional direct dependency was added. npm installed 41 packages including normal transitive dependencies and reported zero vulnerabilities at installation; this is not a security certification.

| Direct dependency | Exact version | Published release (UTC) | License / React peers | Reason |
| --- | --- | --- | --- | --- |
| `motion` | **14.10.1** | 2026-11-06 14:25:26.082 | MIT; React/React DOM `^18.0.0 \|\| ^19.0.0` | One animation runtime; selective MotionConfig/reduced-motion imports and lazy optional numeric interpolation |
| `@radix-ui/react-tooltip` | **1.4.1** | 2026-10-12 21:04:06.692 | MIT; includes React/React DOM `^19.0.0` and compatible earlier ranges | Focus/hover supporting tooltip, portal positioning and Escape dismissal |
| `@radix-ui/react-popover` | **1.3.1** | 2026-10-12 21:03:17.606 | MIT; includes React/React DOM `^19.0.0` and compatible earlier ranges | Approved future foundation dependency; wrapper/consumers deferred to Phase 4 |

These recent published timestamps provide release-activity evidence. No component source/assets were copied from reference sites. Existing `@firebridge/contracts@1.0.0` still resolves to `../projet nasa/backend_FIREBRIDGE/packages/contracts`; its dependency declaration and contents are unchanged.

## Files changed in this phase

Exactly **12 pre-existing files** changed:

| Files | Change |
| --- | --- |
| `package.json`, `package-lock.json` | Three pinned direct UI dependencies and resolved transitive packages; scripts/contract link retained |
| `src/index.css` | Additive approved tokens; original palette declarations untouched |
| `src/main.tsx` | Load foundation CSS after existing global styles and wrap App in MotionProvider |
| `src/App.css`, `src/astra.css`, `src/platform.css` | Secondary-text role replaces dim text color; no layout edits |
| `src/components/workspace/PageHeader.tsx`, `SectionHeading.tsx` | Opt into shared token-based heading styles |
| `src/components/FeedbackMessage.tsx` | Use Banner/Button; preserve error/log/retry/reference logic |
| `src/features/analyses/Feedback.tsx` | Delegate Status and Empty to owned primitives; ApiError alias retained |
| `src/features/analyses/HealthStatus.tsx` | Shared styling/Button/status adoption; preserve checks, refresh and readiness logic |

Added under `src/components/ui/`: `AnimatedNumber.tsx`, `Banner.tsx`, `Button.tsx`, `Card.tsx`, `CopyableId.tsx`, `EmptyState.tsx`, `Field.tsx`, `MotionProvider.tsx`, `Skeleton.tsx`, `StatCard.tsx`, `StatusPill.tsx`, `Stepper.tsx`, `Toast.tsx`, `Tooltip.tsx`, `ui.css`, `README.md`, plus six test files: `AnimatedNumber.test.tsx`, `Button.test.tsx`, `Content.test.tsx`, `Field.test.tsx`, `Interactions.test.tsx`, `Motion.test.tsx`.

Also added `src/components/Charts.motion.test.tsx` and this report. Ignored `.qa/phase2/` holds hash snapshots, browser scripts, an isolated development-only primitive harness, JSON evidence and screenshots. The harness is not a product route and is not in the production build.

## Validation results

All checks below are final passing results after fixes, not skipped tests counted as successes.

| Command/check | Exact result |
| --- | --- |
| `npx.cmd tsc -b` | **PASS**, exit 0, no diagnostics |
| `npm.cmd run lint` | **PASS**, exit 0, no diagnostics |
| `npm.cmd test -- --reporter=dot` | **PASS**, exit 0: **230 passed, 14 skipped (244)**; **30 files passed, 2 skipped (32)**; **19.77s**. Expected error-path diagnostic logs remain. |
| `npm.cmd --ignore-scripts run build` | **PASS**, exit 0: frontend TypeScript + Vite; **3,169 modules**, Vite **1.76s**. Lifecycle hooks skipped, so no backend contract generation. |
| `git diff --check` | **PASS**, exit 0; Git's existing LF→CRLF normalization notices are not whitespace errors |
| Palette | **14/14** original declarations byte-identical to `746e7c9:src/index.css` |
| Protected-file integrity | **340/340 identified protected files unchanged by SHA-256**, including **299 backend files**. Broader snapshot: **443 existing files**, exactly the 12 allowed files above changed; remaining **431 unchanged**. |
| Dependency resolution | Exact three approved UI versions installed; actual existing contracts package retained |

Protected hashes cover hooks, services, contracts/fixtures, backend files, map integration, validation and native-count/filter boundaries. Backend dependency/vendor/runtime directories (`node_modules`, `.git`, `.venv`, coverage, logs and caches) were excluded; no backend source/config/contract artifact in the snapshot changed. Original routes, `ApplicationShell.tsx`, dashboard/workspace files and ECharts implementation also retain their pre-phase contents.

Forty new tests across seven files cover native roles/names, keyboard activation and dismissal, explicit submit behavior, disabled/loading semantics and reason descriptions, status icon + label, field descriptions/errors, reserved skeleton size, stepper current state, toast dismissal, full-ID clipboard success/failure/stale-feedback prevention, immediate final reduced-motion values, interruption of count-up, Motion policy and ECharts preference changes. jsdom's missing ResizeObserver is stubbed only in tooltip tests; real layout/focus dismissal is checked separately in Chrome.

## Bundle delta versus Phase 1

Same production build command with hooks skipped. Values are minified kB as reported by Vite; “initial JS” means the entry chunk used in the approved baseline, not the sum of every route asset.

| Asset | Phase 1 | Phase 2 | Raw delta | Gzip Phase 1 → Phase 2 |
| --- | ---: | ---: | ---: | ---: |
| Initial JS | 364.28 | **365.05** | **+0.77** | 111.50 → **111.83** (+0.33) |
| MapView | 1,184.36 | **1,184.36** | **0.00** | 320.21 → **320.21** |
| Charts | 562.42 | **562.42** | **0.00** | 189.12 → **189.12** |
| CSS | 228.11 | **242.66** | **+14.55** | 39.44 → **42.26** (+2.82) |

CSS growth contains the token and primitive/state rules. Shared FeedbackMessage/HealthStatus chunks also grow with the adopted Button/Banner/status icons; the entry delta alone is not the total route cost. Unused Tooltip/Popover/StatCard consumers are not pulled into production routes. Optional count-up's dynamic module is available when adopted later; it is not eagerly included just to provide MotionConfig. Existing >500kB map/chart chunk warnings remain visible and were not suppressed.

## Contrast measurements

Chrome computed foreground/background colors were sampled from the isolated harness at both widths, including default, hover/focus/pressed, loading/disabled, status, field/placeholder/error, banner, stepper, toast, tooltip and copy-feedback states. Every built-in text opacity was **1**; disabled controls and placeholders are not faded. Identical combinations are grouped below; the full sample/state list is in `.qa/phase2/primitives-browser.json`.

| Foreground / background | Ratio | Uses |
| --- | ---: | --- |
| `#e3ebf7` / `#060c19` | **16.28:1** | Text on page, ghost ID/current step |
| `#060c19` / `#38bdf8` | **9.12:1** | Filled primary action, including hover/press |
| `#e3ebf7` / `#0c1627` | **15.08:1** | Card, control, banner and empty-state text |
| `#f3a6a6` / `#0c1627` | **9.33:1** | Destructive text, failed status, field error |
| `#8a9bb5` / `#0c1627` | **6.41:1** | Labels/hints/placeholders/disabled/loading/neutral status |
| `#86d6b1` / `#0c1627` | **10.58:1** | Ready/succeeded |
| `#5b9cf5` / `#0c1627` | **6.48:1** | Partial |
| `#38bdf8` / `#0c1627` | **8.45:1** | Running |
| `#e7c47a` / `#0c1627` | **10.84:1** | Not-ready/warning |
| `#8a9bb5` / `#060c19` | **6.92:1** | Step descriptions and copy feedback |
| `#38bdf8` / `#060c19` | **9.12:1** | Current step numeral |
| `#e3ebf7` / `#101c31` | **14.19:1** | Toast, tooltip, hovered secondary/ghost |
| `#f3a6a6` / `#101c31` | **8.78:1** | Hovered destructive action |

All 13 sampled text pairs exceed 4.5:1; this is not a WCAG certification or a guarantee for arbitrary caller-supplied styled children. SectionHeading retains its existing section gradient; calculated text/muted ratios at its two opaque endpoints are **14.51/6.17:1** (`#0e1a2e`) and **15.22/6.47:1** (`#0b1526`). Interactive dim outlines have **4.01:1** against panel and **3.77:1** against raised; cyan focus has **8.45:1** and **7.95:1** respectively. Dark decorative card borders are not presented as sufficient input boundaries.

The unused map-glass helper's analytical brightest-backdrop composite (92% panel over white) is RGB **31.44, 40.64, 56.28**, with text **12.24:1** and muted **5.20:1**. Actual imagery/glass compositing is deferred until map-overlay adoption; no new live-map glass verification is claimed.

## Browser verification and screenshots

Installed Chrome via Playwright was available. A production preview on port 4173 exercised the actual app bundle with isolated existing synthetic catalogue/readiness fixtures, empty workspace lists and explicit 503 failures. **No real backend requests/writes were made.** A separate development-only UI harness on port 5174 exercised primitives not yet used in product routes.

- Before: **6 route/state-width checks passed**. After: **6 passed**. States: dashboard PageHeader/empty/health, dashboard retryable errors, `/analyses#data-provenance` SectionHeading, each at **1440×1000** and **390×1000**. No page overflow or browser runtime errors.
- After primitive harness: **2 viewport checks passed**. Verified input/select interaction, disabled input, final reduced-motion number, stopped CSS spinner, keyboard tooltip opening/Escape/focus retention and on-screen positioning, full-value copy feedback using an isolated clipboard stub, keyboard toast dismissal, 40px desktop compact and 44px mobile minimum targets. No overflow/runtime errors.
- Existing mobile application navigation still opens/closes with Escape and restores focus to its trigger at 390px.
- Actual computed provenance title/eyebrow sizes are **20px/12px**. Browser inspection caught a legacy override, corrected with targeted shared-component specificity; tab logic and workspace layout were not changed.

Before/after screenshots (QA-only data; full-page captures plus cropped shared areas):

| Shared area | 1440px | 390px |
| --- | --- | --- |
| PageHeader/dashboard | [Before](.qa/phase2/before-headings-1440.png) · [After](.qa/phase2/after-headings-1440.png) | [Before](.qa/phase2/before-headings-390.png) · [After](.qa/phase2/after-headings-390.png) |
| Health status | [Before](.qa/phase2/before-health-1440.png) · [After](.qa/phase2/after-health-1440.png) | [Before](.qa/phase2/before-health-390.png) · [After](.qa/phase2/after-health-390.png) |
| Feedback | [Before](.qa/phase2/before-feedback-1440.png) · [After](.qa/phase2/after-feedback-1440.png) | [Before](.qa/phase2/before-feedback-390.png) · [After](.qa/phase2/after-feedback-390.png) |
| SectionHeading | [Before](.qa/phase2/before-section-1440.png) · [After](.qa/phase2/after-section-1440.png) | [Before](.qa/phase2/before-section-390.png) · [After](.qa/phase2/after-section-390.png) |
| Full error state | [Before](.qa/phase2/before-errors-1440.png) · [After](.qa/phase2/after-errors-1440.png) | [Before](.qa/phase2/before-errors-390.png) · [After](.qa/phase2/after-errors-390.png) |
| Isolated primitives | [After](.qa/phase2/primitives-1440.png) | [After](.qa/phase2/primitives-390.png) |

The captured changed components and primitive gallery were visually inspected. This phase does **not** claim a new 15-route map/filter/export QA pass, real-backend operation verification, live tooltip adoption in app flows, cross-browser/screen-reader certification, Lighthouse scores or completed Phase 3–6 work. The 14 optional live-integration tests remain skipped. All screenshots/evidence remain local and ignored by Git.

## Open questions and handoff

No open question blocks Phase 2. No additional dependency or business capability is proposed. Phase 3 dashboard adoption/redesign remains pending explicit approval; DateRangePicker/Popover consumers and animated tabs remain deferred as requested.
