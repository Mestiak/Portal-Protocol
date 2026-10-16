# Portal Protocol 0.7.2 — Patch Notes

This update fixes Quick Play badge detection (the headline bug where QP logs showed "Normal Mode"), reduces idle resource usage, eliminates unnecessary disk I/O when auto-upload is watching your logs folder, and updates the bundled Elite Insights CLI.

---

## 🔧 Bug Fixes

### Quick Play Badge Detection (Complete Fix)

Quick Play logs were incorrectly displaying "Normal Mode" instead of "Quick Play" on the log card. Three root causes were identified and fixed:

- **Local EVTC Parser (`evtc_parser.rs` — `parse_is_quick_play`):** The function only checked `isBuff == 1`, the old arcDPS format. New arcDPS builds (>= 20260501) encode buff applications as state change events (statechange 18 = BuffInitial, 69 = BuffApply, 70 = BuffChange) without setting `isBuff == 1`. The parser now recognizes all three state change values in addition to the legacy `isBuff == 1` check, ensuring QP detection works regardless of arcDPS build version.

- **Boss Name Allowlist (`uploader.rs` — `QUICK_PLAY_BOSS_NAMES`):** Two typos — `"prototypvermilion"` and `"prototyparsenite"` (missing 'e' in "prototype") — caused Old Lion's Court Prototype variant logs to fail the allowlist match, which silently discarded the local parse result before detection could run. Fixed to correct names.

- **EI Runner Allowlist (`ei_runner.rs` — `qp_allowed_bosses`):** The EI enrichment path's allowlist was missing all four Prototype variant boss names. All added for consistency.

- **dps.report Fallback:** Added a `fightMode`-based fallback that checks `metadata.fightMode` to mark the log as Quick Play when local detection is indeterminate. The fallback never overwrites a local `Some(false)` result, so genuine Normal Mode logs are never misclassified.

- **ApiTracker Clears:** Quick Play logs are now excluded from weekly clears tracking and staleness checks, since QP is a difficulty-reduced encounter.

- **Tests:** Added 6 unit tests covering new-format state change detection (18/69/70), old-format detection (`isBuff == 1`), non-QP skill ID rejection, and non-player target rejection.

### Convergence VL Rank Leakage Fixed

Janthir CM Convergences are no longer incorrectly receiving raid boss Void Lounge ranks (e.g., "The Stormsinger" for Decima) because convergences share boss names with raid bosses.

---

## 🔧 Improvements

### Slower Watcher Polling (5s, Configurable)

The folder watcher that detects new `.evtc`/`.zevtc` files when auto-upload is enabled now polls every **5 seconds** instead of every 1 second, reducing unnecessary disk I/O.

### In-Memory History Dedup (O(1) Lookups)

History is now loaded once into an in-memory `HashSet` at startup, eliminating repeated disk reads on every poll cycle. The cache is rebuilt whenever history is modified.

### Path Normalization for Dedup Check

File paths are now normalized before comparing (case-insensitive, separator-normalized), preventing duplicate uploads from path casing differences.

### Version Alignment

Bumped `Cargo.toml` to 0.7.2 to align with `package.json` and `tauri.conf.json`.

### Elite Insights CLI Update (v3.30.0 → v3.30.2)

Bundled EI parser updated. Version bump: GW2EIParserCommons 0.330.0 → 0.330.2, GW2EIEvtcParser 0.88.0 → 0.88.2.

### Vloxx (Nexus of Eternity) CM Support

Vloxx now correctly detects as CM when the boss has 70M+ HP. CM status comes from the bundled Elite Insights parser instead of dps.report, preventing overwrites from the fallback path. Ura AHR badge detection also fixed for edge cases where EI uses different phase names.

### New Void Lounge Ranks

- **Crustacean Corraler** (Kela CM) — auto-awarded on successful Kela CM kill. Badge: bg `#33272e`, text `#b64955`.
- **True Visionary** (Vloxx CM) — auto-awarded on successful Vloxx CM kill. Badge: bg `#1f2b43`, text `#5793df`.

### Convergence VL Rank Leakage Fix

VlEncounter now has `cm_only` and `lcm_only` flags. CM-only encounters only appear on CM logs. Added early return to `vlCurrentRanks()` for convergence logs.

### Zip Crate Update

Bumped `zip` dependency from `^2` to `^9` and committed `Cargo.lock` to prevent CI resolution failures from yanked crate versions.
