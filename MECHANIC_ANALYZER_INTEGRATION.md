# Mechanic Analyzer → Portal Protocol Integration (Design / On Hold)

> **Status: ON HOLD.** This is a design snapshot captured from discussion on 2026-07-10.
> Nothing here has been implemented. Code changes are NOT started.

## 1. What "Mechanic Analyzer" is

A standalone **React + Vite** web app on the desktop at
`C:\Users\Usuario\Desktop\Mechanic Analyzer\`. It provides **6 boss "mechanic
analyzer" tools**:

| id   | Boss            | What it tracks |
|------|-----------------|----------------|
| `vg` | Vale Guardian   | Unstable Magic Spike (blue circles), downstate + cause, "squad sabotage" suspects |
| `sh` | Soulless Horror | Who damaged the Tormented Dead, skill breakdowns, CC, immob generation |
| `dhuum` | Dhuum       | Who got picked up by Ender's Echo (multi-log aggregate totals) |
| `cerus` | Cerus       | Malice cleave damage, Immobilize uptime, Orb handling, Empower stacks (CM/LCM) |
| `eyes` | Eyes         | Who overrode/broke the long Light Orb stun with short CC (Daze/Fear/Knockdown) |
| `ura` | Ura            | Bubble-save fails, early geyser drops, shard pickups, acid stacks, Geyser CC, timeline events |

### Architecture (as-is)
- `src/App.jsx` (~4,888 lines) — React UI: boss-select lobby, paste bar, per-boss
  dashboards (`renderXDashboard`), boss-matching (`isMatch`), clipboard export.
- `src/components/SmartPasteBar.jsx` — multi-link paste input.
- `src/utils/*.js` — the **valuable IP**. Pure-ish functions of the shape
  `(dpsReportJson) => stats`:
  - `shared.js` (184) — CC dictionaries, spec-icon map, helpers.
  - `cerusParser.js` (1,145) — **async**, enriches CC via `api.guildwars2.com`.
  - `shParser.js` (435), `uraParser.js` (274), `eyesParser.js` (239),
    `vgParser.js` (209), `dhuumParser.js` (52). Five of six are fully pure.
- Input: paste dps.report links → `GET https://dps.report/getJson?permalink=…`
  → parser → dashboard.

**Key insight:** the parsers are framework-agnostic ESM; the React layer is
disposable presentation. The portable asset is `src/utils/*`.

## 2. Chosen approach: Option B (reuse parsers in Svelte, re-skin dashboards)

Considered options:

| Option | Verdict |
|--------|---------|
| A. Rewrite parsers in Rust | ❌ ~2,540 lines dual-maintained, high bug risk |
| **B. Drop `.js` parsers into Svelte, run in webview** | ✅ **Chosen** — reuse 100% logic, 0 new deps, light installer |
| C. Embed whole React app as 2nd window/iframe | ⚠️ Bloats installer, disjoint UX |
| D. "Open in Mechanic Analyzer" link | ⚠️ Not actually "in this app" |

### Why B fits
- Parsers are plain ESM; Vite/Svelte import them directly.
- No React, no extra npm deps → installer stays light (your hard constraint).
- Portal Protocol **already** talks to dps.report (Rust `reqwest`) and stores each
  record's permalink (`record.dps_report_url`), so the data path is trivial.

### Data flow (per analysis)
```
log record → record.dps_report_url (permalink)
          → fetch https://dps.report/getJson?permalink=…  (FULL json)
          → run matching extractXxxMechanics() parser
          → render Svelte dashboard (reuse existing premium CSS)
```
Fetch can go through a new Rust command `dpsreport_get_json` (reuses `reqwest`
client + error handling) **or** straight from the browser (dps.report allows
CORS; the standalone does it client-side). Leaning Rust command for consistency.

## 3. Proposed New Tab — "Mechanics"

```
┌─────────────────────────────────────────────────────────┐
│ [Uploads] [History] [Folders] [Mechanics]   ← new nav tab │
├──────────────┬──────────────────────────────────────────┤
│ Boss rail    │  Analyzer view (center)                   │
│ (left ~220)  │   nothing selected → prompt + paste box   │
│  • Vale G.   │   selected (1 or many) →                │
│  • Soulless  │     encounter header (boss, CM/LCM pill,  │
│  • Dhuum     │     success/fail, duration) + summary +   │
│  • Cerus     │     player breakdown cards + copy export  │
│  • Eyes      │                                           │
│  • Ura       │                                           │
│  + paste box │                                           │
└──────────────┴──────────────────────────────────────────┘
```
- **Boss rail**: lists 6 bosses, each with a count of matching logs in history
  (computed from encounter metadata already stored). Click → show analyzable
  logs → pick one or "Analyze all" (aggregate across whole history).
- **Paste box** (bottom of rail): handles logs not yet in the app — preserves the
  standalone's primary input.

## 4. Phased roadmap

### Phase 0 — Plumbing (small)
- Copy `shared.js` + 6 `*Parser.js` → `src/lib/mechanics/`.
- Strip 2 DOM-only helpers from `shared.js` (`copyToClipboard`,
  `handleIconFallback`) — parsers don't use them.
- Add `dpsreport_get_json(permalink)` Rust command (or browser fetch).
- Add `matchBoss(logData, id)` helper (ported from `App.jsx` `isMatch`).
- Bonus: auto-open the right analyzer from a log card (app already knows boss at upload).

### Phase 1 — Tab shell + 3 simple bosses (Ura, Dhuum, VG)
- Nav tab, boss rail, paste box, dashboard renderer.
- These 3 parsers are **pure** (no async GW2 API) → safest proof of pipeline.
- Includes copy-to-clipboard formatted export (reuse standalone's text builder).

### Phase 2 — SH + Eyes (pure parsers, more fields).

### Phase 3 — Cerus (async: enriches CC via `api.guildwars2.com`).
- Heaviest. Dovetails with the Cerus VL-rank idea (parser already computes
  Empower stacks — the exact data the badges need).

## 5. Extra ideas (beyond literal port)
1. **Auto-routing from a log card** — open the correct analyzer directly (app
   already knows the boss). Better than manual boss pick.
2. **Persistent cross-log aggregate** — "analyze all my Ura logs this month" in
   one view (standalone only aggregates the session's pasted links).
3. **Cerus VL-rank hint** (no auto-award, keep manual) — show a soft hint
   "meets Petrified (≤10 Empower @ 50%)" feeding the manual badge workflow.
4. **Persist parsed results on the record** — cache analyzer stats to skip re-fetch.
5. **Light timeline viz for Ura** — parser emits `timelineEvents`; render a
   pure-CSS/SVG scrubber (no chart lib).
6. **Log-card summary badge** — one-line mechanic summary on the Feed card
   (e.g. "Ura · 3 wasted bubbles").
7. **Discord export** — reuse existing webhook to post the formatted analyzer summary.

## 6. Cost caveat
Parsers = **copy** (zero logic risk). Real work is the **dashboards**:
`App.jsx` ~4,900 lines of per-boss React JSX. Two handling options:
- **(a) Literal port** — translate each `renderXDashboard` to Svelte, reuse CSS
  classes. Faithful, but ~4,900 lines of UI translation.
- **(b) Generic renderer** — one Svelte dashboard driven by each parser's output
  *shape* (playerMap + leaderboards + timeline). Less code, cleaner, but loses a
  few boss-specific flourishes.
- Plan: start **(a)** for Phase 1 (simple), switch to **(b)** if pattern repeats.

## 7. Open questions (unresolved, for when resumed)
1. Nav tab vs. per-log button vs. both?
2. Fetch path: Rust command vs. browser fetch?
3. Dashboard style: literal port (a) vs. generic renderer (b)?
4. Phase 1 scope: just Ura/Dhuum/VG, or include a Cerus hint stub?

## 8. Source references (do not delete Mechanic Analyzer project)
- `C:\Users\Usuario\Desktop\Mechanic Analyzer\src\utils\*.js` — parsers (port these).
- `C:\Users\Usuario\Desktop\Mechanic Analyzer\src\App.jsx` — dashboards + matching (port/reference).
- `C:\Users\Usuario\Desktop\Mechanic Analyzer\src\index.css` — existing premium styling (reuse classes).
