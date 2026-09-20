# EI-First Refactor Plan

**Goal:** Make Elite Insights the single source of truth for non-convergence logs. Keep the local EVTC parser scoped to convergence fallback and fast header reads only. Remove duplicate detection paths that caused the Quick Play badge bug and similar stale-flag issues.

**Backups:** `backups/2026-09-07.ei-first-refactor-pre/`

---

## Current State

### What EI already handles in `enrich_record_from_ei`
- Boss name from `ei.targets[0].name` / `fightName`
- Mode flags: `isCM`, `isLegendaryCM`, Quick Play via `phases[0].mode == "Quickplay Normal Mode"`
- Kill/wipe: `ei.success`
- Boss HP left: `healthPercentBurned` filtered to real boss targets
- Multi-boss HP: CA arms, Twin Largos, Statue of Darkness eyes, Voice & Claw, Aetherblade Hideout, Old Lion's Court Watchknights
- Duration: `durationMS`
- Thumbnail: `fightIcon`
- Players: `ei.players[]` → `PlayerInfo`

### What local EVTC parser still does
- `parse_players` — instant player list during upload
- `parse_boss_id` / `parse_boss_name` — instant boss name during upload
- `parse_boss_hp` — provisional HP during upload
- `parse_boss_fight_duration` — provisional duration during upload
- `parse_is_cm` — convergence CM detection
- `parse_is_lcm` — convergence LCM detection
- `parse_is_quick_play` — **redundant** now that EI handles it
- `parse_cerus_empowered_stacks` — Cerus-specific mechanic
- `parse_revealed_sources` — mechanic attribution

### What `uploader.rs` does today
1. Runs local EVTC parser first → populates provisional `UploadRecord`
2. Runs local EI → enriches record via `enrich_record_from_ei`
3. Uploads to dps.report → gets permalink
4. Polls dps.report `getJson` → enriches again / corrects fields
5. History repair sweeps on launch fix stale flags from early logs

---

## Refactor Steps

### Step 1: EI-first enrichment, convergence-aware

**File:** `src-tauri/src/uploader.rs`

**Change:** During initial local parse, only use local EVTC parser for:
- Instant UI feedback: players, boss name, provisional duration
- Convergence-specific data: `local_is_cm`, `local_is_lcm`, `parse_cerus_empowered_stacks`

**Remove from initial local parse:**
- `local_is_quick_play` assignment to `record.is_quick_play`
- `boss_hp_left_local` assignment to `record.boss_hp_left`
- `local_is_cm` / `local_is_lcm` assignment for non-convergence logs
- `record.success` derived from local HP scrape

**Keep:**
- `record.players` from `parse_players`
- `record.boss_name` from local parse as provisional name
- `record.duration` from local parse as provisional duration
- Convergence CM/LCM: `record.is_cm = local_is_cm`, `record.is_lcm = local_is_lcm` when `is_conv == true`
- `record.cerus_empowered_stacks` from `parse_cerus_empowered_stacks`

**Rationale:** EI will overwrite these fields shortly after for non-convergence logs. The local values are only placeholders shown during the "Parsing" step.

### Step 2: Stop duplicate mode detection in EVTC parser for non-convergence logs

**File:** `src-tauri/src/evtc_parser.rs`

**Changes:**
- Keep `parse_is_cm` and `parse_is_lcm` functions, but add module-level docs stating they are **convergence-only** in the EI-first architecture
- Keep `parse_quick_play` function, but mark it as **deprecated / convergence-only fallback**
- Add a new helper: `parse_convergence_mode(bytes) -> (Option<bool>, Option<bool>)` that returns `(cm, lcm)` for convergence logs

**Rationale:** The functions stay in the codebase because convergence logs need them. But the app logic in `uploader.rs` will only call them for convergence logs.

### Step 3: Simplify convergence path in `uploader.rs`

**File:** `src-tauri/src/uploader.rs`

**Change:** In the convergence-specific code block (around line 1184), keep the existing local CM/LCM/Quick Play reads, but add a comment that these are the **only** remaining callers of local mode detection.

**Add:** When a convergence log is processed, after local EI runs, also enrich from local EI JSON if available. This gives convergences the same boss-name/HP/duration quality as non-convergences.

### Step 4: Remove redundant local HP/boss-name overwrites

**File:** `src-tauri/src/uploader.rs`

**Change:** After `enrich_record_from_ei` runs, the local HP/boss-name values should not overwrite EI's values. Remove or guard:
- `record.boss_hp_left = Some(hp)` from local parse
- `record.boss_name = boss_name` from local parse when EI already set it
- `record.success = Some(hp <= SUCCESS_HP_THRESHOLD)` from local parse

**Keep as provisional only:**
- Show local boss name/duration during the "Parsing" step in the UI
- Once EI enriches, UI should refresh with EI values

### Step 5: Simplify history repair

**File:** `src-tauri/src/uploader.rs`

**Changes:**
- `repair_history_cm_flags`: remove `quickplay_bad` check since EI now handles Quick Play for all non-convergence logs
- `repair_history_story_classification`: keep if still needed
- Remove any repair logic that re-derives fields now handled by EI at upload time

**Rationale:** With EI-first, new logs won't need these repairs. The functions can stay for one-time migration of old logs, but shouldn't grow new repair types.

### Step 6: Frontend refresh on EI enrichment

**File:** `src/routes/+page.svelte`

**Verify:** The frontend already listens for `upload-status` events and re-renders cards. When `enrich_record_from_ei` runs, the record is emitted again. Verify this path works so users see EI data replace provisional data seamlessly.

**No code change needed if already working.** Just verify during testing.

### Step 7: Update docs/comments

**Files:** `src-tauri/src/evtc_parser.rs`, `src-tauri/src/uploader.rs`, `src-tauri/src/ei_runner.rs`

**Changes:**
- Update module docs in `evtc_parser.rs` to state: "Local parser is convergence fallback + fast header reads. Non-convergence mode/HP/players come from EI."
- Update function docs for `parse_is_cm`, `parse_is_lcm`, `parse_is_quick_play` to mark them as convergence-only
- Update `uploader.rs` comments to describe EI-first flow

---

## What NOT to change

- **Do not remove** `parse_players`, `parse_boss_id`, `parse_boss_name`, `parse_boss_fight_duration`, `parse_boss_hp` — needed for instant UI feedback
- **Do not remove** `parse_cerus_empowered_stacks`, `parse_revealed_sources` — still used
- **Do not remove** convergence CM/LCM detection — convergences never get EI from dps.report
- **Do not change** frontend badge CSS/HTML — already correct
- **Do not change** EI runner cache logic — already correct

---

## Testing Checklist

- [ ] `npm run check` passes
- [ ] `npm run build` passes
- [ ] `cargo check --release` passes
- [ ] Upload a non-convergence raid log → card shows provisional data, then EI data after parsing
- [ ] Upload a convergence CM log → CM badge shows correctly from local parser
- [ ] Upload a Quick Play log → Quick Play badge shows from EI
- [ ] Old logs in history still display correctly
- [ ] History repair sweep runs without errors on launch

---

## Rollback

If anything breaks, restore from `backups/2026-09-07.ei-first-refactor-pre/`:
- `src-tauri/src/evtc_parser.rs`
- `src-tauri/src/uploader.rs`
- `src-tauri/src/ei_runner.rs` (if touched)
