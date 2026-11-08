# FIREBRIDGE — Phase 1 UI audit and plan

Date: 7 November 2026. Status: **Phase 1 complete; stop for review before Phase 2.**

Branch: `codex/firebridge-ui-phase1-20261107`, created from `zakaria/zakaria_frontend` with the existing dirty working tree preserved. No application code, dependency, backend, contract, route, query, or business-logic changes in this phase. No commit, push, or deployment.

## Scope and evidence

This is a refinement of the current implementation. Preserve its map-first layout, collapsible setup, shared filters, selectable timeline, source comparison, record details, evidence explanations, export limitations, and original dark-blue palette.

Evidence: route and component source, CSS, package manifest, existing production QA reports, and baseline screenshots. Re-inspected `dashboard-1440.png` and `analyses-390.png` from `.qa/satellite-workspace/`. Those are earlier QA captures, not new screenshots or proof of completed redesign. The mobile capture includes a loading state; it does not establish missing result tiles. Per-screen findings below combine source inspection with the prior visual baseline, not a new browser run on every screen.

The earlier screenshot brief is not fully representative of the current code: NASA archival satellite imagery is already the unconfigured default; light OSM is an optional street layer. Study geometry, detection rendering, legend, scale, coordinates, drawing, layers and empty/loading messages already exist. Improve their hierarchy and discoverability rather than rebuilding them. The current full-page dashboard capture does not reproduce the reported clipped “Start with a place” card; retain this as a viewport regression check.

## Detected stack

Versions below are declared in the current `package.json`; ranges remain unchanged.

| Area | Existing implementation |
| --- | --- |
| Runtime/UI | React and React DOM `^19.3.1`, TypeScript `~7.0.2`, Vite `^8.3.5`, npm lockfile |
| Navigation | React Router DOM `^7.18.4`, BrowserRouter; existing URL/query/hash behavior |
| Styling | Tailwind `^4.3.3` theme/utilities plus plain CSS; `index.css`, `App.css`, `astra.css`, `geospatial.css`, `platform.css`, analysis `workspace.css` |
| Data | TanStack React Query `^5.105.0`, Axios `^1.21.0`; existing hooks/services/validation |
| Contracts | `@firebridge/contracts@1.0.0`, local package at `../projet nasa/backend_FIREBRIDGE/packages/contracts` |
| Mapping | MapLibre GL `^6.16.0`, Terra Draw `^1.38.0`, MapLibre adapter `^1.5.0` |
| Charts/icons | ECharts `^6.1.0`, echarts-for-react `^3.0.6`, lucide-react `^1.62.0` |
| Validation | Oxlint `^1.89.0`, Vitest `^5.0.5`, Testing Library, jsdom; Playwright `^1.64.1` |
| Component/motion foundation | No existing Radix/shadcn or animation runtime dependency |

The contract link resolves to the actual backend directory `C:\Users\Mohamed El Korchi\Desktop\projet nasa\backend_FIREBRIDGE`. Keep the dependency. Both `predev` and `prebuild` regenerate contracts in that backend; this phase deliberately did not invoke those hooks.

## Screen inventory and audit

Severity: **P1** impairs reading or the primary task; **P2** adds friction or inconsistency; **P3** polish. These are design priorities, not claims of backend defects.

| Route/screen | Severity | Current problem or risk | Proposed presentation change |
| --- | --- | --- | --- |
| `/dashboard` — public saved analyses | P1 | Hash-first rows, repeated full release names, duplicated status counts, small metadata, unequal column whitespace. Saved areas lack shape previews; job rows require inspection for detail. | Human area + accurate date range first; copyable secondary ID; scoped test-release banner and short item tags; one segmented status summary; bento hero/register/activity/areas/sources grid. Use only available job and area fields. |
| `/analyses` — native map workspace | P1 | Small tabs/filter labels; native date locale differs from surrounding English copy; setup below a long map/timeline stack; raw geometry editor is prominent when no area is selected. Existing map guidance/controls can compete for space. | Taller responsive hero map with compact overlays; persistent collapsible Define → Interval → Run → Review presentation around existing forms; visible primary action and reason when disabled; draw first, advanced GeoJSON disclosure; larger scrollable tabs and clear filter scope. |
| `/api-analysis` — structured results | P1 | UUID-first entry, dense structured facts, mixed English/French chrome; ten result sections and creation controls compete. | Separate open/create/result hierarchy, readable field/value layouts and mobile record cards, consistent component styling; retain existing language/content and all ten result tabs pending locale decision. |
| `/catalog` — catalogue and tools | P2 | Dense release/source/version metadata and filtering; synthetic identity can be lost among technical fields. | Clear release hierarchy and compact identity tags; readable source cards, progressive metadata disclosure and shared empty/error/loading treatments; retain tools and pagination. |
| `/evidence` — data and methods | P2 | Long explanations, links and caveats compete at similar emphasis. | Group data identity, observation scope, method limits and provenance; stronger section anchors and copyable metadata; keep all limitations and source links. |
| `/ingestion` — operator workspace | P1 | Credential entry, budgets, time fields, planning, subscriptions and gaps create a dense technical workflow. | Strong session boundary and form groups; clear operation/result separation, readable budgets/UTC labels, accessible feedback; retain credential handling, permissions and exact actions. |
| `/settings` — preferences | P2 | Global presentation versus demonstration-only controls need clear scope; compact toggle rows. | Group preferences by scope, larger switches/labels and useful helper text; preserve the existing local behavior and absence of account persistence. |
| `/` — demonstration overview | P2 | Metrics, map, source cards and notes share small typography; repeated demo qualifiers. | Apply tokens and bento hierarchy, one persistent demo banner plus concise per-item identity; retain fixture counts, units and caveats. |
| `/explore` — demonstration map | P2 | Dense overlays and data inspection compete on mobile; same small map typography. | Reuse map chrome and record-card styles, reduce simultaneous overlays, retain explicit synthetic identity and existing drawing/filter behavior. |
| `/compare` — demonstration source comparison | P2 | Dense charts can imply comparable scientific measurements if native units/support are visually secondary. | Strong source headings and readable chart labels, adjacent native-unit/support caveat, clear empty state; keep raw versus harmonized distinctions. |
| `/calendar` — demonstration timeline | P2 | Dense period labels and small selectable targets; selected interval needs stronger emphasis. | Larger period targets, visible selected/focus state, readable counts and UTC scope; retain selection semantics and original values. |
| `/weather` — demonstration context | P2 | Unavailable context can look like an unfinished ordinary data card. | Purposeful unavailable state with what is missing and existing navigation; no invented weather readings, trend or integration. |
| `/reports` — demonstration evidence notes | P2 | Similar note rows and status treatments obscure review/relationship distinctions. | Clear title/status/source hierarchy and detail disclosure; retain that candidate or unreviewed reports do not confirm a fire. |
| `/explain` — demonstration explanation | P2 | Dense narrative and limitations need reading hierarchy. | Readable narrative blocks with clear fixture/no-live-AI identity, retained limitations and links; do not imply generated scientific findings. |
| `/alerts` — demonstration watchlist | P2 | Unavailable notifications need a clear capability boundary. | Consistent unavailable/empty treatment and existing navigation; no simulated monitoring, subscription or delivery claims. |
| Shared shell across all routes | P1/P2 | Tiny navigation/footer/eyebrow text; several CSS layers; inconsistent control sizing. | Preserve working navigation, focus handling and demo separation; apply readable tokens and common state layers, then consolidate proven duplicate CSS incrementally. |

Wildcard redirects to `/` remain unchanged. No route additions, removals or renames are proposed.

### Nested screens retained

- `/analyses`: Map workspace, Overview, Observations, Timeline, Compare sources, Data & provenance, Context & notes, Exports. Preserve selected record details, filter state, URL/hash behavior and mounted-panel behavior.
- `/api-analysis`: summary, detections, calendar, provenance, coverage, cell, comparison, weather, reports, explanation. Preserve every filter, pagination action and request/result state.
- Ingestion: operator-session entry and active session; planning/result, subscriptions and gaps; budget and time fields.
- Shared states: first use/no selection, loading, stale refresh error, empty filtered result, missing record, partial/unsupported component, API failure, job queued/running/failed/succeeded, unavailable export and downloadable export.

## Shared component inventory

| Existing files/components | Phase 2–5 role |
| --- | --- |
| `ApplicationShell`, `SidebarMenu`, `workspace/WorkspaceSidebar`, `PageHeader`, `SectionHeading`; local `PageHeading`, `GlobalControls` in `App.tsx` | Shared layout, navigation, headings, scope banner and responsive shell. Retain existing routes and focus behavior. |
| `RouteErrorBoundary`, `FeedbackMessage`, analysis `Feedback` (`Status`, `Empty`, `ApiError`), `HealthStatus` | Consistent error, status, empty and readiness presentation without changing error classification or readiness semantics. |
| `DashboardPage` local metrics/register/status distribution/jobs/areas/catalogue preview/empty state | Bento composition and human record hierarchy, existing loaded-record scope. |
| `AnalysisWorkspace`, `AreaPanel`, `AnalysisPanel`, `SpatialPanel`, `JobPanel`, `ExportPanel` | Workflow presentation around existing forms, map, jobs and export actions. |
| `MapView`, `MapWorkspaceControls`; `MapToggles` in `App.tsx` | Common map overlay, tools, legend, responsive targets and guidance; keep map instance, event handlers, layers and attribution. |
| `ObservationSummary`, `ObservationFilterBar` in `ObservationFilters`, `ObservationsPanel`, `TemporalPanel`, `SourceComparison`, `DetectionDetails` | Accessible shared filters, time/source selection, readable tables and details. Keep scientific scope captions. |
| Observation `ProvenancePanel`, `ContextPanel`; `CatalogPanel`, API `CatalogTools` | Provenance, catalogue, limitations and tool layout. |
| API `ApiPrimitives`: `ResourcePanel`, `ApiErrorMessage`, `Facts`, `Records`, `StructuredValue`, `Limitations`, `Pager`, `Filters` | Reusable factual records, nested values, accessible pagination/filter controls; preserve full values in detail views. |
| API `NativePanels`: summary/detections/calendar/provenance; `ContextPanels`: coverage/cell/comparison/weather/reports | Apply common typography, panels and record layouts to all result screens. |
| `ExplanationRequestPanel`, `ExplanationResult`, `ChatWidget` | Request/status/narrative presentation while retaining real service versus demo capability boundaries. |
| `Charts`: `ActivityChart`, `SensorBars`, `CalendarChart`; `SensorSelector` | Readable labels/tooltips, units and keyboard alternatives; preserve existing token colors and reduced-motion handling. |
| `App.tsx` local `KpiGrid`, `DetectionTable`, `EvidenceRow`, `InfoCard`, `Callout`, `EmptyState`, `ToggleRow` | Gradual adoption of the same core components across retained demonstration screens. |

Protected integration boundaries: `hooks/`, `services/`, query keys, request payloads, result aggregation/filter logic, API validation, tile protocol, shared contracts, fixture contents and backend files. UI components may consume their existing outputs; do not refactor those boundaries as part of visual work.

## Proposed design system

Swiss typography and grouping; a restrained dashboard bento grid; tonal dark elevation and visible interaction states. Glass only on floating map overlays. Orange indicates fire/alerts, cyan/blue indicates interaction. Icons and labels always accompany status colors.

### Exact colors: preserve original values, fix their roles

| Token/role | Value | Usage |
| --- | --- | --- |
| `--page` | `#060c19` | Application canvas, elevation 0 |
| `--sidebar` | `#08111f` | Navigation, elevation 1 |
| `--panel` | `#0c1627` | Cards and sections, elevation 2 |
| `--panel-soft` | `#101c31` | Raised/hover surfaces, elevation 3 |
| `--line` / `--line-soft` | `#1b2a44` / `#15223a` | Decorative separators and card borders |
| `--text` | `#e3ebf7` | Primary text |
| `--muted` | `#8a9bb5` | Readable secondary text and labels |
| `--dim` | `#64779a` | Decorative marks and control outlines; not small meaningful text |
| `--teal` / `--accent` | `#38bdf8` | Primary action and focus; dark `--page` text on filled cyan |
| `--teal-deep` | `#1d7fb8` | Existing accent shading; not a default small-text fill pairing |
| `--blue` | `#5b9cf5` | Secondary interaction, partial status |
| `--orange` | `#f08a4b` | Fire/alert semantics |
| Existing `--success` | `#86d6b1` | Ready/succeeded, labelled with check icon |
| Existing `--warning` | `#e7c47a` | Operational warning with explicit label |
| Existing `--danger` | `#f3a6a6` | Failed/destructive state with explicit label |

Proposed status aliases: ready/succeeded → success; partial → blue + “Partial”; queued → muted + clock; running → cyan + activity; failed → danger + failure icon; unsupported → muted + unavailable icon/dashed treatment. Do not merge these underlying states. Disabled controls retain readable muted labels, an outline and adjacent explanation rather than reducing the entire control to near-invisible opacity.

Computed opaque sRGB contrast samples, not a complete accessibility certification:

| Foreground | On page | On panel | On panel-soft |
| --- | --- | --- | --- |
| text | 16.28:1 | 15.08:1 | 14.19:1 |
| muted | 6.92:1 | 6.41:1 | 6.03:1 |
| dim | 4.33:1 | 4.01:1 | 3.77:1 |

Thus the original palette can remain intact: use `muted` rather than `dim` for ordinary small text. Check every actual text/background/opacity pairing and chart legend during implementation. Decorative dark separators must not be the sole visible boundary of an input; proposed control outlines use `dim`, and focused controls use cyan.

### Geometry, layering and type

| Group | Proposed exact tokens |
| --- | --- |
| Spacing | `4, 8, 12, 16, 24, 32, 48, 64px`; 16px mobile page inset, 24px desktop, 32px wide; 16/24px grid gaps |
| Radius | 4px compact controls, 8px inputs/buttons, 12px cards/drawers, 999px status pills |
| Borders | 1px decorative `line`; 1px interactive `dim`; 2px cyan focus outline with 3px offset |
| Elevation | 0 page; 1 sidebar; 2 panel; 3 panel-soft. Raised shadow `0 8px 24px rgb(6 12 25 / 35%)`; overlay shadow `0 16px 48px rgb(6 12 25 / 55%)` |
| Map glass | `rgb(12 22 39 / 92%)`, 8px backdrop blur, 1px line border; opaque panel fallback. Validate contrast over bright imagery. |
| Z-index | content 0; sticky header 10; map tools 20; popover 30; mobile drawer 40; modal 50; toast 60; tooltip 70. Isolate map stacking so its controls cannot cover app dialogs. |
| UI font | `'Segoe UI', system-ui, Arial, sans-serif`; no font download |
| Mono font | `Consolas, 'Courier New', monospace`; only IDs, coordinates, technical values |
| Type | label 12/16px; table 14/20px; body 15/24px; subsection 16/24px; section 20/28px; title 28/36px; hero 36/44px (28/36 mobile); KPI 32/40px |
| Weight | 400 body, 500 labels, 600 headings/actions; tabular numerals for metrics and date columns |
| Targets | 44px default minimum control height/width; 40px only compact desktop controls; 44px touch targets on map/mobile |

Avoid all-caps tracking on long labels, tiny mono prose, fixed card heights that clip content, and shadows on every nested section. Errors and important limitations stay visible outside tooltips.

### Motion and breakpoints

- Durations: 120ms hover/press/focus feedback; 200ms tab indicator, disclosure and copy feedback; 320ms panel presence, short entrance and KPI interpolation. Stagger 24ms, maximum six visible cards; never stagger access to table records.
- Easing: standard `cubic-bezier(0.2, 0, 0, 1)`; enter `cubic-bezier(0.16, 1, 0.3, 1)`; exit `cubic-bezier(0.4, 0, 1, 1)`.
- Reduced motion: no layout/slide/count/stagger/shimmer motion; present final values immediately. Set Motion's reduced-motion policy and explicitly disable remaining CSS/ECharts motion. Do not hide data until an animation completes.
- Base layout supports 390px; test down to the existing 360px minimum. Layout thresholds: 768px tablet, 1024px compact desktop, 1280px desktop, 1440px wide, 1920px extra wide. Preserve the currently coordinated 820px sidebar behavior unless its CSS and presentation-only matchMedia are changed together in a reviewed shell pass.
- Dashboard: one column on mobile; two on tablet; 12-column grid on desktop, hero/status across the grid, register about 8 columns and activity/areas about 4. Let content determine height.
- Workspace: on desktop, a map/workflow grid with a 320–360px workflow column and flexible map; on narrow screens, map followed by collapsible workflow with reachable sticky action. Target map height `clamp(480px, calc(100dvh - 220px), 900px)` desktop and `clamp(360px, 56dvh, 560px)` mobile; tune against actual filter/header height rather than clipping controls.

## Animation and component approach

Choose **Motion for React** as the sole animation library. Its React 18.2+ requirement accommodates this React 19 app; it provides layout/presence and reduced-motion controls. Use free core features with selective/lazy imports, not Motion+ examples or an additional animation engine. [Installation](https://motion.dev/docs/react-installation), [accessibility](https://motion.dev/docs/react-accessibility), [MIT license](https://github.com/motiondivision/motion/blob/main/LICENSE.md).

Use owned, shadcn-style component composition with a small **Radix** foundation, adapted to the existing CSS variables. Radix provides focus/keyboard/ARIA behavior for complex primitives; application labels, contrast and integration still require testing. Its Tooltip and Popover manifests explicitly support React 19. [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility), [Tooltip manifest](https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/tooltip/package.json), [Popover manifest](https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/popover/package.json), [MIT license](https://github.com/radix-ui/primitives/blob/main/LICENSE).

Planned direct dependencies, **none installed in Phase 1**:

| Package | Reason / planned scope |
| --- | --- |
| `motion` | One motion engine for indicators, presence and light layout changes; native CSS for simple state color transitions |
| `@radix-ui/react-tooltip` | Keyboard-accessible supporting metadata and full release labels; essential data identity also visible in the banner/details |
| `@radix-ui/react-popover` | Date-range/preset disclosure with focus restoration and dismissal; keep existing date fields, validation and apply handlers inside |

Choose published compatible versions and verify current peer ranges, maintenance/release activity, lockfile integrity and actual bundle delta before installing in a later phase. Repository manifests are compatibility evidence, not a claim that repository versions are the current npm releases. No dependency version is being pinned from an unverified branch snapshot.

Build native Button, Card/BentoCard, StatCard, StatusPill, Input/Select, Skeleton, EmptyState, DataTable/mobile record row, Toast, Stepper and Banner around existing semantics. Preserve the working tab keyboard/hash/mount logic and add a visual indicator; a wholesale tab-library replacement is unnecessary. DateRangePicker is a presentation wrapper around current inputs and callbacks. No new table engine, chart package, calendar/date library, font or command-palette package is planned.

Use shadcn documentation for API/composition patterns, not an automatic CLI overwrite of existing components. No third-party component source is copied in this phase. If any source is adapted later, record its exact origin/version, check its license and retain required notices. [shadcn introduction](https://ui.shadcn.com/docs), [MIT license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).

## Reference interpretation

| Reference | Applied principle and limit |
| --- | --- |
| Linear/Vercel/Datadog | Restrained action hierarchy, compact but readable data, consistent status and focus. Inspiration only; no copied screens or product assets. |
| Mapbox Studio/Planet | Map as primary workspace, progressively disclosed tools, readable overlay groups and persistent study context; retain MapLibre and current providers. |
| Mobbin | Public landing page inspected; use recognition, clear empty-state next steps and consistent list/form structure as design goals. No paid library or specific authenticated flow was inspected. [Source](https://mobbin.com/) |
| Refero | Public URL yielded no readable content; treat as general product-flow inspiration, not reviewed evidence of a particular pattern. [Source](https://refero.design/) |
| Untools | Public decision-framework index inspected; apply an impact/effort priority order: readability and task reachability before decorative motion. Hick/Fitts/Gestalt are design heuristics applied here, not claims that this index proves them. [Source](https://untools.co/) |
| Manus-style jobs | Interpret as clear present stage, reported progress and activity hierarchy. No invented agent steps, streaming events, predictions or logs. |
| Kokonut/Cult/Aceternity/Skiper/Smooth/Animata/Eldora/Magic, React Bits | Optional visual inspiration only; no source selected, installed or license-approved. A subtle pointer spotlight is optional on dashboard bento cards only, disabled for reduced motion/touch if distracting. |
| Godly/Land-book/Awwwards | Marketing-only inspiration; no marketing route is being added, so exclude their ornamental patterns from scientific data screens. |

## Data honesty and hard-constraint resolutions

1. **Backend records versus synthetic observations:** an item fetched from the real API can still belong to a synthetic release. Say “Server records” for transport origin and “Synthetic” for dataset identity. Keep demo fixtures separate. The existing published test release is not evidence of NASA fire observations.
2. **One banner, safe per-item identity:** derive banner content from already-loaded release metadata. For mixed releases, use a neutral mixed-data banner and relevant short Synthetic tags. Do not infer “real observations” from an unknown release name or an API success. Keep full original release names in accessible detail/tooltip, preserve supplied area names, and show “Release metadata unavailable” when unknown. Deduplication cannot erase identity.
3. **Status and scope:** repeated Partial labels describe individual records and must remain, with quieter styling. Replace duplicate dashboard visualizations with one summary derived from the same loaded records and current filter. Keep “loaded selection,” pagination and stale-data caveats; never imply account-wide totals.
4. **Map completeness:** aggregate tiles describe the full saved interval. A filtered record map shows matching loaded/paginated detections, not complete aggregate results. Preserve separate mode labels, scope text and load-more state; legends never imply observation coverage, burned area, confirmed fire or a harmonized comparison. Existing tile/filter logic is protected.
5. **Dates:** the end boundary is exclusive UTC. Prefer a human start→end label with a concise visible “end excluded · UTC” note and exact detail. Do not turn a 15–18 July exclusive interval into an inclusive 15–18 July claim. A possible inclusive-day label would be 15–17 July, only for whole-day intervals; any such formatter needs explicit boundary tests.
6. **Jobs:** use the existing `JobPanel` finite 0–100 percent check, `current_stage`, status and attempts. Show progress as “not supplied” if absent. Use existing timestamps for relative display with exact UTC detail; do not fabricate a historical activity timeline or estimated completion. Preserve polling and retry restrictions.
7. **Saved areas:** draw a small SVG shape only from geometry already loaded; show name/version/supplied surface when available. No additional data fetch is proposed. No `last used` value is established by the current list UI; omit it, or explicitly label an existing loaded-analysis timestamp “Latest loaded analysis,” never global last use.
8. **Dark maps:** keep the current configured/default provider and all attribution. Style chrome and optionally desaturate/darken the existing street raster through presentation-only paint; do not replace URLs, providers or fetching. Preserve archival satellite colors and imagery/date limitations; contextual imagery is not an observation layer.
9. **Drawing/example/presets:** foreground the existing drawing action and retain GeoJSON validation. Do not introduce an invented example area into the operational workflow. A “Load example” action requires an explicitly labelled existing demo fixture; otherwise omit it. Presets may populate existing fields only within established bounds and submit through current handlers; no new availability inference or backend query semantics.
10. **Unavailable features:** do not add weather feeds, report verification, notifications, retry endpoints, harmonization, scientific conclusions or fake KPI trends. Trend/context fields appear only when existing data support them. Skeletons replace presentation placeholders, never missing data with made-up values.

## Proposed implementation sequence after review

| Phase | Reviewable scope and likely files | Acceptance gate |
| --- | --- | --- |
| 2 — foundation | Token aliases and component styles in current CSS; small owned primitives under `src/components/ui/`; adopt in shared headings/feedback. Add a short UI component README, not a new product route. Add the three planned dependencies only after release/peer/license verification. | Readable text and controls, status semantics, focus/reduced motion; no service/hook/contract/router changes. |
| 3 — dashboard | `DashboardPage.tsx` and dashboard styles; banner/tag, human row labels, one status summary, area preview and factual job presentation. | Counts and pagination unchanged; full data identity accessible; empty/loading/error/mobile states verified. |
| 4 — workspace | `AnalysisWorkspace`, `AreaPanel`, `AnalysisPanel`, `SpatialPanel`, map controls and observation presentation. Preserve existing handlers and result logic. | Existing tabs, drawing, filters, URL state, timeline, source comparison, detail and export behavior retained; action reachable and disabled reason visible. |
| 5 — motion/polish | Shared UI/shell/tab styling and copy feedback; optional navigation-only command palette only if it adds value without new dependencies. | No access delays, fake progress or decorative chart data; keyboard focus survives transitions. |
| 6 — platform QA | Apply foundation consistently to remaining routes and API panels; remove only confirmed-unused CSS after checking all routes/states. Update the validation report and before/after artifacts. | Full frontend checks, browser interactions and all six requested widths; bundle delta and measured performance reported. |

Each later phase should remain a small diff and include its own changed-file/dependency list and validation. No commits are made automatically; the existing uncommitted implementation must not be swept into a new UI commit.

### Later quality gates

- Run `npx tsc -b`, lint, tests and a frontend production build after each implementation group. Preserve the 14 optional live-integration skips unless separately configured; never report skips as passes. No backend write integration runs for a presentation task.
- Production browser checks at 1920, 1440, **1280**, 1024, **768**, 390px. The prior pass covered only 1920/1440/1024/390, so 1280 and 768 remain additional work. Verify zoom, keyboard navigation, mobile cards/scrolling, drawer focus, map targets, date/tab controls and no overlay collisions.
- Capture before/after dashboard and workspace at desktop/mobile, both no-selection and selected-analysis states. Use clearly isolated synthetic fixtures where needed; keep separate GET-only real-backend checks and do not present fixture results as live science.
- WCAG 2.2 AA checks: actual contrast including alpha states, visible focus, accessible names, keyboard and screen-reader flow, tabs/live regions, color-independent status, zoom/reflow. This audit does not certify compliance.
- Lighthouse performance/accessibility/best-practices >=90 is a target to measure, not a current result. Record conditions and tool version. Check initial and lazy chunks separately; retain existing lazy map/chart loading and avoid remounting the map for visual transitions. Reserve space for skeletons to prevent layout shift.

## Exact Phase 1 validation

Fresh checks on 7 November 2026, against the unchanged application baseline:

| Check | Result |
| --- | --- |
| `npx.cmd tsc -b` | PASS, exit 0, no diagnostics |
| `npm.cmd run lint` | PASS, exit 0, no diagnostics |
| `npm.cmd test -- --reporter=dot` | PASS, exit 0: **190 passed, 14 skipped (204)**; **23 files passed, 2 skipped (25)**; **10.29s**. Expected error-path logs were printed. |
| `npm.cmd --ignore-scripts run build` | PASS, exit 0: frontend `tsc -b && vite build`; **2,738 modules**, Vite **2.12s**. Contract lifecycle prebuild intentionally skipped to avoid writing backend artifacts. This is not a fresh run of the backend contract build. |
| Contract resolution | PASS: `npm.cmd ls @firebridge/contracts --depth=0` resolves `@firebridge/contracts@1.0.0` to the actual existing backend package |
| Palette comparison | PASS: **14/14** original tokens equal `746e7c9:src/index.css` |
| `git diff --check` | PASS, exit 0; existing LF→CRLF notices are Git normalization warnings, not whitespace errors |
| Existing-file integrity | PASS: SHA-256 comparison of all **143** pre-existing tracked/untracked non-ignored files found **zero changes**; only this report was added |
| Phase 1 browser work | No new live-browser run; existing screenshots reviewed. No UI changed, so no “after” screenshots are applicable. |

Fresh build sizes: initial JS **364.28 kB / 111.50 kB gzip**; MapView **1,184.36 / 320.21 kB gzip**; Charts **562.42 / 189.12 kB gzip**; CSS **228.11 / 39.44 kB gzip**. Existing >500kB chunk warnings remain visible. No dependency or bundle growth was introduced in Phase 1.

Earlier validation in `SATELLITE_PLATFORM_REDESIGN.md` remains historical evidence: 60 route/viewport renders and separate real-backend read checks. It is not a new all-route browser certification for this audit. Formal screen-reader, Lighthouse, 1280/768px, and post-implementation checks remain to be performed.

## Handoff

Completed: branch isolation, stack/route/component inventory, prioritized audit, exact proposed tokens, motion/component/dependency choices, constraint resolutions, and fresh frontend validation. **Only this report is added by Phase 1.**

Remaining: all Phase 2–6 implementation and its visual/accessibility/performance verification. No technical blocker prevents Phase 1 completion. The explicit review boundary prevents proceeding with implementation now.

Review choices: proposed hierarchy and tokens; three planned dependencies; preserve existing locale by default (a complete English/French localization migration is not included); omit unsupported last-used/history/example claims as described above. No further information is needed to review this plan.
