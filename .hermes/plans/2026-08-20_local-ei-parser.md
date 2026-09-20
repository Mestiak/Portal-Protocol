# Local Elite Insights (EI) Parser — Cerus-only — Verified Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **STATUS: PLAN ONLY — no app code changed yet. Spike (EI run) is DONE and VERIFIED.**

**Goal:** Make Portal Protocol parse Cerus logs locally with a bundled Elite Insights binary (like BLCT does in-browser), so the Mechanics/Stats views no longer depend on dps.report's `getJson`. dps.report stays for upload + permalink + fallback.

**Architecture (SIMPLIFIED — verified by spike):**
dps.report's `getJson` *is* EI's processed output (EI is dps.report's engine). The frontend `extractMechanics` already reads EI-native field names (`Emp.A`, `MalInt.A`, `EnvGaze.Strip`, `mech.mechanicsData[].time`, `p.dpsTargets[i][phase].damage`, `p.buffUptimes` id 70253, `combatReplayData.positions`, `totalDamageTaken`, `skillMap`). **So EI's JSON is a structural drop-in for dps.report's getJson — the frontend parser needs ZERO changes.** We only need to: run EI **at upload time** (we hold the local `.evtc`), serialize its JSON into the same `LogFull { stats, raw }` shape, and cache it keyed by permalink. `get_log_full` returns the local EI result when present, else falls back to dps.report.

**Tech Stack:** Rust (Tauri v2), `std::process::Command`, serde_json, `flate2` (gzip slim cache). EI = `GW2-Elite-Insights-Parser` v3.27.1.0 (framework-dependent .NET 8 build). Frontend: unchanged `extractMechanics`.

---

## Verification already done (spike — read-only / local temp)
- Downloaded EI v3.27.1.0 (5.3 MB framework-dependent build; needs .NET 8 Desktop Runtime — `dotnet` present on this machine).
- Bundled into `src-tauri/resources/ei/` (24 MB) + config `Settings/portal_protocol.conf` (`SaveOutJSON=true`, HTML/CSV off).
- Ran EI on a real **Cerus LCM kill** (`D:/ArcLogs/arcdps.cbtlogs/Cerus (25989)/20260701-194658.zevtc`): `Parsing Successful`. Output `*.json` (2.3 MB) with `fightName:"Temple of Febe LCM"`, `isCM:true`, `success:true`, `mechanics`, `phases`, `players`, `targets`.
- Confirmed EI emits the EXACT mechanic names `extractCerus` matches: `Emp.A`, `Emp.CryRage.H`, `CryRage.C`, `MalInt.A`, `EnvGaze.Strip` → all present. Gluttony read via `buffUptimes` id 70253 → present. `dpsTargets`/`targetDamageDist`/`combatReplayData`/`skillMap`/`totalDamageTaken` all present.
- **Conclusion: no `extractMechanics` rewrite required.** Feed EI JSON as `raw`.

---

## Key design decisions (Option B: Cerus-only, dps.report kept)
1. **Run EI at upload time**, not when opening Stats. Portal Protocol already reads the local `.evtc` to upload it — run EI then, cache the result keyed by the resulting permalink.
2. **Light cache:** run EI → deserialize → keep ONLY the slim `MechanicReport`-shaped data (what the UI renders) + minimal combat summary. Delete the raw 2.3 MB EI JSON after extraction. Optionally gzip the slim cache with `flate2`. Result: ~10–200 KB per log, strictly smaller than the current dps.report getJson cache.
3. **`get_log_full` branch:** if a local EI cache exists for `permalink`, return it; else fetch dps.report getJson (existing path) as fallback. Feature-flagged by `PORTAL_USE_EI` env so dps.report stays default until verified live.
4. **Already-uploaded history logs** (no local `.evtc`) fall back to dps.report until re-uploaded locally. No raw `.evtc` caching needed for Phase 1 (keeps disk light per user request).

---

## Step-by-step plan

### Task 1: Bundle EI + config into Tauri resources ✅ DONE
- `src-tauri/resources/ei/` (EI v3.27.1.0, 24 MB) + `Settings/portal_protocol.conf`.
- Add to `tauri.conf.json` `bundle.resources`: `"resources/ei"` (so it ships in NSIS/MSI).
- Verify `cargo check --release` (from `src-tauri/`) passes.

### Task 2: `ei_runner` module — spawn EI, return parsed JSON
**Objective:** Rust function: given a local `.evtc`/`.zevtc` + app handle, run EI, return its native JSON `serde_json::Value`.

**Files:**
- Create: `src-tauri/src/ei_runner.rs`
- Modify: `src-tauri/src/lib.rs` (register module)

**Step 1:** Resolve binary: `app.path().resource_dir()?.join("resources/ei/GuildWars2EliteInsights-CLI.exe")`.
**Step 2:** Spawn:
```rust
Command::new(&bin)
  .arg("-c").arg(resource_dir.join("resources/ei/Settings/portal_protocol.conf"))
  .arg(input_evtc)            // positional, AFTER -c
  .status()?;
```
EI writes `<input>_<encounter>_<result>.json` next to input.
**Step 3:** Find + read that `.json`, parse to `Value`. Return.
**Step 4:** `cargo check --release` passes.

### Task 3: Wire EI into upload flow (run at upload, cache by permalink)
**Objective:** After a successful dps.report upload (we have permalink + the local `.evtc` path), run EI and store the slim cache.

**Files:**
- Modify: `src-tauri/src/uploader.rs` (upload success path) — call `ei_runner`, then `ei_cache_put(app, permalink, slim_value)`.
- Create helper: `ei_cache_get`/`ei_cache_put` (mirror `raw_cache_*`): `app_cache_dir()/ei_cache/<permalink_hash>.json.gz` (gzip via `flate2`).

**Step 1:** In upload success, capture local `.evtc` path (Portal Protocol already has it pre-upload). If `PORTAL_USE_EI` set and file exists, spawn EI, deserialize, **extract only the slim fields the UI needs** (or store full EI JSON gzipped if simpler — re-evaluate size), write to `ei_cache`.
**Step 2:** `cargo check --release` passes.

### Task 4: `get_log_full` returns local EI cache when present
**Objective:** Prefer local EI result, fall back to dps.report.

**Files:**
- Modify: `src-tauri/src/uploader.rs` (`get_log_full`, ~line 3456)

**Step 1:** At top of `get_log_full`, if `PORTAL_USE_EI` set:
```rust
if let Some(v) = ei_cache_get(&app, &permalink) {
    let stats = shape_log_stats(&v);   // existing fn; EI JSON has same stats shape
    return Ok(LogFull { stats, raw: v });
}
```
**Step 2:** Keep dps.report branch intact as fallback.
**Step 3:** `cargo check --release` + `npm run check` pass.

### Task 5: Final verification + phased rollout
**Step 1:** `cd src-tauri && cargo check --release` ✅
**Step 2:** `npm run check` ✅ (0 errors)
**Step 3:** `npm run build` ✅
**Step 4:** Live `npm run tauri dev` with `PORTAL_USE_EI=1`: open Stats + Mechanics on a Cerus log → numbers must match the dps.report view (cross-check vs History tab as ground truth).
**Step 5:** Timestamped backup `backups/2026-08-20.local-ei-pre/` (already done pre-code).
**Step 6:** Ship only after your live sign-off: `bash ./scripts/release-update.sh <ver>`.

---

## Tests / validation
- Rust: `cargo test` for `ei_runner` + `ei_cache` round-trip (use the saved sample `backups/2026-08-20.local-ei-pre/cerus_ei_sample.json`).
- Frontend: `npm run check` + `npm run build` clean with `PORTAL_USE_EI=1`.
- Live: Cerus Stats + Mechanics render identical numbers via EI vs dps.report path.
- Ground-truth: validate Mechanics/Analytics counts against History tab.

## Risks / tradeoffs / open questions
1. **.NET 8 Desktop Runtime required on end-user machines** (framework-dependent EI). Mitigation: detect at startup, show a friendly "install .NET 8 Desktop Runtime" message, or switch to self-contained EI (~larger) later. **DECISION NEEDED before ship.**
2. **EI version drift:** pin v3.27.1.0; re-test on EI bumps (parser matches exact mechanic names).
3. **Windows-only** in Phase 1 (`.exe`). Mac/Linux guarded with clear error.
4. **Feature flag** `PORTAL_USE_EI` keeps dps.report default until live-verified.
5. **Cache size:** slim cache (~10–200 KB) is lighter than current dps.report getJson cache. Verified approach: extract only UI-needed fields.

## Files changed (summary)
- `src-tauri/tauri.conf.json` — `bundle.resources` (DONE: dir added; config entry pending)
- `src-tauri/resources/ei/` — EI binary + config (DONE)
- `src-tauri/src/ei_runner.rs` — NEW
- `src-tauri/src/uploader.rs` — EI run at upload + `get_log_full` branch (MODIFY)
- `src-tauri/src/lib.rs` — module registration (MODIFY)
- `src/lib/mechanicParser.ts` — **NO CHANGE** (verified drop-in)
- `src/routes/StatsModal.svelte`, `MechanicsTab.svelte` — **NO CHANGE**
