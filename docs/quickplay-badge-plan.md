# Quick Play Badge — Implementation Plan

## Goal
Add a **Quick Play** badge for GW2 Quick Play raid/strike logs, detected from the local EVTC binary by mirroring Elite Insights' own Quick Play detection, and displayed in the upload feed alongside Training / Normal Mode / Challenge Mode / Legendary CM.

## EI source confirmation
- `C:\Users\Usuario\Desktop\GW2-Elite-Insights-Parser-3.27.0.0\GW2EIEvtcParser\LogLogic\LogLogic.cs` detects Quick Play by checking whether any player has the instance buffs `QuickplayBoost` (skill id `77676`) or `QuickplayMorale` (skill id `79492`).
- `PhaseDto.cs` renders the mode string `"Quickplay Normal Mode"` when those buffs are present.
- Therefore our Rust local parser can detect Quick Play without relying on `fightName` text.

## Detection strategy
1. **Local EVTC buff scan** — add `parse_is_quick_play(bytes)` in `evtc_parser.rs` that scans raw buff events for skill ids `77676` or `79492` applied to any player.
2. **Enrichment** — in `uploader.rs` local parse and getJson paths, set `record.is_quick_play` from the local scan.
3. **Frontend badge** — new teal `Quick Play` pill between Training and Normal Mode.
4. **Filter support** — add `quickplay` to CM-mode filter options.

## Files to edit
1. `src-tauri/src/evtc_parser.rs`
2. `src-tauri/src/uploader.rs`
3. `src/routes/+page.svelte`
4. `src/app.css`

## Backup
`backups/2026-09-06.quickplay-badge-pre/` already contains copies of the four files above.

## Task A: Local Quick Play detection in `evtc_parser.rs`
- Add a new public function near `parse_is_cm` / `parse_is_lcm`:
  ```rust
  pub fn parse_is_quick_play(bytes: &[u8]) -> Option<bool> {
      // unzip if needed, validate EVTC header
      // scan buff events where is_buff == 1 and skill_id in {77676, 79492}
      // return Some(true) if any player has it, Some(false) if none, None on parse failure
  }
  ```
- Reuse the existing event-scan pattern already used for `detect_mount_balrior_cm` / `detect_outer_nayos_cm`:
  - same `event_sz = 64`
  - same `is_buff_off = sc_off - 7`
  - same `ru32(&data, base + 36)` skill-id read
  - same player-agent filtering approach

## Task B: Data model + backend wiring in `uploader.rs`
- Add `is_quick_play: Option<bool>` to `UploadRecord`, initialized to `None`.
- After local parsing (`parse_local_fallback` / early metadata extraction), call `parse_is_quick_play` and store the result.
- In `enrich_record_from_ei` and `schedule_processing_check`, keep `is_quick_play` as the local truth; do not overwrite with `false` once `Some(true)` is set.
- In repair/self-heal sweeps that re-read local EVTC, also refresh `is_quick_play`.

## Task C: Frontend badge in `+page.svelte`
- Insert a new branch in the mode badge row:
  ```svelte
  {:else if log.is_quick_play}
    <span class="cm-badge quickplay-badge">Quick Play</span>
  ```
- Final badge order:
  1. Training
  2. Quick Play
  3. Normal Mode
  4. Challenge Mode
  5. Legendary CM
  6. Personal Story

## Task D: Badge styling in `app.css`
- Add `.quickplay-badge` with the teal color from the user screenshot:
  ```css
  .quickplay-badge {
    background: rgba(34, 211, 167, 0.12);
    color: #5eead4;
    border: 1px solid rgba(34, 211, 167, 0.35);
  }
  ```

## Task E: Filter support in `+page.svelte`
- Add `"quickplay"` to CM-mode filter options.
- Add filter condition:
  ```ts
  if (f.cmMode === "quickplay" && log.is_quick_play !== true) return false;
  ```

## Verification
1. `npm run check` → 0 errors
2. `npm run build` → passes
3. `cargo check --release` → passes
4. Live test with `C:\Users\Usuario\.hermes\desktop-attachments\20260906-173108.zevtc`
   - Expected: card shows `Quick Play` badge in teal
   - Expected: filter `quickplay` isolates the log
