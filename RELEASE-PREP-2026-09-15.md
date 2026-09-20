# New Release Prep — Week of 09/15/2026

Two new encounters land next week. This doc tracks what we need to wire up once arcdps/EI emit canonical boss names.

## New Encounters

| | Nexus of Eternity | Solitary Throne |
|---|---|---|
| **Type** | Strike (Raid encounter) | Fractal |
| **Icon file** | `static/bosses/nexusofeternity.png` ✓ | `static/fractals/solitarythrone.png` ✓ |
| **Icon key** | `nexusofeternity` | — (fractals don't use boss icons) |
| **Expansion** | Visions of Eternity | Fractals of the Mists |
| **Mode timeline** | Normal now → CM later → LCM later | CM (Fractal 100) |
| **Clears grouping** | With Kela (Visions of Eternity) | — |

## Checklist (blocked until canonical names known)

### 1. Confirm boss names
- [ ] Upload Normal-mode log of Nexus of Eternity
- [ ] Upload Solitary Throne fractal log
- [ ] Read `boss_name` from History log card or `history.json` for each

### 2. Rust side (`src-tauri/src/uploader.rs`)
- [ ] `RAID_CM_INFO` — add boss key(s) with `cm: false, lcm: false` (flip CM later)
- [ ] `FRACTAL_BOSS_NAMES` — add fractal boss key(s)
- [ ] `QUICK_PLAY_BOSS_NAMES` — add if QP-eligible (TBD)

### 3. Frontend side (`src/routes/+page.svelte`)
- [ ] `STRIKE_REGISTRY` — add under "Visions of Eternity" with expansion/strike/boss
- [ ] `BOSS_ICONS` — add `nexusofeternity` key

### 4. Clears Tab (`src/routes/ApiTracker.svelte`)
- [ ] `RAIDS_DATA` — add boss under Visions of Eternity wing with key(s)

### 5. Daily Bounties (`src/routes/ApiTracker.svelte`)
- [ ] Once the daily rotation that includes this boss is observed, add to the correct `setN` array

### 6. Mode unlock follow-up (later patches)
- [ ] Flip `cm: true` in `RAID_CM_INFO` when CM unlocks
- [ ] Flip `lcm: true` in `RAID_CM_INFO` when LCM unlocks
- [ ] Bump app version, add patch notes

## How to inspect boss names on release day

1. Upload the log via Portal Protocol
2. Open History tab → find the log card → note the boss name shown
3. Or open `%APPDATA%/portal-protocol/history.json` and read `boss_name` for the new entry
4. Clean it: lowercase + strip non-alphanumeric → that's the registry key
