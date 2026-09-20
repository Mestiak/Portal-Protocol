# Plan: Make bundled Elite Insights the PRIMARY data source (all bosses)

Date: 2026-08-20
Status: PROPOSED (awaiting approval)

## Goal
EI runs automatically on every log (upload / drag-drop / watcher catch). The
log card (boss_name, mode badge, kill/wipe, HP left, players, duration,
thumbnail) and Stats/Mechanics are drawn from the LOCAL EI parse. dps.report is
used ONLY to obtain the shareable permalink/link. No card field depends on
dps.report being reachable.

## Why
User confirmed: "The EI Parser should be automatic. When a new log loads in or
when we drag a log, it should parse locally and upload to get the link. We have
the Parser step in the stepper. The final log card should be from EI, no more
relying on dps.report." Scope: ALL bosses (not Cerus-only).

## Current flow (verified)
- uploader.rs:1893 upload POST -> dps.report response sets record.boss_name,
  success, is_cm, players, hp_left, etc. (all from dps.report).
- run_local_ei (line 1920) ALSO runs at upload time but ONLY caches JSON for
  later Stats use; does NOT populate the card.
- get_log_full (3480) already serves EI-first when ei_enabled(); this becomes
  the default.
- Real EI JSON (verified on 20260818-205939.zevtc) contains everything the card
  needs: fightName, isCM, isLegendaryCM, success, targets[0].name,
  targets[0].healthPercentBurned, fightIcon, timeStart/timeEnd (duration),
  players[].{account,group,profession}, phases, mechanics, skillMap, buffMap.
- shape_log_stats (3607) already extracts boss_name/duration/targets/players from
  a Value — reuse it for the card's scalar fields where possible.

## Changes (phased)
### 1. Make EI default (no env gate)
- ei_runner::ei_enabled() returns true always (remove PORTAL_USE_EI dependency),
  OR keep the var as an opt-OUT. Decision: keep var as opt-OUT (PORTAL_USE_EI=0
  disables). Default ON. This also removes the need for the Settings toggle ask.
- get_log_full: drop the `if ei_enabled()` guard -> EI cache-first always; fall
  back to dps.report getJson ONLY if no local cache (e.g. logs parsed before
  this build / manual re-fetch). Keep the fallback for pre-existing history.

### 2. Populate the card from the local EI parse
- After run_local_ei completes, read cached EI Value and set on `record`:
  - boss_name   <- targets[0].name (or fightName). For convergences keep map-id
                   logic (unchanged).
  - is_cm       <- json.isCM (authoritative; drop dps.report re-derivation for
                   non-convergence).
  - is_lcm      <- json.isLegendaryCM.
  - success     <- json.success.
  - boss_hp_left<- 100 - targets[0].healthPercentBurned (or finalHealth%).
  - num_players <- players.len(); players <- mapped PlayerInfo (account/group/
                   profession) from EI players[].
  - duration    <- (timeEnd - timeStart) seconds.
  - thumbnail/fight_icon <- json.fightIcon.
  - phases/phases_data kept for Stats (already in cached Value).
- Convergences: keep current local-EVTC source (dps.report doesn't run EI on
  them); their card is unaffected.
- If EI parse fails (no .NET / non-parseable): fall back to current dps.report
  card fields (no regression). Best-effort only.

### 3. Stepper / status text
- The existing "Parser" step already maps to run_local_ei. No change needed
  unless label says "dps.report EI" — update wording to "Local Parser".

### 4. Upload-time ordering
- run_local_ei already spawned on async runtime (non-blocking). The card update
  happens when the parse finishes (emit upload-status with enriched record), so
  the card flips from "Uploaded" -> full EI data a few seconds later. Acceptable
  (matches today's dps.report deferred processing pattern).

## Files
- src-tauri/src/ei_runner.rs (ei_enabled default-on)
- src-tauri/src/uploader.rs (get_log_full guard; record enrichment after EI parse)
- src/routes/+page.svelte (stepper label wording if needed; remove Parse Local
  manual button? Keep it as a retroactive fallback for pre-build logs.)

## Verification
- cargo check --release; npm run check; npm run build (triplet).
- Ad-hoc: run EI on a real log, assert the mapped record fields match the card
  (boss_name=Cerus, is_cm=true, success=false, hp_left≈18%, players=10).
- Live tauri dev: drag a log -> card populates from EI with no dps.report
  dependency (verify by parsing while dps.report unreachable).

## Risks
- EI parse ~10-15s; card shows partial data first, then enriches. Visible flip
  is fine (same as current dps.report deferred pattern).
- .NET 8 must be present on the user's machine (it is, confirmed).
- Some bosses' EI target naming differs; boss_name uses targets[0].name which is
  EI's canonical boss name (better than dps.report for most).
