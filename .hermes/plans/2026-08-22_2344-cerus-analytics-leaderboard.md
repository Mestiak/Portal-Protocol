# Cerus Multi-Log Leaderboard in Analytics Tab — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a "Cerus Leaderboard" section to the Analytics tab that aggregates every filtered Cerus CM/LCM/Normal log into a per-player leaderboard (Orbs, Orb %, Cry of Rage/rage hits, Envy Strip/boon strip, Malice damage) plus cohort summary cards — mirroring the single-log Cerus stats, but across many logs.

**Architecture:** The Analytics tab already receives `logs: AnalyticsLog[]`. Those logs do NOT carry per-player Cerus mechanics (orbs/malice/rage/strip) — that data is re-derived at view time from dps.report JSON via `extractMechanics()` and already summed across N logs by `mergeCerusReports()` (used by the Mechanics tab). So the new section fetches each filtered Cerus log's full data (`get_log_full`), runs `extractMechanics` → `mergeCerusReports`, and renders the resulting cohort `MechanicReport` in a new `CerusLeaderboard.svelte`. **No new backend parsing, no new storage, no new per-player fields.** Fully DRY.

**Refresh behavior (user choice B):** auto-build on any change to the Cerus scope (boss/mode/range), with a ~400ms debounce so rapid filter toggles don't spam fetches. Result memoized by filter key so an identical scope isn't refetched.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$effect`), Tauri `invoke`, existing `mechanicParser.ts` (`extractMechanics`, `mergeCerusReports`, `MAX_AGGREGATE_LOGS`), existing `analyticsEngine.ts` (`AnalyticsLog`, filter helpers), existing CSS classes (`.an-section`, `.an-card`, table styles from `CerusDashboard.svelte`).

---

## Current Context / Findings (grounded in code)

- `src/lib/analyticsEngine.ts` — `AnalyticsLog` has `boss_name`, `url`, `is_cm`, `is_lcm`, `timestamp`, but **no** per-player Cerus mechanic fields.
- `src/lib/mechanicParser.ts`:
  - `extractMechanics(logData, bossName)` → `MechanicReport | null` (Cerus-only shape when boss has Malicious Shadows).
  - `mergeCerusReports(reports: MechancinReport[])` → **sums** per-player `squadLedger` (orbs, cryRage, envyStrip) and `orbLeaderboard` (orbs) and `malicePlayers` (damage); sets cohort scalars `orbEfficiency`, `totalOrbs`, `empoweredGained`, `rageHits`, `shadowsReached`, `boonStrippedPlayers`, `totalEnvyStrips`. Sets `timeline: []` for multi-log (chart omitted). Returns `null` if no Cerus reports.
  - `MAX_AGGREGATE_LOGS = 25` cap + warning pattern already exists.
- `src/routes/MechanicsTab.svelte` (lines 53–82) — the proven fetch→extract→merge path: `invoke("get_log_full", { permalink })` → `extractMechanics(res.raw, res.stats.boss_name)` → `mergeCerusReports(reports)`. **Copy this pattern.**
- `src/routes/AnalyticsDashboard.svelte` — receives `logs` prop; `bossFilter`/`modeFilter`/`rangeFilter` state; `Player Performance Comparison` section renders when `bossFilter !== 'all'`. `invoke` already imported (line 3).
- `src/routes/CerusDashboard.svelte` — renders a `MechanicReport`; has the sortable "Squad Mechanics" table (`squadLedger`: orbs/cryRage/envyStrip) and "Orb Leaderboard" (`orbLeaderboard`). Reuse its CSS classes.
- Single-log card shows per-player: Orbs (`squadLedger.orbs`), Cry of Rage (`cryRage`), Envy Strip (`envyStrip`), Malice damage (`malicePlayers.damage`), Orb% (`orbEfficiency` cohort). The `cerus_empowered_stacks` badge is **boss-level**, not per-player.

### Honest data limitation (do not over-promise)
Per-player **Empowered stacks** are NOT available per-player from stored data (`cerus_empowered_stacks` is one boss-level number per log; `empoweredGained` is a squad-sum, not per-player). So the per-player leaderboard covers **Orbs / Orb% / Cry of Rage / Envy Strip / Malice Damage** (all genuinely per-player). Empowered appears as a **cohort card** (total Emp.A consumed + the boss-level `cerus_empowered_stacks` best seen). Per-player empowered is a Phase-2 stretch (needs backend per-player emit) — out of scope here.

---

## Data Source: dps.report vs Local EI (decision needed)

The per-player Cerus mechanics (orbs/malice/rage/strip) exist **only** in the EI/dps.report JSON — they are NOT stored on the `UploadRecord`. Two ways to obtain that JSON for a history log:

- **Hosted EI via dps.report (`get_log_full`)** — what the Mechanics tab already does. Works for EVERY historical log (even years old, file long deleted). Needs network + dps.report uptime. This is the default for v1.
- **Local EI re-parse (`ei_runner.run_ei`)** — runs the bundled EI on the raw `.zevtc`/`.evtc` on disk. Offline, no dps.report rate limit, but ONLY covers logs whose local file still exists (most uploaded logs are deleted/moved). Would also require feeding `extractMechanics` the local EI JSON shape and keeping raw files.

**Key clarification:** dps.report's raw JSON *is* EI's output (dps.report runs EI server-side). So "use EI instead of dps.report" really means "re-run EI locally vs call hosted EI" — the parsing code (`extractMechanics`) is identical either way.

**Recommendation:** v1 = dps.report route (covers all history, fully DRY with `mergeCerusReports`), **plus cache the extracted `MechanicReport` per permalink** in the existing `RAW_CACHE`/`ei_cache` machinery so repeat builds are instant and offline-tolerant. Local-EI is a Phase-2 enhancement (real but partial coverage — only logs still on disk).

---

## Proposed UI Design (plain language)

A new **"Cerus Leaderboard"** section appears in the Analytics tab **only when the current boss filter resolves to a set of Cerus logs** (boss name contains "cerus" or "febe"), respecting the active Mode (CM/LCM/Normal) and Range filters so the cohort matches what the rest of the tab shows. It **auto-builds** when the scope changes (debounced 400ms).

Layout, top to bottom:
1. **Cohort summary cards** (reuse `.an-card` style, 4–6 across): Orb Efficiency %, Total Orbs Collected, Empowered Gained (cohort), Rage Hits (cohort), Shadows Reached, Players Stripped (Envy). These mirror the single-log Statistics cards.
2. **Per-Player Leaderboard table** (the core "leaderboard"): one row per player (deduped by `account::name`), columns:
   - Player (toon + account + profession icon)
   - **Orbs** (summed `squadLedger.orbs`)
   - **Orb %** (share of squad orbs, `percent`)
   - **Cry of Rage** (rage hits taken, `cryRage`)
   - **Envy Strip** (boon strip touches, `envyStrip`)
   - **Malice Dmg** (`malicePlayers.damage`)
   - Each column header is **click-to-sort** (reuse `smSortBy` pattern from `CerusDashboard.svelte`), default sort by Orbs desc.
3. **Auto-build + states**: on scope change (debounced 400ms), fetch + merge. Show spinner while building; if N > `MAX_AGGREGATE_LOGS`, show the same skew warning the Mechanics tab uses; if `get_log_full` fails (offline/dps.report down), show the same inline error style as `MechanicsTab.analyzeError`. Result memoized by filter key so re-toggling the same scope doesn't refetch.

Visual language: identical to existing Analytics (`.an-section`, `.an-section-title`, `.an-card`, FA icons `fa-solid fa-trophy`). No new color system.

---

## Code Design (files + signatures)

### 1. `src/routes/AnalyticsDashboard.svelte` (modify)
- Add imports:
  ```ts
  import { extractMechanics, mergeCerusReports, MAX_AGGREGATE_LOGS, type MechanicReport } from '$lib/mechanicParser';
  ```
- Add state + derived:
  ```ts
  let cerusCohort = $state<MechanicReport | null>(null);
  let cerusLoading = $state(false);
  let cerusError = $state<string | null>(null);
  const cerusCohortKey = $derived(`${bossFilter}|${modeFilter}|${rangeFilter}|${customStartDate}|${customEndDate}`);
  // Cerus log URLs in the CURRENT filter scope
  let cerusLogUrls = $derived(
    logs.filter(isCerusLog)
      .filter(l => modeMatches(l, modeFilter))
      .filter(l => rangeMatches(l, rangeFilter, customStartDate, customEndDate))
      .map(l => l.url as string)
      .filter(Boolean)
  );
  let isCerusScope = $derived(cerusLogUrls.length > 0);
  ```
- Auto-build (user choice B) — debounced `$effect` on scope key:
  ```ts
  let cerusDebounce: ReturnType<typeof setTimeout> | null = null;
  let lastBuiltKey = '';
  $effect(() => {
    const key = cerusCohortKey;            // track
    const urls = cerusLogUrls;             // track
    if (urls.length === 0) { cerusCohort = null; return; }
    if (key === lastBuiltKey) return;      // memo: skip identical scope
    if (cerusDebounce) clearTimeout(cerusDebounce);
    cerusDebounce = setTimeout(() => {
      lastBuiltKey = key;
      buildCerusLeaderboard(urls);
    }, 400);
  });
  ```
- Builder (mirrors `MechanicsTab.analyze`):
  ```ts
  async function buildCerusLeaderboard(urls: string[]) {
    cerusError = null; cerusLoading = true;
    try {
      const reports: MechanicReport[] = [];
      const capped = urls.slice(0, Math.max(MAX_AGGREGATE_LOGS * 2, urls.length));
      await Promise.all(capped.map(async (u) => {
        try {
          const res = await invoke('get_log_full', { permalink: u }) as any;
          const mech = extractMechanics(res.raw, res.stats?.boss_name || '');
          if (mech && mech.boss === 'Cerus') reports.push(mech);
        } catch { /* skip bad log */ }
      }));
      cerusCohort = mergeCerusReports(reports);
      if (!cerusCohort) cerusError = 'No Cerus mechanic data found in the selected logs.';
    } finally { cerusLoading = false; }
  }
  ```
- Render (inside the `{#if bossFilter !== 'all'}` area, after Player Performance Comparison):
  ```svelte
  {#if isCerusScope}
    <div class="an-section">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-trophy"></i> Cerus Leaderboard</span>
        {#if cerusLogUrls.length > MAX_AGGREGATE_LOGS}
          <span class="an-warn">⚠ {cerusLogUrls.length} logs — averages may be skewed</span>
        {/if}
      </div>
      {#if cerusLoading}
        <div class="an-loading">Building leaderboard…</div>
      {:else if cerusCohort}
        <CerusLeaderboard report={cerusCohort} logCount={cerusLogUrls.length} />
      {:else if cerusError}
        <div class="an-error">{cerusError}</div>
      {/if}
    </div>
  {/if}
  ```
- Add small `modeMatches`/`rangeMatches` helpers (or reuse existing `applyFilters` if exported from `analyticsEngine`). Keep them tiny and local.

### 2. `src/routes/CerusLeaderboard.svelte` (NEW)
- Props: `{ report: MechanicReport; logCount: number }`.
- Renders:
  - Cohort cards row from `report.orbEfficiency`, `report.totalOrbs`, `report.empoweredGained`, `report.rageHits`, `report.shadowsReached`, `report.boonStrippedPlayers`.
  - Sortable per-player table built from `report.squadLedger` joined with `report.orbLeaderboard` (by `account::name`) and `report.malicePlayers` for a unified row. Reuse `smSortBy` sort pattern.
  - Click header → `smSort = { key, dir }`; derive sorted rows with `$derived`.
- Reuse existing CSS classes from `CerusDashboard.svelte` (`.an-card`, table `.sm-*` styles, `.an-section-title`). Add only a couple of helper classes if needed (`.an-warn`, `.an-loading`, `.an-error`) — prefer existing `.an-card-delta.bad` / button styles already in the file.

### 3. `src/lib/analyticsEngine.ts` (small)
- Export `isCerusLog(log: AnalyticsLog): boolean` (`boss_name` includes 'cerus' || 'febe') so both Analytics and Mechanics share the rule (single source of truth). Pure, no DOM.

---

## Step-by-Step Tasks

### Task 1: Add `isCerusLog` helper to `analyticsEngine.ts`
**Objective:** Single source of truth for "is this a Cerus log".
**Files:** Modify `src/lib/analyticsEngine.ts` (near `getAvailableBosses`).
**Step 1:** Add:
```ts
export function isCerusLog(log: AnalyticsLog): boolean {
  const bn = (log.boss_name || '').toLowerCase();
  return bn.includes('cerus') || bn.includes('febe');
}
```
**Step 2:** `npm run check` — expect 0 errors.
**Step 3:** Commit `feat(analytics): add isCerusLog helper`.

### Task 2: Wire debounced auto-build Cerus cohort into `AnalyticsDashboard.svelte`
**Objective:** Filter Cerus logs in scope + auto-build cohort via existing merge pipeline (debounced 400ms).
**Files:** Modify `src/routes/AnalyticsDashboard.svelte`.
**Step 1:** Add imports + `cerusCohort`/`cerusLoading`/`cerusError` state + `cerusLogUrls`/`isCerusScope`/`cerusCohortKey` derived + `buildCerusLeaderboard(urls)` (mirror `MechanicsTab.analyze`, cap at `MAX_AGGREGATE_LOGS*2`, skip-fail per log). Use `isCerusLog` from Task 1. Add a `$effect` that watches `cerusCohortKey` + `cerusLogUrls` and calls `buildCerusLeaderboard` through a 400ms debounce (clears prior timer). Memoize by key so identical scopes aren't refetched.
**Step 2:** `npm run check` — expect 0 errors.
**Step 3:** Commit `feat(analytics): auto-build Cerus cohort for leaderboard`.

### Task 3: Create `CerusLeaderboard.svelte`
**Objective:** Render cohort cards + sortable per-player table.
**Files:** Create `src/routes/CerusLeaderboard.svelte`.
**Step 1:** New Svelte 5 component with props `{ report, logCount }`. Cohort cards from `report.*` scalars. Build unified player rows: for each `squadLedger` entry, look up `orbLeaderboard`/`malicePlayers` by `account::name` for Orb% and Malice Dmg. Reuse `smSortBy` sort (click header toggles `smSort`).
**Step 2:** `npm run check` — expect 0 errors.
**Step 3:** Commit `feat(analytics): CerusLeaderboard component`.

### Task 4: Render the section + add minimal CSS
**Objective:** Show the section only in Cerus scope (auto-built, no button); add a few helper classes if missing.
**Files:** Modify `src/routes/AnalyticsDashboard.svelte` (render block above) + `src/app.css` (add `.an-warn`, `.an-loading`, `.an-error` only if not already present).
**Step 1:** Add the `{#if isCerusScope} … {/if}` block after Player Performance Comparison (auto-built via the Task 2 `$effect`; no manual button). Keep the loading/error/cards/table branches.
**Step 2:** `npm run check` + `npm run build` — expect green.
**Step 3:** Commit `feat(analytics): render Cerus Leaderboard section`.

### Task 5: Live verification (native window)
**Objective:** Prove it works on real Cerus logs.
**Files:** None (verification only).
**Step 1:** `npm run tauri dev`; open Analytics; set boss filter to a Cerus fight with ≥2 historical logs; confirm auto-build populates cards + sortable table; toggle Mode (CM/LCM) and Range to confirm cohort scope changes (debounced, no refetch on identical scope); offline test (dps.report blocked) shows error gracefully.
**Step 2:** Report plain-language result to user.

### Task 6: Patch note
**Objective:** Document the feature.
**Files:** Modify `src/routes/+page.svelte` `PATCH_NOTES_DATA` (next version, e.g. 0.6.7).
**Step 1:** Add `📊 Analytics` entry: "Cerus Multi-Log Leaderboard — when you filter the Analytics tab to Cerus (CM/LCM/Normal), a new Leaderboard auto-builds from all matching logs into a per-player ranking (Orbs collected, Orb %, Cry of Rage hits, Envy Strip, Malice damage) plus cohort summary cards. Built on demand from your logs — no new uploads needed."
**Step 2:** `npm run check` + `npm run build` — expect green.
**Step 3:** Commit `docs: patch note for Cerus Leaderboard`.

---

## ============================================================
## EXPANDED DETAIL — Full Implementation List + Chart/Leaderboard Placement
## (consolidated from chat; supersedes the condensed Tasks above)

### A. Where everything goes (UI placement)

#### Current Analytics tab layout (what exists now)
```
Analytics tab
├─ Global filters: boss · mode (CM/LCM/Normal) · range/date
├─ Cohort rollups (duration, class dist, outcome %, attempts)   ← existing, by filter
└─ {#if bossFilter !== 'all'}
     └─ Player Performance Comparison   ← existing section
```

#### After this feature
```
Analytics tab
├─ Global filters (unchanged)
├─ Cohort rollups (unchanged)
└─ {#if bossFilter !== 'all'}
     ├─ Player Performance Comparison        (existing — untouched)
     └─ **Cerus Leaderboard**  ← NEW, appears ONLY when filter = Cerus logs
           ├─ Section header (🏆 Cerus Leaderboard + skew warning if >25 logs)
           ├─ Cohort summary cards (6)        ← reuse .an-card grid
           └─ Per-player sortable table       ← reuse CerusDashboard .sm-* table
```
- **File:** `src/routes/AnalyticsDashboard.svelte` — new block inserted **right after** the `Player Performance Comparison` block, still inside the `{#if bossFilter !== 'all'}` guard. It auto-renders only when the active filter resolves to Cerus logs (`boss_name` contains "cerus"/"febe").
- **Charts/leaderboards we ADD:** (1) 6 cohort cards, (2) the per-player sortable leaderboard table.
- **Charts we REUSE (not rebuild):** the leaderboard table reuses `CerusDashboard.svelte`'s `squadLedger`/`orbLeaderboard` rendering + `.sm-*` CSS.
- **Chart we DELIBERATELY OMIT:** the time-series timeline (orbBlocked/orbLeaked/rageHit buckets). `mergeCerusReports` already sets `timeline: []` for multi-log because per-fight timestamps aren't summable — showing a fake merged timeline would be misleading. Correct by design.

---

### B. Full detailed implementation list

#### Task 1 — `isCerusLog()` helper (single source of truth)
- **File:** `src/lib/analyticsEngine.ts` (near `getAvailableBosses`, ~line 317)
- **Add:**
```ts
export function isCerusLog(log: AnalyticsLog): boolean {
  const bn = (log.boss_name || '').toLowerCase();
  return bn.includes('cerus') || bn.includes('febe');
}
```
- **Why:** Analytics + Mechanics share one rule for "is this a Cerus log."
- **Validate:** `npm run check` → 0 errors.

#### Task 2 — Debounced auto-build wiring (fetch + merge)
- **File:** `src/routes/AnalyticsDashboard.svelte`
- **Imports to add:**
```ts
import { extractMechanics, mergeCerusReports, MAX_AGGREGATE_LOGS, type MechanicReport } from '$lib/mechanicParser';
```
- **State + derived:**
```ts
let cerusCohort = $state<MechanicReport | null>(null);
let cerusLoading = $state(false);
let cerusError = $state<string | null>(null);

const cerusCohortKey = $derived(`${bossFilter}|${modeFilter}|${rangeFilter}|${customStartDate}|${customEndDate}`);
let cerusLogUrls = $derived(
  logs.filter(isCerusLog)
    .filter(l => modeMatches(l, modeFilter))
    .filter(l => rangeMatches(l, rangeFilter, customStartDate, customEndDate))
    .map(l => l.url as string).filter(Boolean)
);
let isCerusScope = $derived(cerusLogUrls.length > 0);
```
- **Auto-build (user choice B) — debounced $effect:**
```ts
let cerusDebounce: ReturnType<typeof setTimeout> | null = null;
let lastBuiltKey = '';
$effect(() => {
  const key = cerusCohortKey;   // track
  const urls = cerusLogUrls;    // track
  if (urls.length === 0) { cerusCohort = null; return; }
  if (key === lastBuiltKey) return;          // memo: skip identical scope
  if (cerusDebounce) clearTimeout(cerusDebounce);
  cerusDebounce = setTimeout(() => {
    lastBuiltKey = key;
    buildCerusLeaderboard(urls);
  }, 400);
});
```
- **Builder (copy of `MechanicsTab.analyze`, ~lines 53–82):**
```ts
async function buildCerusLeaderboard(urls: string[]) {
  cerusError = null; cerusLoading = true;
  try {
    const reports: MechanicReport[] = [];
    const capped = urls.slice(0, Math.max(MAX_AGGREGATE_LOGS * 2, urls.length));
    await Promise.all(capped.map(async (u) => {
      try {
        const res = await invoke('get_log_full', { permalink: u }) as any;
        const mech = extractMechanics(res.raw, res.stats?.boss_name || '');
        if (mech && mech.boss === 'Cerus') reports.push(mech);
      } catch { /* skip bad/unreachable log */ }
    }));
    cerusCohort = mergeCerusReports(reports);
    if (!cerusCohort) cerusError = 'No Cerus mechanic data found in the selected logs.';
  } finally { cerusLoading = false; }
}
```
- **Small helpers:** `modeMatches(l, modeFilter)` and `rangeMatches(l, rangeFilter, customStartDate, customEndDate)` — tiny locals (reuse whatever `aggregateStats` already uses so scope matches the rest of the tab).
- **Validate:** `npm run check` → 0 errors.

#### Task 3 — `CerusLeaderboard.svelte` (NEW component)
- **File:** `src/routes/CerusLeaderboard.svelte`
- **Props:** `{ report: MechanicReport; logCount: number }`
- **Renders:**
  1. **Cohort cards (6)** from `report.*`: `orbEfficiency` (%), `totalOrbs`, `empoweredGained`, `rageHits`, `shadowsReached`, `boonStrippedPlayers`. Style: `.an-card` grid (reuse Analytics card CSS).
  2. **Per-player sortable table** — one row per player (dedup by `account::name`):
     - Join `report.squadLedger` (orbs/cryRage/envyStrip) ↔ `report.orbLeaderboard` (orb %) ↔ `report.malicePlayers` (malice dmg).
     - Columns: **Player** (toon + account + profession icon) · **Orbs** · **Orb %** · **Cry of Rage** · **Envy Strip** · **Malice Dmg**.
     - Click any header → `smSort = { key, dir }`, default **Orbs desc** (reuse `smSortBy` pattern from `CerusDashboard.svelte`).
  3. **Footer:** "Aggregated from N logs" + the `MAX_AGGREGATE_LOGS` skew warning if applicable.
- **CSS:** reuse `.an-section`, `.an-card`, `.sm-*` table classes from `CerusDashboard.svelte`. Add only `.an-warn`/`.an-loading`/`.an-error` if absent (in `src/app.css`).
- **Validate:** `npm run check` → 0 errors.

#### Task 4 — Render block in AnalyticsDashboard
- **File:** `src/routes/AnalyticsDashboard.svelte` (after `Player Performance Comparison`)
```svelte
{#if isCerusScope}
  <div class="an-section">
    <div class="an-section-head">
      <span class="an-section-title"><i class="fa-solid fa-trophy"></i> Cerus Leaderboard</span>
      {#if cerusLogUrls.length > MAX_AGGREGATE_LOGS}
        <span class="an-warn">⚠ {cerusLogUrls.length} logs — averages may be skewed</span>
      {/if}
    </div>
    {#if cerusLoading}
      <div class="an-loading">Building leaderboard…</div>
    {:else if cerusCohort}
      <CerusLeaderboard report={cerusCohort} logCount={cerusLogUrls.length} />
    {:else if cerusError}
      <div class="an-error">{cerusError}</div>
    {/if}
  </div>
{/if}
```
- **Add `<CerusLeaderboard />` to imports.**
- **Validate:** `npm run check` + `npm run build` → green.

#### Task 5 — Live native-window verification
- `npm run tauri dev`; open Analytics; set boss filter to a Cerus fight with ≥2 historical logs.
- Confirm: cards + sortable table auto-populate; toggling Mode (CM/LCM) + Range changes the cohort (debounced, no refetch on identical scope); offline/dps.report-down shows the error state gracefully.
- Report plain-language result.

#### Task 6 — Patch note
- **File:** `src/routes/+page.svelte` `PATCH_NOTES_DATA` (next version, e.g. 0.6.7).
- Add 📊 Analytics: "Cerus Multi-Log Leaderboard — filter Analytics to Cerus (CM/LCM/Normal) and a new Leaderboard auto-builds from all matching logs into a per-player ranking (Orbs, Orb %, Cry of Rage, Envy Strip, Malice dmg) + cohort cards."
- **Validate:** `npm run check` + `npm run build` → green.

---

### C. Files touched (summary)
| File | Change |
|---|---|
| `src/lib/analyticsEngine.ts` | `+isCerusLog()` |
| `src/routes/AnalyticsDashboard.svelte` | imports, state, debounced `$effect`, `buildCerusLeaderboard()`, render block |
| `src/routes/CerusLeaderboard.svelte` | **NEW** — cards + sortable table |
| `src/app.css` | ≤3 helper classes if absent |
| `src/routes/+page.svelte` | patch note |

### D. Two honest caveats (already in plan)
- **Per-player Empowered** isn't stored per-player (only boss-level `cerus_empowered_stacks`), so Empowered = **cohort card only**, not a table column. Phase-2 backend change if you want it per-player.
- **Timeline chart omitted** for multi-log (not summable) — by design, not a miss.

---

## Files Likely To Change
- `src/routes/AnalyticsDashboard.svelte` (imports, state, debounced $effect, fetch, render block)
- `src/routes/CerusLeaderboard.svelte` (NEW)
- `src/lib/analyticsEngine.ts` (`isCerusLog`)
- `src/app.css` (≤3 helper classes, only if absent)
- `src/routes/+page.svelte` (patch note)

## Tests / Validation
- `npm run check` (svelte-check) after each task — 0 errors/warnings.
- `npm run build` green before shipping.
- `npm run tauri dev` live test with real Cerus logs (≥2) across CM/LCM/Normal and a date range; offline error path; debounce/no-refetch-on-identical-scope check.
- Ad-hoc: count that `mergeCerusReports` output `squadLedger` length == distinct players across the filtered logs (mirror `hermes-verify-*.js` pattern if needed).

## Risks / Tradeoffs / Open Questions
- **Fetch cost (mitigated):** building the cohort re-fetches full dps.report JSON for every filtered log (network + CPU). Mitigated by cap + 400ms debounce + memo by filter key. Caching the extracted `MechanicReport` per permalink in `RAW_CACHE`/`ei_cache` would make repeat builds instant (recommended follow-up).
- **Cohort skew:** large N dilutes per-player averages → warn at `MAX_AGGREGATE_LOGS`.
- **Per-player Empowered:** not derivable per-player from stored data (boss-level only). Shown as cohort card, not a player column. Phase-2 stretch only.
- **Timeline chart:** `mergeCerusReports` sets `timeline: []` for multi-log (correct — per-fight offsets aren't summable), so the leaderboard omits the time-series chart by design.
- **Mode filter:** `is_cm`/`is_lcm` on `AnalyticsLog` let us scope CM/LCM/Normal; confirm range filter uses `timestamp` consistently with `aggregateStats`.
- **Decided:** refresh = auto-build with ~400ms debounce (user choice B).
- **Open Q:** data source — v1 uses dps.report + cache (recommended). OK to also wire local-EI for logs still on disk as a Phase-2 add? Confirm before building.
