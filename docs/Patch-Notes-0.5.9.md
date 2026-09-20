# Portal Protocol - Version 0.5.9

This update focuses on local log parsing accuracy, interface feedback during the upload pipeline, and network recovery self-healing.

---

## 🔧 Bug Fixes & Improvements

### 1. Local Parser Enhancements
* **Success Check & Qadim Kills:** Added detection for server-side Reward events (`CBTEVT_REWARD`, statechange 22). Bosses like Qadim that transition to friendly NPCs at the end of the fight (e.g. leaving the boss at 0.20% HP) are now correctly evaluated as successful kills (0.00% HP) instead of being flagged as close wipes.
* **Cairn CM Detection:** Added specialized buff scanning for Cairn CM. Because Cairn does not change health pools in CM (20M in both) and does not emit the generic CM statechange event, we now scan for the presence of **Countdown** (buff 38098) or **Petrified** (buff 38235) to identify Challenge Mode.
* **Deimos & Multi-Agent CM Checks:** Fixed a bug where the parser stopped scanning at the first matching boss agent. For encounters with multiple addresses (like Deimos), the parser now checks all matching agents and selects the maximum health value, ensuring CM/LCM HP thresholds are correctly met.
* **Trimmed Fight Duration:** Modified the local parser's fight duration estimation to identify the first actual combat event (`is_statechange == 0`) involving the boss, rather than using the generic log start timestamp. This trims pre-combat spawn delay and aligns the local estimate under 0.1 seconds of Elite Insights' combat duration, eliminating duration jumping between the upload phase and the resolved card.

### 2. Stepper & Active Uploads UI
* **Real-time Metadata:** Modified Svelte cards to display the actual boss icon, display name (e.g. *Cardinal Adina Challenge Mode*), and mode badges immediately after the local parse finishes (during the "Parsing" and "Uploading" stages). Previously, these details were hidden behind a generic cloud icon and the raw filename until dps.report resolved.

### 3. Fight Time Precision
* **Duration Formatting:** Changed duration rounding from nearest-second (`Math.round`) to truncation (`Math.floor`). This matches Elite Insights' duration reporting exactly (e.g. a fight lasting `05m 48s 628ms` correctly shows as `5:48` instead of rounding up to `5:49`).

### 4. Auto-Retry Queue Resumption
* **Outage Recovery:** Fixed a bug in the retry queue where paused manual retry uploads remained stuck after dps.report returned online. The app now restarts processing the upload queue immediately upon status recovery.

### 5. Duplicate Upload Handling
* **Stuck in Resolving State:** Fixed a bug where duplicate uploads (422 status) from concurrent uploader programs got permanently stuck in the "Duplicate — resolving..." state. If dps.report detects a duplicate but the file is still actively processing (returning no permalink), the app now automatically retries the upload after a short backoff until the permalink becomes available.

### 6. UI & Clears Tab Tweaks
* **Clears Tab Dhuum Label:** Renamed the label for Dhuum in the Clears tracking tab from "Voice in the Void (Dhuum)" to "Dhuum" for cleaner layout alignment.
* **Clears Tab Typography:** Increased the font size of the boss names in the Clears tracking tab from 10px to 12px to improve scannability and legibility.

### 7. Harvest Temple (The Dragonvoid) Dragon Council Fix
* **Wrong "Cleared" Status on Failed Runs:** Fixed a critical bug where dragons that were never actually defeated (e.g. Zhaitan and Giants on a failed run) were incorrectly displayed as "Cleared" with a checkmark in the Dragon Council timeline. The root cause was that dps.report often omits the `failed` field entirely (null) for phases on wipe logs, and the parser was treating a missing `failed` flag as `false` (= "not failed" = "cleared"). Since every dragon was marked as cleared from the start, the wipe-point detection logic could never find the failure point — so no correction was ever applied. The fix changes the initial state to a conservative `false` (not cleared) when `failed` is null or absent, allowing the wipe-policy block to correctly identify which dragons were cleared before the wipe and which were not.
