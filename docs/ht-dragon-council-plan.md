# Harvest Temple / Dragon Council Fix & Enhancement Plan

## Phase 0: Baseline Verify
- [x] Re-verify `null failed → true` fix against wipe-at-Jormag log
- [x] Confirm `cargo check --release` + `cargo test --release` clean
- [x] Run ad-hoc Python verification 6/6

**Status**: Complete. Baseline established.

---

## Phase 1: Local EVTC Phase Detection (reduce dps.report reliance)

### 1a. Port EI local HT phase logic
**Goal**: Build Dragon Council timeline from EVTC events, not dps.report JSON.

**EI architecture finding** (from source inspection):
- EI does NOT get dragon species IDs (`TheDragonVoidJormag` = -21, etc.) from raw EVTC agent table.
- EI's `EvtcParser.ParseAgentData` stores raw `prof` as positive `ID` for NPCs.
- Encounter logic later calls `agent.OverrideID(TargetID.TheDragonVoidJormag, agentData)` to relabel.
- `HarvestTemple.GetPhases()` builds phases from `Targets`, which come from encounter-specific `GetTargetsIDs()` + relabeling.
- The relabeling uses combat evidence (spawn/despawn, statechanges, attack target events).

**Rust port strategy**:
1. Add encounter-specific HT target relabeling in `evtc_parser.rs`:
   - Scan agents for generic boss-like profiles at boss_id 43488
   - Use spawn/despawn order + event evidence to assign dragon identities
   - Map to `HARVEST_DRAGONS` keys in canonical order
2. Build local phase timeline from relabeled targets + add evidence
3. Wire local-first path in `uploader.rs` with dps.report fallback

**Files to modify**:
- `src-tauri/src/evtc_parser.rs`: Add `harvest_temple_local_phases()` function
- `src-tauri/src/uploader.rs`: Change `fetch_dragon_timeline()` / `fetch_dragon_phases()` to try local first, network second

**Fallback**: If local detection can't identify a phase, fall back to dps.report JSON for that element only.

### 1b. Wire local-only path into uploader
- Replace mandatory `fetch_dragon_timeline()` with "try local first" pattern
- Same for `fetch_dragon_phases()`
- Keep network fallback for enriched display data (icons, DPS)

---

## Phase 2: Per-Dragon Wipe/HP Accuracy

### 2a. Local HP-left estimation per dragon
**Goal**: Show meaningful HP for each dragon on wipes.

**Approach**:
- EI derives HP from boss fight windows + health updates
- For dragons, track HP during each dragon's phase window from `HealthUpdate` events
- If EVTC tracks dragon HP fragments, use those; otherwise keep 100% as honest fallback

### 2b. Distinguish "alive-at-wipe" vs "unreached"
- Verify UI shows orange/alive for dragons reached but not killed, gray for unreached
- Align frontend chip classes (`dstate-alive`, `dstate-unreached`, `dstate-dead`) with backend `died` flag

---

## Phase 3: Cleanup and Edge Cases

### 3a. Dead code removal
- `dragon_phase_full` is currently unused (warning shown)
- Decide: keep for API compatibility or remove

### 3b. Frontend label/order verification
- Verify dragon display names match `HARVEST_DRAGONS` map exactly
- Verify canonical order: Jormag → Primordus → Kralkatorrik → Mordremoth → Zhaitan → Soo-Won

### 3c. Live app test on wipe log
- Run `npm run tauri dev`
- Load `20260801-165105.zevtc`
- Verify:
  - Jormag shows red X (Fail), not green check
  - HP Left shows 100% or actual HP if local logic improves
  - Hover tooltip shows correct dragon state

---

## Verification Protocol
After each phase:
1. `cargo check --release` — must pass with no new warnings
2. `cargo test --release` — all tests pass
3. Ad-hoc verification script for changed behavior
4. Live native-window test via `npm run tauri dev`
