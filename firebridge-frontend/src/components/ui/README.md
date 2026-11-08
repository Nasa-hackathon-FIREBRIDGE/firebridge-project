# FIREBRIDGE UI foundation — Phase 2

Owned, typed React components using the original FIREBRIDGE palette. Import individual files to keep unused primitives out of production chunks. Phase 2 adopts these only in shared headings, feedback and health; dashboard/workspace layout changes are deferred. No product preview route is added.

## Tokens

`src/index.css` defines the original 14 palette variables unchanged, with additive roles. `ui.css` follows existing styles in `main.tsx`; Phase 5 `shell.polish.css` follows it for shared chrome and feedback.

| Group | Variables / values |
| --- | --- |
| Surfaces | `--surface-0..3` alias page/sidebar/panel/panel-soft |
| Text | `--text-primary` = text; `--text-secondary` = muted; `--text-decorative` = dim, never ordinary small text |
| Status | `--status-success #86d6b1`, warning `#e7c47a`, danger `#f3a6a6`; partial blue, active cyan, neutral muted |
| Spacing | `--space-1/2/3/4/6/8/12/16` = 4/8/12/16/24/32/48/64px |
| Shape | `--radius-small/control/card/pill` = 4/8/12/999px; decorative line border, interactive dim border |
| Elevation | Raised and overlay shadows use original page RGB at 35%/55%; opaque surfaces by default |
| Glass | `.ui-map-glass` only for map overlays; panel fallback, 92% panel RGB + 8px blur where supported |
| Layers | content/header/map-tools/popover/drawer/modal/toast/tooltip = 0/10/20/30/40/50/60/70 |
| Motion | fast/standard/enter = 120/200/320ms; standard/enter/exit cubic-beziers from approved audit |
| Type | label 12/16, table 14/20, body 15/24, subsection 16/24, section 20/28, title 28/36, hero 36/44, stat 32/40px |
| Fonts | `--font-ui` Segoe UI/system; `--mono` Consolas/Courier; IDs/coordinates only |
| Targets | `--target-control` 44px; compact 40px desktop, 44px below 768px |
| Breakpoints | tablet 768, existing sidebar 820, compact 1024, desktop 1280, wide 1440, extra-wide 1920px |

Breakpoint variables document the values; CSS media conditions must use matching literals because custom properties cannot be used there. Existing sidebar CSS/JS coordination at 820px is untouched. Global reduced-motion CSS stops animations, transitions and smooth scrolling. Existing ECharts reduced-motion handling is retained and tested. Metrics/date inputs use tabular numerals.

## Components

Native element props (including React 19 refs) pass through where indicated. Components do not fetch data or determine operational state.

| Import | Props and behavior |
| --- | --- |
| `Button` from `./Button` | Native button props; `variant=primary/secondary/ghost/destructive`, `size=small/medium/large`, `loading`, `disabledReason`. Defaults to `type="button"`; set `type="submit"` explicitly in a form. Loading retains its name, sets aria-busy, disables activation. Reason is visible and associated when disabled/loading. |
| `Card`, `BentoCard` from `./Card` | Native div props/children. Opaque surface; Bento adds restrained elevation. Supply an appropriate labelled region/heading only when useful; cards are not clickable by default. |
| `StatCard` from `./StatCard` | `label`, `value: number|string`, optional `context`, `trend`, `animate=false`, `formatValue`. Count-up is optional and its engine dynamically imported. Final value is immediately available to assistive technology and under reduced motion; no invented trend/context. |
| `StatusPill` from `./StatusPill` | `value: string`, native span props. Always icon + original readable label; supports ready/succeeded/partial/queued/running/failed/unsupported and existing health states. Unknown values remain visible with a neutral info icon; no silent success fallback. |
| `Input`, `Select` from `./Field` | Native input/select props plus required `label`, optional `hint`, `error`. Generated or supplied id; associated descriptions and invalid state; visible error; 44px outlined control. Select takes option children. No value parsing/validation is performed. |
| `Banner` from `./Banner` | Native div props; `tone=info/synthetic/warning/error`, optional `title`, children. Error defaults to role alert, others note; caller can override role. Essential identity and errors belong in visible content. |
| `Skeleton` from `./Skeleton` | Optional width/height (default 100%/24px), `label` (Loading). Reserve the final content's dimensions. Static placeholder, labelled status, no shimmer. |
| `EmptyState` from `./EmptyState` | Required `description`, optional `title`, `icon`, `action`, `className`. No invented default guidance/action. Icon is decorative; caller supplies a real reachable action. |
| `Tooltip` from `./Tooltip` | `children` one focusable ref-capable element; `content` supporting metadata. Radix handles portal, focus/hover, dismissal/collision. Escape closes without taking focus. No essential-only content, errors or disabled trigger without a focusable alternative. |
| `Stepper` from `./Stepper` | `label`, `steps: {id,label,state: complete/current/upcoming,description?}[]`. Presentational ordered list; aria-current step, status words for screen readers. Caller supplies actual state; no navigation or made-up processing timeline. |
| `Toast` from `./Toast` | `message`, `onDismiss`. Polite atomic live status, labelled keyboard-operable dismiss. Caller controls placement/lifecycle; no timeout/focus stealing, no dependency. Use persistent error Banner for failures. |
| `CopyableId` from `./CopyableId` | `value`, optional `label=ID`, `shortLength=8`. Visible mono abbreviation, full value in accessible button name; clipboard writes full value. Announced success/failure; failure exposes selectable full ID. Feedback is tied to the current value. |
| `MotionProvider` from `./MotionProvider` | `children`; applied once at root. MotionConfig reducedMotion user; 200ms standard default. Optional number interpolation uses 320ms. |

Phase 4 adds the approved `Popover` wrapper and `DateRangePicker` consumer; no new dependency or tab library/animated indicator is introduced. Tooltip and unused primitives are not eagerly imported by shared components. MotionConfig uses a selective named import; StatCard loads its interpolation component only when requested and motion is allowed.

Phase 5 adds `TabIndicator` as an `aria-hidden` child of the existing `/analyses` tablist. The parent retains all tab roles, keyboard handlers, selection and mounted-panel behavior. The marker observes focus/selection and element resize, uses scroll-content coordinates, and animates only transform/width for 200ms. Reduced motion places the final geometry immediately. It adds no focus targets, interaction handlers, panel transition or data delay. Shared CSS provides 120ms control/card feedback and a 200ms drawer transform while preserving the existing 820px boundary and drawer focus logic. KPI interpolation stays off; route transitions and additional toasts are omitted. Existing inline success/error announcements remain the source of feedback.

`Popover` takes a ref-capable `trigger`, a dialog `label`, and children; Radix provides Escape/dismissal/focus restoration. Its current Close action is labelled “Close date picker” because this wrapper serves the date consumer. `DateRangePicker` takes `start`, `end`, `onStartChange`, `onEndChange`, `disabled`, `triggerLabel` and `children`. The children are the original visible named native date inputs; the portal mirrors their state through the same callbacks and has no FormData names. The original form retains submission/validation/payload ownership. Every display uses YYYY-MM-DD and “end excluded · UTC”. Presets are intentionally omitted because current availability bounds are not established. Consumer layout/popover styling is lazy-loaded with `workspace.presentation.css`; no product preview route is added.

```tsx
import { Button } from './Button'
import { Input, Select } from './Field'
import { Banner } from './Banner'
import { CopyableId } from './CopyableId'

<Button variant="primary" disabled disabledReason="Select a saved area first">Run analysis</Button>
<Input label="Start · UTC" hint="YYYY-MM-DD" value={start} onChange={onChange} />
<Select label="Source" value={source} onChange={onSourceChange}>{existingOptions}</Select>
<Banner tone="synthetic" title="Test release">Synthetic data, not NASA observations</Banner>
<CopyableId value={analysis.id} label="analysis ID" />
```

These are composition examples, not additional data flows. Reuse existing handlers, states, validation and API payloads. Date consumers must show YYYY-MM-DD and visible “end excluded · UTC” when applicable; this phase does not replace existing date widgets.

## Accessibility and scope

- Use visible labels, semantic headings, native controls and focus rings. Status color is supplementary to icon/text. Keep actionable controls at least 44px on touch layouts.
- Use text-primary/secondary on opaque surfaces; no whole-control opacity for disabled states. Dim is suitable for outlines/decorative marks, not ordinary small text. Check actual composite colors before using glass.
- Preserve full synthetic identity, status, scope and limitations. Tooltips supplement visible metadata; truncation must not remove access to full values.
- Copy/status messages are polite live regions. Do not turn every static pill into a live region, or continually announce interpolated numbers.
- No fake trends, last-used values, example areas, job history, coverage or science. Empty strings/unknown states are not success or zero.
- No new routes, service/query changes, data parsing, tab keyboard/hash/mount changes, sidebar focus changes or provider changes.

Tests cover primitive semantics and interactions in jsdom; ResizeObserver is stubbed only for tooltip layout, whose actual focus/dismissal/positioning must be checked in Chrome. Production shared-component screenshots and the isolated ignored `.qa/phase2/` harness are recorded in the Phase 2 report; the harness is not shipped or connected to the backend.
