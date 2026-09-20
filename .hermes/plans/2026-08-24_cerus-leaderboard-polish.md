# Cerus Leaderboard — Polish / Fixes (Phase 1.5)

**Date:** 2026-08-24
**Scope:** Fix 5 issues found in live testing of the v1 Cerus Leaderboard (0.6.7, pre-ship).
**No version bump** — still pre-ship 0.6.7; fixes fold into the existing 0.6.7 release.

## Root causes (confirmed from code + screenshots)
1. Icons 404: `CerusLeaderboard.svelte` requested `/professions/{r.profession}.png` raw (e.g. `Scourge.png`); static files are lowercase (`scourge.png`). `CerusDashboard.profIcon()` already lowercases — not reused.
2. Account beside toon: leaderboard used `.sm-name`/`.sm-acc` siblings; working pattern is `.sm-names > .sm-toon + .sm-acct` (stacked).
3. ORB% column: present in per-player table; user wants it removed (cohort "Orb Efficiency" card stays, becomes a chart).
4. Numbers drift + lag: debounced `$effect` reads `logs` (mutated by the active watcher every few min) → rebuilds + refetches → wobble. Fix = manual button.
5. Cohort cards are icon+number; user wants mini-charts (per-log sparkline).

## Tasks

### T0 — Backup
`mkdir -p backups/2026-08-24.cerus-leaderboard-polish-pre && cp src/lib/analyticsEngine.ts src/routes/AnalyticsDashboard.svelte src/routes/CerusLeaderboard.svelte src/routes/+page.svelte $_.`
(excludes target/, node_modules — they aren't in the copy list anyway)

### T1 — Fix profession icon (lowercase, DRY)
- Add `export function profIcon(profession: string): string` to `src/lib/analyticsEngine.ts`:
  `const p = (profession||'').toLowerCase().replace(/\s+/g,''); return '/professions/'+(p||'guardian')+'.png';`
- `CerusLeaderboard.svelte`: change `<img src="/professions/{r.profession}.png" …>` → `src={profIcon(r.profession)}` (keep onerror→guardian as safety).
- `CerusDashboard.svelte`: replace local `profIcon` def with `import { profIcon } from '../lib/analyticsEngine'` (DRY; identical logic).

### T2 — Stack account under toon
In `CerusLeaderboard.svelte` player cell, change to:
```
<span class="sm-names">
  <span class="sm-toon">{r.name}</span>
  <span class="sm-acct">{r.account}</span>
</span>
```
Add scoped CSS in the component `<style>`:
```
.sm-names{display:flex;flex-direction:column;line-height:1.15;}
.sm-toon{font-weight:600;}
.sm-acct{font-size:11px;color:var(--muted);}
```

### T3 — Remove ORB% column
In `CerusLeaderboard.svelte`: delete the ORB% `<th>` and the per-row ORB% `<td>` (the one using `orbPercent`). Keep ORBS column + `orbPercent` field in the row type (harmless, unused) or drop it — drop from type too for cleanliness.

### T4 — Cohort cards → mini-charts (sparkline)
- Extend `buildCerusLeaderboard()` (in `AnalyticsDashboard.svelte`) to also capture per-log series from `mechReports`:
  `perLog = { orbs: m.map(x=>x.totalOrbs), empowered: m.map(x=>x.empoweredGained), rageHits: m.map(x=>x.rageHits), shadows: m.map(x=>x.shadowsReached), stripped: m.map(x=>x.boonStrippedPlayers), orbEff: m.map(x=>x.orbEfficiency) }`
  Set `cerusLeaderboard = { merged, rows, perLog }`.
- `CerusLeaderboard.svelte` props: add `perLog`. Replace the 6 icon-cards with 6 stat-cards:
  - Each card: big number (aggregate) + tiny inline **SVG sparkline** of `perLog[series]` (polyline scaled to max; width ~64px, height ~18px, accent stroke). For `orbEff` the number is already a %, sparkline still shows per-log spread.
  - Cards: Orb Efficiency (orbEff, avg/aggregate %), Total Orbs (orbs sum), Empowered Gained (empowered sum), Rage Hits (rageHits sum), Shadows Reached (shadows sum), Players Stripped (stripped sum).
  - NO external chart lib — hand-rolled SVG polyline (zero deps, DRY).
- Keep the same dark-card aesthetic as photo 4 (rounded, accent number, dim label).

### T5 — Manual "Load" button (replace auto `$effect`)
- Remove the debounced `$effect` + `cerusLeaderboard` auto-build.
- Add state: `let cerusLoaded = false; let cerusLoading = false; let cerusStale = false;`
- Render block (inside `{#if isCerusScope && bossFilter !== 'all'}`):
  - If `!cerusLoaded && !cerusLoading`: show a centered **"Load Cerus Leaderboard"** button (accent).
  - If `cerusLoading`: show spinner / "Aggregating N logs…".
  - If `cerusLoaded`: render `CerusLeaderboard` (cards + table).
- `async function loadCerusLeaderboard()`:
  - `cerusLoading = true; cerusStale = false;`
  - snapshot `const urls = getFilteredCerusUrls(logs, activeFilters);` (read once, no live dep)
  - **parallelize**: `const mechReports = await Promise.all(urls.map(u => invoke('get_log_full',{permalink:u}).then(r=>extractMechanics(r.raw, r.stats?.boss_name||'Cerus')).catch(()=>null)));` (filter nulls)
  - `const merged = mergeCerusReports(mechReports); if(!merged){cerusLoading=false; cerusError='No Cerus logs could be parsed'; return;}`
  - build `rows = buildCerusLeaderboardRows(merged)`, `perLog = …`, set `cerusLeaderboard`, `cerusLoaded = true; cerusLoading = false;`
- Stale-on-change: add a `$effect` (cheap, no fetch) that, when `bossFilter`/`modeFilter`/`dateRange` change AND `cerusLoaded`, sets `cerusStale = true` and hides the board (so user clicks Load again). Use a flag to skip the initial run.

### T6 — Patch note (fold into 0.6.7)
Update the existing 0.6.7 `PATCH_NOTES_DATA` entry (Analytics category) to describe the final leaderboard including: per-player ranking across multiple Cerus logs, manual Load button (no UI lag), profession icons fixed, per-log sparkline stats. No version bump (still 0.6.7 in tauri.conf.json).

### T7 — Verify
- Add to `test/analytics-cerus.test.ts`: `profIcon('Scourge')==='/professions/scourge.png'`, `profIcon('')==='/professions/guardian.png'`, and a `perLog` shape check (arrays length == log count, sums match rows).
- Run: `node --experimental-strip-types test/analytics-cerus.test.ts` → 29+ pass.
- `npm run check` → 0 errors. `npm run build` → ✔ done.
- (User) live: `npm run tauri dev`, filter Cerus, click Load, confirm icons show, account stacked, no ORB% column, sparkline cards render, numbers stable until next Load.

## Files touched
- `src/lib/analyticsEngine.ts` (add `profIcon`)
- `src/routes/CerusLeaderboard.svelte` (icon, markup, remove ORB%, sparkline cards, perLog prop)
- `src/routes/AnalyticsDashboard.svelte` (button state, parallel build, remove auto-effect, perLog capture)
- `src/routes/CerusDashboard.svelte` (import profIcon — DRY)
- `src/routes/+page.svelte` (0.6.7 note text)
- `test/analytics-cerus.test.ts` (+2-3 assertions)
