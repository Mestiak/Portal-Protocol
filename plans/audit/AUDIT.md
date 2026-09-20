# Portal Protocol — Impeccable Technical Audit

- **Date**: 2026-08-18
- **Mode**: Operate (desktop app UI — Tauri/SvelteKit webview)
- **Scope**: `src/routes/+page.svelte`, `ApiTracker.svelte`, `StatsModal.svelte`, `AnalyticsDashboard.svelte`, `FilterBar.svelte`, `src/app.css`
- **Method**: mechanical detector (`detect.mjs`) + manual dimension scans. Score 0-4 per dimension.
- **Note**: Documentation only — no source changed. Fixes belong to later commands.

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | Main screen well-labeled; secondary screens (ApiTracker/AnalyticsDashboard) lack ARIA/roles; 1 dropdown is keyboard-inaccessible |
| 2 | Performance | 3 | No `will-change` overuse, minimal blur/filter, transitions now GPU-friendly; feed virtualization unverified |
| 3 | Responsive | 3 | Desktop app shell; media queries present; no hard widths/overflow in components |
| 4 | Theming | 3 | Coherent dark token system (by design); `+page.svelte` mixes raw hex heavily (ratio 0.53) |
| 5 | Implementation Integrity | 3 | Detector clean (0 real antipatterns); consistent GW2-dark design language |
| **Total** | | **14/20** | **Good — address weak dimensions** |

## Implementation Integrity Verdict
**Pass (minor).** `detect.mjs` returned **0 real antipatterns** across all 5 components (its single "broken-image" hit was a false positive inside a `/* comment */` at `+page.svelte:1429`). The codebase expresses a coherent, product-specific dark theme with shared accent tokens; no decorative/interchangeable filler detected. Weakest spot is token discipline in `+page.svelte` (see Theming).

## Executive Summary
- **Score: 14/20 (Good).**
- **Issues by severity**: P0: 0 · P1: 1 · P2: 3 · P3: 3
- **Top issues**:
  1. **(P1)** `+page.svelte` `.card-dropdown-menu` `div[onclick]` — no `role`/`tabindex` → not keyboard reachable.
  2. **(P2)** ApiTracker/AnalyticsDashboard have near-zero ARIA labels & roles on interactive controls.
  3. **(P2)** `+page.svelte` uses more raw hex (`#…`) than `var(--token)` (113 vs 60) — token drift.
  4. **(P2)** Upload feed list virtualization unverified for large histories.
  5. **(P3)** Dark-only theme — acceptable by design, but no light fallback.

## Detailed Findings

### [P1] Keyboard-inaccessible dropdown
- **Location**: `+page.svelte` `.card-dropdown-menu` (`<div class="card-dropdown-menu" onclick=…>` — the 1 of 11 `div[onclick]` lacking `role`+`tabindex`).
- **Category**: Accessibility
- **Impact**: Users navigating by keyboard/Tab cannot open this menu; it's a focus trap by omission.
- **WCAG**: 2.1.1 (Keyboard), 4.1.2 (Name/Role/Value)
- **Recommendation**: Add `role="button"` + `tabindex="0"` and an `onkeydown` Enter/Space handler, or convert to `<button>`.
- **Suggested command**: `/impeccable harden`

### [P2] Missing ARIA on secondary screens
- **Location**: `ApiTracker.svelte` (0 `aria-*`, 0 `tabindex`, 7 `button[onclick]`), `AnalyticsDashboard.svelte` (1 `aria-*`, 1 `role`).
- **Category**: Accessibility
- **Impact**: Screen readers get little structural info; account tabs / chart controls poorly labeled.
- **Recommendation**: Add `aria-label` to icon-only buttons, `role="tab"`/`aria-selected` to account tabs, `aria-live` to status regions.
- **Suggested command**: `/impeccable harden`

### [P2] Token drift in `+page.svelte`
- **Location**: `src/routes/+page.svelte` — 113 raw hex colors vs 60 `var(--token)` usages (ratio 0.53). Newer components (`StatsModal` 1.12, `FilterBar` 4.67, `app.css` 1.73) are far cleaner.
- **Category**: Theming / Implementation Integrity
- **Impact**: Inconsistent with the token system; if `--accent`/`--bg` tokens change, these inline hexes won't follow. (Some are legit dynamic values, e.g. `swatchHex()`.)
- **Recommendation**: Audit inline `style="…color:#…"` blocks; route static colors through tokens; keep only genuinely dynamic values raw.
- **Suggested command**: `/impeccable document` (extract tokens) → `/impeccable layout`

### [P2] Upload feed virtualization unverified
- **Location**: `+page.svelte` feed/history lists (large `filteredUploads` / `allHistory`).
- **Category**: Performance
- **Impact**: With many logs, an unvirtualized list can cause scroll jank / memory growth.
- **Recommendation**: Confirm whether lists are windowed; if not, add `{#each}` keying + consider a virtual list for histories > ~200 entries.
- **Suggested command**: `/impeccable optimize`

### [P3] Dark-only theme (no light fallback)
- **Location**: `src/app.css:4` `:root` defines dark values only; no `prefers-color-scheme: light` branch.
- **Category**: Theming
- **Impact**: None for the target audience (GW2-themed dark app by design). Listed only for completeness.
- **Recommendation**: Leave as-is unless a light mode is a product goal.
- **Suggested command**: `/impeccable colorize` (only if light mode desired)

## Patterns & Systemic Issues
- **Token discipline degrades with file age**: `app.css` and newer components use tokens heavily; `+page.svelte` (largest/oldest) is the outlier. Indicates token adoption improved over time but legacy inline styles were never migrated.
- **A11y concentrated in the main screen**: `+page.svelte` carries 55 `aria-*` + 32 `role` + 21 `tabindex`; the secondary components were built without equivalent care.

## Positive Findings
- **Zero real antipatterns** from the mechanical detector.
- **Strong main-screen a11y**: 10/11 `div[onclick]` already have `role`+`tabindex`; all 13 `<img>` tags have `alt` (decorative `alt=""`, meaningful `alt={name}`).
- **Reduced-motion fully guarded** (from the prior motion pass): CSS loop-kill + 10 Svelte transition guards.
- **`will-change` not overused** (1 occurrence) and minimal `backdrop-filter`/`blur` — no obvious frame-drop sources.
- **Layout uses `100vw/100vh` only on the app shell** (correct for a desktop app filling its window), not on inner components.
- **Responsive media query present** (`@media (max-width:720px)`) for the narrow-window case.

## Recommended Actions (priority order)
1. **[P1] `/impeccable harden`** — make `.card-dropdown-menu` keyboard-accessible (role/tabindex/keydown).
2. **[P2] `/impeccable harden`** — add ARIA to ApiTracker / AnalyticsDashboard controls.
3. **[P2] `/impeccable document`** then **`/impeccable layout`** — extract tokens, migrate `+page.svelte` raw hex to tokens.
4. **[P2] `/impeccable optimize`** — verify/virtualize the upload feed for large histories.
5. **[P3] `/impeccable polish`** — final quality pass once the above land.

> You can ask me to run these one at a time, all at once, or in any order you prefer.
> Re-run `/impeccable audit` after fixes to see your score improve.
