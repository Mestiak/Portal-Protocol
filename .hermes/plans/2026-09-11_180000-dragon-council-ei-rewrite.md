# Plan: Rewrite Dragon Council to use EI phase data

## Goal

Replace the hand-rolled Dragon Council phase detection (which parses dps.report's unreliable `phases[]` JSON) with EI's authoritative per-phase `success` data, fixing the "all yellow on wipe" bug and correctly tracking adds like Giants.

## Current context / assumptions

- The app already runs EI locally at upload time (`ei_runner::run_ei`) and stores the raw EI JSON in `ei_cache/`.
- EI's `HarvestTemple.cs` `GetPhases()` generates per-dragon `SubPhasePhaseData` with `Success` computed from actual dragon death events — NOT from dps.report's unreliable `failed` flag.
- EI's JSON output (`JsonPhaseBuilder`) exposes `phases[].success` per phase.
- The current hand-rolled system (`evtc_parser.rs::dragon_phase_full_with_adds`) parses dps.report's `phases[]` and uses a complex wipe-policy with `explicit_failed` sets to guess cleared status. This fails when dps.report omits `failed` for defeated dragons.
- The frontend `dragonCouncilMerged()` in `+page.svelte` reads `log.bosses_phases` (a `DragonPhase[]` with `cleared: bool`) and renders green/yellow chips.
- `enrich_record_from_ei` in `ei_runner.rs` currently does NOT populate `bosses_phases` from EI JSON — it only sets `boss_hp_left`, `is_cm`, `is_lcm`, `success`, `is_quick_play`.
- `uploader.rs` populates `bosses_phases` from dps.report via `fetch_dragon_timeline` (line 2635-2639), but only when `record.bosses_phases.is_none()`.

## Architecture / proposed approach

Use EI's `phases[].success` as the authoritative source for per-dragon cleared status. Store EI's phases in `record.bosses_phases` during `enrich_record_from_ei`, and adapt the frontend to read EI's phase format. Remove the hand-rolled wipe policy from `dragon_phase_full_with_adds` (keep the function for dps.report fallback but stop using it when EI data is available).

## Step-by-step tasks

### Task 1: Add `success` field to `DragonPhase` struct

**File:** `src-tauri/src/evtc_parser.rs` (line ~549)

Add `pub success: Option<bool>` to the `DragonPhase` struct so it can carry EI's per-phase success status:

```rust
pub struct DragonPhase {
    pub key: String,
    pub name: String,
    pub icon: Option<String>,
    pub kind: String,
    pub cleared: bool,
    pub order: u8,
    pub raw: String,
    pub success: Option<bool>,  // NEW: EI's authoritative success status
}
```

**Verify:** `cargo check` passes.

### Task 2: Populate `bosses_phases` from EI JSON in `enrich_record_from_ei`

**File:** `src-tauri/src/ei_runner.rs` (in `enrich_record_from_ei`, after line ~530)

Add code to extract EI's `phases[]` and convert to `DragonPhase[]`:

```rust
// Harvest Temple: extract per-dragon phases from EI's authoritative data
if record.boss_name.as_deref().map_or(false, |n| n.to_lowercase().contains("dragonvoid")) {
    if let Some(phases) = ei.get("phases").and_then(|v| v.as_array()) {
        let mut dragon_phases: Vec<crate::evtc_parser::DragonPhase> = Vec::new();
        for (idx, phase) in phases.iter().enumerate() {
            let name = phase.get("name").and_then(|v| v.as_str()).unwrap_or("");
            // Only include dragon phases (skip "Full Fight", "Purification", etc.)
            let dragon_keys = ["jormag", "primordus", "kralkatorrik", "mordremoth", "zhaitan", "soowon"];
            let is_dragon = dragon_keys.iter().any(|k| name.to_lowercase().contains(k));
            if !is_dragon {
                continue;
            }
            let success = phase.get("success").and_then(|v| v.as_bool());
            let key = name.to_lowercase().replace(|c: char| !c.is_ascii_alphanumeric(), "");
            dragon_phases.push(crate::evtc_parser::DragonPhase {
                key: key.clone(),
                name: name.to_string(),
                icon: Some(format!("the{}void", key)),
                kind: "dragon".to_string(),
                cleared: success.unwrap_or(false),
                order: idx as u8,
                raw: name.to_string(),
                success,
            });
        }
        if !dragon_phases.is_empty() {
            record.bosses_phases = Some(dragon_phases);
        }
    }
}
```

**Verify:** `cargo check` passes.

### Task 3: Adapt frontend `dragonCouncilMerged()` to use EI `success`

**File:** `src/routes/+page.svelte` (line ~1578)

Update `dragonCouncilMerged()` to use `p.success` (EI's authoritative status) instead of the hand-rolled `p.cleared`:

```javascript
function dragonCouncilMerged(
    phases: DragonPhase[],
    hpByKey: Map<string, DragonHp>,
) {
    const purification2 = phases.find((p) => p.key === "purification2");
    return phases.map((p) => {
        const hp = hpByKey.get(p.key);
        const hasHp = hp != null;
        // Use EI's success status if available, fall back to cleared flag
        const effectiveCleared = p.success !== undefined && p.success !== null
            ? p.success
            : p.cleared;
        const isDragon = p.kind === "dragon";
        const died = isDragon ? effectiveCleared : hasHp ? hp!.died : false;
        const hpLeft = isDragon
            ? effectiveCleared ? 0 : 100
            : hasHp ? hp!.hp_left : null;
        const hpState = isDragon
            ? effectiveCleared ? "dead" : "alive"
            : hasHp ? (hp!.died ? "dead" : "alive") : "dead";
        return {
            key: p.key,
            name: p.name,
            icon: p.icon ? `/bosses/${p.icon}.png` : `/bosses/the${p.key}void.png`,
            kind: p.kind,
            cleared: effectiveCleared,
            hp: hpLeft,
            died,
            hpState,
        };
    });
}
```

**Verify:** `npm run check` passes.

### Task 4: Skip dps.report `fetch_dragon_timeline` when EI phases are available

**File:** `src-tauri/src/uploader.rs` (line ~2635)

Add a guard so the hand-rolled dps.report path is skipped when EI already populated `bosses_phases`:

```rust
if is_dv && record.bosses_phases.is_none() {  // existing condition — no change needed
    // ... existing fetch_dragon_timeline code ...
}
```

The existing `is_none()` check already handles this correctly — if EI populated `bosses_phases` in `enrich_record_from_ei`, the dps.report path is skipped. No code change needed here, just verify the logic.

**Verify:** `cargo check` passes.

### Task 5: Add test for EI phase extraction

**File:** `src-tauri/src/ei_runner.rs` (at end of file, in existing `#[cfg(test)]` module or new one)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ei_phases_populate_bosses_phases_for_dragonvoid() {
        let ei = json!({
            "bossName": "The Dragonvoid",
            "phases": [
                {"name": "Full Fight", "success": false},
                {"name": "Jormag", "success": true},
                {"name": "Primordus", "success": true},
                {"name": "Kralkatorrik", "success": true},
                {"name": "Mordremoth", "success": false}
            ]
        });
        let mut record = crate::uploader::UploadRecord::default();
        record.boss_name = Some("The Dragonvoid".to_string());
        enrich_record_from_ei(&mut record, &ei);
        let phases = record.bosses_phases.expect("should have phases");
        assert_eq!(phases.len(), 4);  // only dragons, not "Full Fight"
        assert!(phases[0].success.unwrap());  // Jormag cleared
        assert!(phases[1].success.unwrap());  // Primordus cleared
        assert!(phases[2].success.unwrap());  // Kralkatorrik cleared
        assert!(!phases[3].success.unwrap()); // Mordremoth failed
    }
}
```

**Verify:** `cargo test ei_runner::tests::ei_phases_populate_bosses_phases_for_dragonvoid` passes.

### Task 6: Clean up — remove `explicit_failed` dead code

**File:** `src-tauri/src/evtc_parser.rs` (line ~754)

The `explicit_failed` set is now only used in the dps.report fallback path. Since EI is the primary source, this code is effectively dead for Dragonvoid logs. Leave it for now (YAGNI) — it still works as a fallback when EI is unavailable.

**Verify:** `cargo check` passes.

### Task 7: Manual verification with real log

Upload the attached log (`20260910-223108.zevtc`) and verify:
- Dragon Council shows green checkmarks for dragons defeated before the wipe point
- Dragon Council shows yellow X for the wipe-point dragon
- Giants/adds display correctly based on EI data

**Command:** `npm run tauri dev` → upload log → inspect Dragon Council strip.

## Tests / validation

| Step | Command | Expected |
|------|---------|----------|
| 1 | `cargo check` | exit 0 |
| 2 | `cargo check` | exit 0 |
| 3 | `npm run check` | 0 errors, 0 warnings |
| 4 | `cargo check` | exit 0 |
| 5 | `cargo test ei_phases_populate_bosses_phases_for_dragonvoid` | passed |
| 6 | `cargo check` | exit 0 |
| 7 | `npm run tauri dev` + upload log | Green chips for cleared dragons, yellow for wipe point |

## Risks, tradeoffs, and open questions

1. **EI phase naming**: EI uses names like "Jormag", "Primordus" — need to verify these match the `dragon_keys` filter. If EI uses different names (e.g., "The Dragonvoid Jormag"), the filter needs adjustment.

2. **Add tracking (Giants, Time Caster)**: EI tracks adds as separate sub-phases. The current `DragonPhase` struct doesn't distinguish adds from dragons cleanly. May need to extend the `kind` field or add a separate `bosses_adds` field. For now, focus on dragons; adds can follow.

3. **Fallback path**: If EI is disabled (`PORTAL_USE_EI=0`), the hand-rolled dps.report path still runs. The `success` field will be `None`, and the frontend falls back to `cleared`. No regression.

4. **Historical logs**: Existing history entries have `bosses_phases` populated from dps.report (with `success: None`). The frontend handles this gracefully via the `p.success !== undefined && p.success !== null` check.

5. **EI JSON structure**: The plan assumes EI's `phases[]` has `name` and `success` fields. Need to verify by inspecting a real EI JSON output for Harvest Temple.
