// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::uploader::is_legendary_cm;
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Keep the on-disk EI cache bounded so `ei_cache/` can't accumulate forever.
fn ei_cache_dir(app: &AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.push("ei_cache");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn ei_cache_path(app: &AppHandle, permalink: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    permalink.hash(&mut hasher);
    let hash = hasher.finish();
    let clean = permalink.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
    ei_cache_dir(app).join(format!("{}_ei_{:x}.json.gz", clean, hash))
}

/// Stable cache key for a local EVTC path. Same hash/clean strategy as the
/// permalink cache, so local EI results can be looked up from the same `ei_cache/`
/// directory without collisions.
fn ei_cache_path_local(app: &AppHandle, local_path: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    local_path.hash(&mut hasher);
    let hash = hasher.finish();
    let clean = local_path.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
    ei_cache_dir(app).join(format!("{}_ei_{:x}.json.gz", clean, hash))
}

/// Read a cached EI result from DISK only (gzipped JSON). The in-RAM copy is
/// intentionally NOT retained — holding a full EI Value (2-34 MB) in memory per
/// log was the bulk of the 1.6 GB bloat. Callers get a fresh parse on each open;
/// the local disk read is fast. Fix 3.
fn ei_cache_get(app: &AppHandle, permalink: &str) -> Option<Value> {
    let path = ei_cache_path(app, permalink);
    if path.exists() {
        if let Ok(gz) = std::fs::read(&path) {
            use std::io::Read;
            let mut decoder = flate2::read::GzDecoder::new(&gz[..]);
            let mut s = String::new();
            if decoder.read_to_string(&mut s).is_ok() {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Write an EI result to disk (gzipped) and prune the on-disk cache. No in-RAM
/// copy is kept (see ei_cache_get). Fix 3: kills the RAM bloat.
fn ei_cache_put(app: &AppHandle, permalink: String, raw: Value) {
    let path = ei_cache_path(app, &permalink);
    if let Ok(json_str) = serde_json::to_string(&raw) {
        // gzip to keep the cache light (EI JSON is 2-34 MB; gzip -> ~10% of that).
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        if encoder.write_all(json_str.as_bytes()).is_ok() {
            if let Ok(gz) = encoder.finish() {
                let _ = std::fs::write(path, gz);
            }
        }
    }
    // Fix 3b: bound the on-disk cache so it can't grow without limit.
    ei_cache_prune_disk(app);
}

/// Keep the on-disk EI cache bounded: delete the oldest `.gz` files beyond
/// the configured cap (`log_cache_max_files`) so `ei_cache/` can't accumulate
/// forever. A value of 0 means unbounded (legacy behaviour).
pub fn ei_cache_prune_disk(app: &AppHandle) {
    let cap = crate::config::load_config(app).log_cache_max_files;
    // 0 => unbounded; nothing to prune.
    if cap == 0 {
        return;
    }
    let dir = ei_cache_dir(app);
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("gz") {
                if let Ok(meta) = std::fs::metadata(&p) {
                    if let Ok(m) = meta.modified() {
                        files.push((m, p));
                    }
                }
            }
        }
    }
    if files.len() <= cap {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    for (_, p) in files.iter().skip(cap) {
        let _ = std::fs::remove_file(p);
    }
}

/// Candidate locations for a bundled resource (`rel` like
/// `resources/ei/GuildWars2EliteInsights-CLI.exe`). In a packaged build the
/// file lives under `resource_dir()`; under `tauri dev`, `resource_dir()` is
/// unreliable (it points at the project/target dir, not `src-tauri/resources`),
/// so we also try `CARGO_MANIFEST_DIR/resources` — the actual on-disk location
/// during development. Callers keep the first candidate that exists.
fn ei_resource_candidates(app: &AppHandle, rel: &str) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        v.push(rd.join(rel));
    }
    // Dev fallback: <src-tauri>/resources/... (set by cargo at compile time).
    v.push(Path::new(env!("CARGO_MANIFEST_DIR")).join(rel));
    v
}

/// Path to the bundled EI CLI executable inside the installed app's resources.
fn ei_binary_path(app: &AppHandle) -> Option<PathBuf> {
    for c in ei_resource_candidates(app, "resources/ei/GuildWars2EliteInsights-CLI.exe") {
        if c.exists() {
            return Some(c);
        }
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|p| p.join("resources/ei/GuildWars2EliteInsights-CLI.exe"))
}

/// Path to the bundled JSON-only EI config.
fn ei_config_path(app: &AppHandle) -> Option<PathBuf> {
    for c in ei_resource_candidates(app, "resources/ei/Settings/portal_protocol.conf") {
        if c.exists() {
            return Some(c);
        }
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|p| p.join("resources/ei/Settings/portal_protocol.conf"))
}

/// Local EI parsing is ON by default (it is the primary data source). Set
/// `PORTAL_USE_EI=0` to opt out; any other value (including unset) means enabled.
pub fn ei_enabled() -> bool {
    match std::env::var("PORTAL_USE_EI") {
        Ok(v) => v != "0",
        Err(_) => true,
    }
}

/// Best-effort check that the .NET 8 Desktop Runtime EI needs is present.
/// Framework-dependent EI requires `dotnet` on PATH OR the runtime registered
/// under the user's dotnet root. We probe by resolving `dotnet` (cheap, and the
/// app already runs under a .NET-capable host on dev machines). Returns an error
/// string with the download URL when missing.
pub fn check_dotnet_runtime() -> Result<(), String> {
    let mut cmd = Command::new("dotnet");
    cmd.arg("--list-runtimes");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    if cmd.status().is_ok() {
        return Ok(());
    }
    // Fallback: some installs expose the runtime without `dotnet` on PATH but
    // with the shared framework directory present. Probe a known registration.
    if let Some(local) = dirs_local_data_dir() {
        let probe = local.join("Microsoft\\dotnet\\shared\\Microsoft.NETCore.App");
        if probe.exists() {
            return Ok(());
        }
    }
    Err(
        "Elite Insights needs the .NET 8 Desktop Runtime. Install it (free) from \
         https://dotnet.microsoft.com/download/dotnet/8.0 — then restart Portal Protocol."
            .to_string(),
    )
}

/// Run the bundled EI on a local .evtc/.zevtc and return its native `*.json`
/// as a `Value`. EI writes `<input>_<encounter>_<result>.json` next to the
/// input file; we find it, read it, then delete the temp copy + output so the
/// raw 2 MB EI JSON never lingers (the slim result is cached by the caller).
pub fn run_ei(app: &AppHandle, input: &Path) -> Result<Value, String> {
    let bin = ei_binary_path(app).ok_or_else(|| {
        "Elite Insights binary not found in app resources (resources/ei).".to_string()
    })?;
    let cfg = ei_config_path(app).ok_or_else(|| {
        "Elite Insights config not found in app resources (resources/ei/Settings).".to_string()
    })?;
    if !input.exists() {
        return Err(format!(
            "local log file does not exist: {}",
            input.display()
        ));
    }
    // EI needs a real Windows path (it resolves via the OS loader, not MSYS).
    let input_win = path_to_windows(input);
    let mut cmd = Command::new(&bin);
    cmd.arg("-c").arg(path_to_windows(&cfg)).arg(&input_win);
    // CREATE_NO_WINDOW (0x08000000): EI is a console binary; without this a
    // visible console window flashes on every upload. Mirror lib.rs:91.
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    // Spawn (don't .status()) so we can bound the parse. EI is normally quick,
    // but a hung/misbehaving dotnet process must not pin a blocking-pool thread
    // and leave a zombied process forever — so race the wait against a timeout
    // and kill the child if it overruns. (std has no stable `wait_timeout`, so we
    // run `child.wait()` on a short-lived watch thread and bound it with a
    // channel `recv_timeout`.) The only caller (uploader.rs:1968) wraps this in
    // spawn_blocking and treats any Err as best-effort (falls back to dps.report),
    // so returning Err here is safe and breaks nothing.
    const EI_TIMEOUT: Duration = Duration::from_secs(120);
    let child: Child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn Elite Insights: {}", e))?;

    // `child` is shared so the main (timeout) path can kill it while the watch
    // thread waits on it. The watch thread takes ownership to `.wait()`; the main
    // thread locks, takes it back, and `.kill()`s on timeout/error.
    let child = std::sync::Arc::new(std::sync::Mutex::new(Some(child)));
    let child_wait = child.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Option<std::process::ExitStatus>>();
    let watch = std::thread::spawn(move || {
        let st = child_wait
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .and_then(|mut c| c.wait().ok());
        let _ = tx.send(st);
    });

    let status = match rx.recv_timeout(EI_TIMEOUT) {
        Ok(Some(s)) => s,
        Ok(None) => {
            // The child exited but its status couldn't be read — treat as a failure.
            if let Ok(mut g) = child.lock() {
                if let Some(mut c) = g.take() {
                    let _ = c.kill();
                }
            }
            return Err("Elite Insights wait failed. Falling back to dps.report.".to_string());
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            // Timed out: reap the runaway child so it can't leak/accumulate.
            if let Ok(mut g) = child.lock() {
                if let Some(mut c) = g.take() {
                    let _ = c.kill();
                }
            }
            return Err(
                "Elite Insights timed out after 120s (killed). Falling back to dps.report."
                    .to_string(),
            );
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            if let Ok(mut g) = child.lock() {
                if let Some(mut c) = g.take() {
                    let _ = c.kill();
                }
            }
            return Err("Elite Insights wait thread died. Falling back to dps.report.".to_string());
        }
    };
    // Reap the now-exited watch thread (cheap; it already returned).
    let _ = watch.join();
    if !status.success() {
        return Err(format!("Elite Insights exited with status {}", status));
    }
    // EI names the output `<stem>_<encounter>_<result>.json`. Find it.
    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string());
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let mut found: Option<PathBuf> = None;
    if let Ok(entries) = std::fs::read_dir(parent) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("json")
                && stem
                    .as_ref()
                    .map(|s| {
                        p.file_name()
                            .map(|n| n.to_string_lossy().contains(s.as_str()))
                            .unwrap_or(false)
                    })
                    .unwrap_or(false)
            {
                found = Some(p);
                break;
            }
        }
    }
    let out = found.ok_or_else(|| {
        format!(
            "Elite Insights produced no JSON for {} (is the .NET 8 Desktop Runtime installed?)",
            input.display()
        )
    })?;
    let s =
        std::fs::read_to_string(&out).map_err(|e| format!("failed reading EI output: {}", e))?;
    let val: Value =
        serde_json::from_str(&s).map_err(|e| format!("invalid EI JSON output: {}", e))?;
    // Clean up the raw EI output + the temp input copy; caller caches the slim result.
    let _ = std::fs::remove_file(&out);
    Ok(val)
}

/// Returns the locally-parsed EI result for `permalink` if it has been cached
/// (produced at upload time). `None` means "fall back to dps.report".
pub fn cached_ei_report(app: &AppHandle, permalink: &str) -> Option<Value> {
    ei_cache_get(app, permalink)
}

/// Store a locally-parsed EI result keyed by the upload permalink.
pub fn store_ei_report(app: &AppHandle, permalink: &str, raw: Value) {
    ei_cache_put(app, permalink.to_string(), raw);
}

/// Returns the locally-parsed EI result for a local file path if it has been
/// cached during the Parsing stage. `None` means "no local data yet".
pub fn cached_local_ei_report(app: &AppHandle, file_path: &str) -> Option<Value> {
    let path = ei_cache_path_local(app, file_path);
    if path.exists() {
        if let Ok(gz) = std::fs::read(&path) {
            use std::io::Read;
            let mut decoder = flate2::read::GzDecoder::new(&gz[..]);
            let mut s = String::new();
            if decoder.read_to_string(&mut s).is_ok() {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Store a locally-parsed EI result keyed by the source file path.
pub fn store_local_ei_report(app: &AppHandle, file_path: &str, raw: Value) {
    let path = ei_cache_path_local(app, file_path);
    if let Ok(json_str) = serde_json::to_string(&raw) {
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        if encoder.write_all(json_str.as_bytes()).is_ok() {
            if let Ok(gz) = encoder.finish() {
                let _ = std::fs::write(path, gz);
            }
        }
    }
    // Keep the on-disk cache bounded: the same `log_cache_max_files` cap the
    // permalink cache uses applies here too (the two cache key namespaces share
    // the same `ei_cache/` dir, so a single cap bounds both).
    let _ = crate::ei_runner::ei_cache_prune_disk(app);
}

/// Old Lion's Court phase derivation helpers.
///
/// Phase boundaries from actual robot HP ranges at wipe:
///   CM:    Phase1 = highest engaged HP > 60%, Phase2 = 20-60%, Phase3 = 0-20%
///   Normal: Phase1 = >80%, Phase2 = 40-80%, Phase3 = 10-40%, Phase4 = 0-10%
/// A CC/Puzzle wipe leaves all robots at 100% (none engaged) → `None`.
fn old_lions_court_phase_cm(
    vermilion: Option<f64>,
    indigo: Option<f64>,
    arsenite: Option<f64>,
) -> Option<u32> {
    let engaged = [vermilion, indigo, arsenite]
        .iter()
        .filter_map(|&h| h)
        .filter(|&h| h < 100.0)
        .collect::<Vec<_>>();
    if engaged.is_empty() {
        return None;
    }
    let max_hp = engaged.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if max_hp > 60.0 {
        Some(1)
    } else if max_hp > 20.0 {
        Some(2)
    } else {
        Some(3)
    }
}

fn old_lions_court_phase_normal(
    vermilion: Option<f64>,
    indigo: Option<f64>,
    arsenite: Option<f64>,
) -> Option<u32> {
    let engaged = [vermilion, indigo, arsenite]
        .iter()
        .filter_map(|&h| h)
        .filter(|&h| h < 100.0)
        .collect::<Vec<_>>();
    if engaged.is_empty() {
        return None;
    }
    let max_hp = engaged.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if max_hp > 80.0 {
        Some(1)
    } else if max_hp > 40.0 {
        Some(2)
    } else if max_hp > 10.0 {
        Some(3)
    } else {
        Some(4)
    }
}

/// Map a locally-parsed EI `Value` onto the log-card fields of an `UploadRecord`.
/// This is the core of "the final log card should be from EI": boss name, mode
/// (CM/LCM), kill/wipe verdict, HP left, players, duration and thumbnail are all
/// read from the authoritative local EI parse — not dps.report. Convergences are
/// excluded by the caller (dps.report does not run EI on them), so they keep
/// their existing local-EVTC card. Best-effort only: any missing field is left
/// untouched so dps.report's values (already set earlier) remain as a fallback.
pub fn enrich_record_from_ei(record: &mut crate::uploader::UploadRecord, ei: &Value) {
    eprintln!(
        "[ENRICH] Called for file={} boss={:?}",
        record.file_name, record.boss_name
    );
    let phase_count = ei
        .get("phases")
        .and_then(|v| v.as_array())
        .map(|p| p.len())
        .unwrap_or(0);
    eprintln!("[ENRICH] EI phases count: {}", phase_count);
    // Boss name: prefer the EI target's canonical name, then the fight name.
    let name = ei
        .get("targets")
        .and_then(|t| t.as_array())
        .and_then(|arr| arr.first())
        .and_then(|t| t.get("name"))
        .and_then(|v| v.as_str())
        .or_else(|| ei.get("fightName").and_then(|v| v.as_str()))
        .or_else(|| ei.get("name").and_then(|v| v.as_str()));
    if let Some(n) = name {
        if !n.is_empty() {
            let existing = record.boss_name.as_deref().unwrap_or("");
            let existing_clean: String = existing
                .to_lowercase()
                .replace(|c: char| !c.is_ascii_alphanumeric(), "");
            let new_clean: String = n
                .to_lowercase()
                .replace(|c: char| !c.is_ascii_alphanumeric(), "");
            // Only overwrite if EI's name is more specific than what we already have,
            // or if the names are unrelated (EI may have corrected a wrong local name).
            // This prevents EI from shortening e.g. "Qadim the Peerless" → "Qadim".
            if existing_clean.is_empty()
                || new_clean.contains(&existing_clean)
                || (!existing_clean.contains(&new_clean) && !new_clean.contains(&existing_clean))
            {
                record.boss_name = Some(n.to_string());
            }
        }
    }
    // Mode flags are authoritative from EI.
    if let Some(cm) = ei.get("isCM").and_then(|v| v.as_bool()) {
        record.is_cm = Some(cm);
    }
    // LCM detection: EI doesn't always expose isLegendaryCM for Ura.
    // Trust local EVTC parse (HP threshold detection) over EI for Ura.
    let ei_says_lcm = ei
        .get("isLegendaryCM")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let name_says_lcm = is_legendary_cm(ei);
    let local_says_lcm = record.is_lcm == Some(true);

    // Preserve local LCM detection (from EVTC HP threshold) unless EI explicitly denies it.
    // EI's JSON for Ura doesn't include maxHealth, so local parse is more reliable.
    if ei_says_lcm || name_says_lcm || local_says_lcm {
        record.is_lcm = Some(true);
    }
    // Quick Play: EI does not expose a dedicated boolean. Mirror `PhaseDto.cs`:
    // when instance buffs contain QuickplayBoost / QuickplayMorale, EI renders
    // the mode string as `Quickplay Normal Mode`. Use that exact string so the
    // app's badge matches EI's own HTML output.
    // IMPORTANT: QP is only valid for specific strikes and fractals. Raids like
    // Kaineng Overlook, Convergences, etc. can NEVER be Quick Play, even if EI
    // detects QP buffs incorrectly. Check the boss name against the allowlist.
    let qp_allowed_bosses = [
        "aetherbladelet",
        "cliffside",
        "deepstonevoice",
        "kinfall",
        "moltenboss",
        "moltenfirestorm",
        "moltenberserker",
        "moltenfirestormberserker",
        "snowblind",
        "uncategorized",
        "aetherblade",
        "urbanbattleground",
        "volcanic",
        "captainmaitrin",
        "dagda",
        // Note: Convergences, Kaineng, etc. are raids, NOT QP
    ];
    let boss_clean = record
        .boss_name
        .as_deref()
        .unwrap_or("")
        .to_lowercase()
        .replace(|c: char| !c.is_ascii_alphanumeric(), "");
    if qp_allowed_bosses.contains(&boss_clean.as_str()) {
        if let Some(phase) = ei
            .get("phases")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|p| p.get("mode"))
            .and_then(|v| v.as_str())
        {
            record.is_quick_play = Some(phase == "Quickplay Normal Mode");
        }
    }

    // Kill/wipe verdict from EI's own success flag.
    if let Some(ok) = ei.get("success").and_then(|v| v.as_bool()) {
        record.success = Some(ok);
        record.cm_verified = Some(true);
    }
    // HP left: EI reports `healthPercentBurned` PER target, and `targets[]`
    // includes EVERY entity (boss + adds + trash + pets). The OLD code took the
    // `max` HP-left across ALL targets, which for any boss with adds (Cerus +
    // Embodiments, most raids) picked the LEAST-damaged entity (an add sitting at
    // ~99.99%) and reported that as the boss HP — so EVERY boss showed ~99.99%.
    //
    // FIX: restrict to the REAL boss entities using dps.report's own classification
    // (`phases[0].targets`), which lists only the actual boss(es), excluding adds.
    // Among those, take the one the group actually fought (burned > 0). This matches
    // how dps.report / the EI app display boss HP. (Cerus CM, Conjured Amalgamate,
    // Twin Largos below still override with their specific per-form logic.)
    let boss_target_idxs: std::collections::HashSet<usize> = ei
        .get("phases")
        .and_then(|v| v.as_array())
        .and_then(|ph| ph.first())
        .and_then(|p0| p0.get("targets"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_else(|| std::iter::once(0usize).collect());
    let mut best_hp_left: Option<f64> = None;
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        for (idx, t) in targets.iter().enumerate() {
            if !boss_target_idxs.contains(&idx) {
                continue; // skip adds/trash/pets
            }
            if let Some(burned) = t.get("healthPercentBurned").and_then(|v| v.as_f64()) {
                if burned > 0.0 {
                    let hp_left = (100.0 - burned).max(0.0);
                    best_hp_left = Some(best_hp_left.map_or(hp_left, |b| b.max(hp_left)));
                }
            }
        }
        // Fallback: zero-damage wipe (no boss entity engaged) — use the first boss target.
        if best_hp_left.is_none() {
            if let Some(first_idx) = boss_target_idxs.iter().next().copied() {
                if let Some(burned) = targets
                    .get(first_idx)
                    .and_then(|t| t.get("healthPercentBurned"))
                    .and_then(|v| v.as_f64())
                {
                    best_hp_left = Some((100.0 - burned).max(0.0));
                }
            }
        }
    }
    if let Some(hp) = best_hp_left {
        record.boss_hp_left = Some(hp);
    }
    // Conjured Amalgamate (Normal + CM): split boss health into body + arms.
    // Detect by the BOSS-BODY target's presence (mode-independent: EI suffixes
    // `fightName` with " CM" in challenge mode, but the target name is always
    // "Conjured Amalgamate"). EI emits three targets — body + Right/Left Arm —
    // each with its own `healthPercentBurned`. Arms regenerate to 100% between
    // collection phases and an arm can sit above the body at wipe, so the main
    // HP line is forced to the BODY (never an arm). A fully-destroyed arm
    // reports burned >= 100 (EI's own kill judgement) -> UI shows "Killed".
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        let hp_left_of = |name: &str| -> Option<f64> {
            targets
                .iter()
                .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(name))
                .and_then(|t| t.get("healthPercentBurned").and_then(|v| v.as_f64()))
                .map(|b| (100.0 - b).max(0.0))
        };
        if let (Some(body), Some(right), Some(left)) = (
            hp_left_of("Conjured Amalgamate"),
            hp_left_of("Right Arm"),
            hp_left_of("Left Arm"),
        ) {
            record.boss_hp_left = Some(body);
            record.ca_arms = Some(crate::uploader::CAArmBreakdown {
                body_hp_left: body,
                right_arm_hp_left: right,
                left_arm_hp_left: left,
            });
        }
    }
    // Twin Largos (Normal + CM): show each twin's HP individually. Detect by the
    // EI target names `"Nikare"` / `"Kenut"` (mode-independent — `fightName`
    // carries a " CM" suffix in challenge mode, but the target names are stable).
    // A twin that was NOT engaged at wipe (phase-1/2, single-twin phase) reports
    // `healthPercentBurned` = 0, so it's left as `None` and the card shows only
    // the twin(s) actually fought. A killed twin reports burned >= 100.
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        let hp_left_of = |name: &str| -> Option<f64> {
            targets
                .iter()
                .find(|t| {
                    t.get("name")
                        .and_then(|n| n.as_str())
                        .map_or(false, |n| n.to_lowercase().contains(&name.to_lowercase()))
                })
                .and_then(|t| t.get("healthPercentBurned").and_then(|v| v.as_f64()))
                .map(|b| (100.0 - b).max(0.0))
        };
        let nikare = hp_left_of("Nikare");
        let kenut = hp_left_of("Kenut");
        // Only populate when at least one twin was genuinely engaged (burned > 0).
        // An un-reached twin sits at burned=0 -> None, so a phase-1/2 wipe yields
        // a single populated twin; a phase-3 wipe yields both.
        if nikare.is_some() || kenut.is_some() {
            record.twin_largos = Some(crate::uploader::TwinLargosBreakdown {
                nikare_hp_left: if nikare.map_or(false, |h| h < 100.0) {
                    nikare
                } else {
                    None
                },
                kenut_hp_left: if kenut.map_or(false, |h| h < 100.0) {
                    kenut
                } else {
                    None
                },
            });
        }
    }
    // Statue of Darkness (Eyes of the Statue): show each eye's HP individually.
    // EI's real target names are "Eye of Fate" / "Eye of Judgment" (the user
    // calls them Darkness / Despair). Detect by those substrings. An eye never
    // engaged at wipe (burned = 0) is left as None; a killed eye (burned >= 100)
    // shows ~0% => "Killed".
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        let hp_left_of = |name: &str| -> Option<f64> {
            targets
                .iter()
                .find(|t| {
                    t.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.to_lowercase().contains(&name.to_lowercase()))
                        .unwrap_or(false)
                })
                .and_then(|t| t.get("healthPercentBurned").and_then(|v| v.as_f64()))
                .map(|b| (100.0 - b).max(0.0))
        };
        let darkness = hp_left_of("eye of fate");
        let despair = hp_left_of("eye of judgement");
        if darkness.is_some() || despair.is_some() {
            record.eyes = Some(crate::uploader::EyeBreakdown {
                darkness_hp_left: if darkness.map_or(false, |h| h < 100.0) {
                    darkness
                } else {
                    None
                },
                despair_hp_left: if despair.map_or(false, |h| h < 100.0) {
                    despair
                } else {
                    None
                },
            });
        }
    }
    // Voice & Claw of the Fallen: show each entity's HP individually. Detect by
    // EI target names containing "voice" / "claw". An entity never engaged at
    // wipe (burned = 0) is left as None; a killed entity (burned >= 100) shows
    // ~0% => "Killed".
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        let hp_left_of = |name: &str| -> Option<f64> {
            targets
                .iter()
                .find(|t| {
                    t.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.to_lowercase().contains(&name.to_lowercase()))
                        .unwrap_or(false)
                })
                .and_then(|t| t.get("healthPercentBurned").and_then(|v| v.as_f64()))
                .map(|b| (100.0 - b).max(0.0))
        };
        let voice = hp_left_of("voice");
        let claw = hp_left_of("claw");
        if voice.is_some() || claw.is_some() {
            record.voice_claw = Some(crate::uploader::VoiceClawBreakdown {
                voice_hp_left: if voice.map_or(false, |h| h < 100.0) {
                    voice
                } else {
                    None
                },
                claw_hp_left: if claw.map_or(false, |h| h < 100.0) {
                    claw
                } else {
                    None
                },
            });
        }
    }
    // Aetherblade Hideout: two phases — Captain Mai Trin (phase 1, stalls at
    // ~10%, never reaches 0) then Echo of Scarlet (phase 2, the real final boss).
    // `phases[0].targets` lists only Mai Trin, so the default boss-HP logic
    // above misses Echo entirely. Detect by target names containing "mai trin" /
    // "scarlet" (EI's real names are "Captain Mai Trin" / "Echo of Scarlet
    // Briar" — note the SPACE in "mai trin"; "maitrin" without the space is NOT
    // a substring). Show Mai Trin's HP when she was actually fought (burned > 0
    // — you wiped on phase 1); otherwise you reached phase 2, so show Echo's HP.
    // Override `boss_hp_left` with the relevant entity so the card agrees with
    // the History-tab ground truth.
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        let hp_left_of = |name: &str| -> Option<f64> {
            targets
                .iter()
                .find(|t| {
                    t.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.to_lowercase().contains(&name.to_lowercase()))
                        .unwrap_or(false)
                })
                .and_then(|t| t.get("healthPercentBurned").and_then(|v| v.as_f64()))
                .map(|b| (100.0 - b).max(0.0))
        };
        let maitrin = hp_left_of("mai trin");
        let scarlet = hp_left_of("scarlet");
        if maitrin.is_some() || scarlet.is_some() {
            let maitrin_engaged = maitrin.map_or(false, |h| h < 100.0);
            let shown = if maitrin_engaged { maitrin } else { scarlet };
            if let Some(hp) = shown {
                record.boss_hp_left = Some(hp);
            }
            record.aetherblade = Some(crate::uploader::AetherbladeBreakdown {
                maitrin_hp_left: if maitrin_engaged { maitrin } else { None },
                scarlet_hp_left: if scarlet.map_or(false, |h| h < 100.0) {
                    scarlet
                } else {
                    None
                },
            });
        }
    }
    // Old Lion's Court: show each Watchknight's HP individually. Detect by EI
    // target names "Prototype Vermilion" / "Prototype Indigo" / "Prototype Arsenite".
    // A Watchknight not engaged at wipe reports burned=0 -> None; a killed
    // Watchknight reports burned>=100 -> ~0% => "Killed".
    // Phase derivation uses HP ranges:
    //   Phase 1: Vermilion engaged only (100% -> ~60%)
    //   Phase 2: Vermilion + Indigo engaged (100% -> ~60%)
    //   Phase 3: All three engaged (100% -> ~20% -> 0%)
    if let Some(targets) = ei.get("targets").and_then(|t| t.as_array()) {
        let hp_left_of = |name: &str| -> Option<f64> {
            targets
                .iter()
                .find(|t| {
                    t.get("name")
                        .and_then(|n| n.as_str())
                        .map_or(false, |n| n.to_lowercase().contains(&name.to_lowercase()))
                })
                .and_then(|t| t.get("healthPercentBurned").and_then(|v| v.as_f64()))
                .map(|b| (100.0 - b).max(0.0))
        };
        let vermilion = hp_left_of("Prototype Vermilion");
        let indigo = hp_left_of("Prototype Indigo");
        let arsenite = hp_left_of("Prototype Arsenite");
        if vermilion.is_some() || indigo.is_some() || arsenite.is_some() {
            // Phase boundaries differ by mode.
            // CM:    Phase1 = 100→60, Phase2 = 60→20, Phase3 = 20→0
            // Normal: Phase1 = 100→80, Phase2 = 80→40, Phase3 = 40→10, Phase4 = 10→0
            let is_cm = record.is_cm.unwrap_or(false);
            let phase = if is_cm {
                old_lions_court_phase_cm(vermilion, indigo, arsenite)
            } else {
                old_lions_court_phase_normal(vermilion, indigo, arsenite)
            };
            record.old_lions_court = Some(crate::uploader::OldLionsCourtBreakdown {
                phase,
                cc_wipe: false,
                vermilion_hp_left: if vermilion.map_or(false, |h| h < 100.0) {
                    vermilion
                } else {
                    None
                },
                indigo_hp_left: if indigo.map_or(false, |h| h < 100.0) {
                    indigo
                } else {
                    None
                },
                arsenite_hp_left: if arsenite.map_or(false, |h| h < 100.0) {
                    arsenite
                } else {
                    None
                },
            });
        }
    }
    // Kaineng Overlook: extract phase timeline from EI. Only show phase
    // breakdown on wipe logs — kill/success logs show the full fight chart
    // only (keeps the card compact on success).
    let is_kaineng = ei
        .get("targets")
        .and_then(|t| t.as_array())
        .map_or(false, |targets| {
            targets.iter().any(|t| {
                t.get("name")
                    .and_then(|n| n.as_str())
                    .map_or(false, |name| {
                        let n = name.to_lowercase();
                        n.contains("enforcer")
                            || n.contains("mindblade")
                            || n.contains("ritualist")
                            || n.contains("mech rider")
                            || n.contains("sniper")
                    })
            })
        });
    if is_kaineng && record.success != Some(true) {
        if let Some(phases) = ei.get("phases").and_then(|v| v.as_array()) {
            let mut kai_phases: Vec<crate::evtc_parser::KainengPhase> = Vec::new();
            let mut boss_phase_count = 0;
            for phase in phases {
                let name = phase.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let success = phase.get("success").and_then(|v| v.as_bool());
                // Skip breakbar-only phases
                let is_breakbar = phase
                    .get("breakbarPhase")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if is_breakbar {
                    continue;
                }
                // Populate targets first so we can determine the phase type by content
                let mut targets: Vec<crate::evtc_parser::KainengTarget> = Vec::new();
                if let Some(phase_targets) = phase.get("targets").and_then(|v| v.as_array()) {
                    for target_idx_val in phase_targets.iter() {
                        let target_idx = target_idx_val.as_u64().unwrap_or(0) as usize;
                        if let Some(target) = ei
                            .get("targets")
                            .and_then(|t| t.as_array())
                            .and_then(|t| t.get(target_idx))
                        {
                            let target_name =
                                target.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            // Use healthPercentBurned consistently (always 0-100 scale).
                            // Note: hpLeftPercent is unreliable - can be HP burned or HP left
                            // depending on encounter/version. healthPercentBurned is authoritative.
                            let burned = target
                                .get("healthPercentBurned")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            let hp_left = if burned > 0.0 && burned < 99.0 {
                                Some((100.0 - burned).max(0.0))
                            } else {
                                None
                            };
                            // Killed if HP burned >= 99%
                            let killed = burned >= 99.0;
                            let key = target_name
                                .to_lowercase()
                                .replace(|c: char| !c.is_ascii_alphanumeric(), "");
                            let icon = match key.as_str() {
                                "ministerli" => "ministerli",
                                "theenforcer" => "theenforcerer",
                                "themindblade" => "mindblade",
                                "theritualist" => "ritualist",
                                "themechrider" => "themechrider",
                                "thesniper" => "sniper",
                                _ => "unknown",
                            };
                            targets.push(crate::evtc_parser::KainengTarget {
                                key,
                                name: target_name.to_string(),
                                icon: icon.to_string(),
                                hp_left,
                                killed,
                            });
                        }
                    }
                }
                // Skip phases with > 3 targets (EI's initial summary phase)
                if targets.len() > 3 {
                    continue;
                }
                // Skip phases where no target has been engaged (all burned == 0)
                let any_engaged = targets.iter().any(|t| t.hp_left.is_some() || t.killed);
                if !any_engaged {
                    continue;
                }
                // Determine phase type and display name by examining targets
                let has_minister_li = targets.iter().any(|t| t.key.contains("ministerli"));
                let has_enforcer = targets.iter().any(|t| t.key.contains("enforcer"));
                let has_mech_rider = targets.iter().any(|t| t.key.contains("mechrider"));
                let has_sniper = targets.iter().any(|t| t.key.contains("sniper"));
                let has_ritualist = targets.iter().any(|t| t.key.contains("ritualist"));
                let has_mindblade = targets.iter().any(|t| t.key.contains("mindblade"));
                let display_name = if has_enforcer && has_mindblade && has_ritualist {
                    "Phase 2: The Enforcer, Mindblade, and Ritualist".to_string()
                } else if has_mech_rider || has_sniper {
                    "Phase 4: The Mech Rider and Sniper".to_string()
                } else if has_minister_li {
                    boss_phase_count += 1;
                    match boss_phase_count {
                        1 => "Phase 1: Minister Li".to_string(),
                        2 => "Phase 3: Minister Li".to_string(),
                        3 => "Phase 5: Minister Li".to_string(),
                        n => format!("Phase {}: Minister Li", n * 2 - 1),
                    }
                } else {
                    name.to_string()
                };
                let phase_type = if has_enforcer || has_mech_rider || has_sniper {
                    "split".to_string()
                } else {
                    "boss".to_string()
                };
                kai_phases.push(crate::evtc_parser::KainengPhase {
                    phase_type,
                    name: display_name,
                    success,
                    targets,
                });
            }
            if !kai_phases.is_empty() {
                record.kaineng_phases = Some(kai_phases);
            }
        }
    }
    // Duration: Elite Insights' own display uses `durationMS` (the trimmed fight
    // time), not timeEnd-timeStart (the full log span). Use the shared helper so
    // the card matches what dps.report / the local EI app show.
    if let Some(d) = ei_fight_duration(ei) {
        if d > 0.0 {
            record.duration = Some(d);
        }
    }
    // Thumbnail (boss portrait) from EI's fightIcon.
    if let Some(icon) = ei.get("fightIcon").and_then(|v| v.as_str()) {
        if !icon.is_empty() {
            record.boss_icon = Some(icon.to_string());
        }
    }
    // Players: map EI players[] -> PlayerInfo (account/group/profession). Roles
    // stay empty (unknown) — the card only shows group size + names.
    if let Some(players) = ei.get("players").and_then(|p| p.as_array()) {
        if !players.is_empty() {
            let mut mapped: Vec<crate::uploader::PlayerInfo> = Vec::with_capacity(players.len());
            for p in players {
                let account = p
                    .get("account")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let display = p
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(account.as_str())
                    .to_string();
                let prof_name = p.get("profession").and_then(|v| v.as_str()).unwrap_or("");
                mapped.push(crate::uploader::PlayerInfo {
                    display_name: display,
                    account,
                    profession: crate::uploader::profession_id(prof_name),
                    elite_spec: 0,
                    subgroup: p.get("group").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    role: String::new(),
                    dps: None,
                    cleave_dps: None,
                });
            }
            record.players = Some(mapped);
            record.num_players = Some(record.players.as_ref().map(|p| p.len() as u32).unwrap_or(0));
        }
    }
    // Ura CM/LCM: detect health regeneration phase (AHR = After Health Regeneration).
    // EI creates a "Healed" sub-phase when Ura crosses 1% HP and regenerates.
    let is_ura = record.boss_name.as_deref().map_or(false, |name| {
        let n = name.to_lowercase();
        // Ura boss names: "Ura", "Godscream Ura" (CM), "Ura, the Steamshrieker" (Normal)
        n.contains("ura") && (n.contains("steamshrieker") || n == "ura" || n.contains("godscream"))
    });

    eprintln!(
        "[AHR_DEBUG] Checking AHR for boss={:?}, is_ura={}, phases={}",
        record.boss_name, is_ura, phase_count
    );
    if is_ura {
        let phase_names: Vec<String> = ei
            .get("phases")
            .and_then(|v| v.as_array())
            .map(|phases| {
                phases
                    .iter()
                    .filter_map(|p| {
                        p.get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default();
        eprintln!(
            "[AHR_DEBUG] boss={:?} is_ura={} is_cm={:?} is_lcm={:?} phase_names={:?}",
            record.boss_name, is_ura, record.is_cm, record.is_lcm, phase_names
        );
    }

    if is_ura && (record.is_cm == Some(true) || record.is_lcm == Some(true)) {
        // Detect Ura health regeneration. EI creates a phase named "100% - 1%"
        // when Ura crosses 1% HP and begins regenerating. The "Healed" sub-phase
        // is only present if the Determined895 buff was removed before wipe.
        // Check ALL phases[] (not just sub-phases) for matching names.
        let has_healed_phase =
            ei.get("phases")
                .and_then(|v| v.as_array())
                .map_or(false, |phases| {
                    phases.iter().any(|p| {
                        let name = p.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        // Phase name indicating Ura reached 1% and healed
                        name == "100% - 1%" || name.contains("100% - 1%") ||
                name == "Healed" || name.to_lowercase().contains("healed") ||
                // EI phase names for Ura split phases
                name.contains("100%") && name.contains("1%")
                    })
                });
        eprintln!("[AHR_DEBUG] has_healed_phase={}", has_healed_phase);
        if has_healed_phase {
            record.ura_health_regen = Some("AHR".to_string());
            eprintln!("[AHR_DEBUG] ✓ Set AHR badge for {:?}", record.boss_name);
        } else {
            eprintln!(
                "[AHR_DEBUG] ✗ No healed phase found for {:?}",
                record.boss_name
            );
        }
    } else if is_ura {
        eprintln!(
            "[AHR_DEBUG] ✗ Skipped: is_cm={:?} is_lcm={:?}",
            record.is_cm, record.is_lcm
        );
    }
}

/// Upload-time hook: run the bundled EI on the local `.evtc` we just uploaded,
/// cache the result keyed by permalink, and return the parsed `Value` so the
/// caller can enrich the in-flight card (boss/mode/kill/HP/players/duration/
/// thumbnail) and persist it. Best-effort — any failure (no .NET runtime, parse
/// error) returns `Err` and the caller keeps dps.report as the card source.
/// The function intentionally does NOT take `&mut record`: it runs inside an
/// async task while the upload flow still mutates `record`, so the caller must
/// enrich a clone and emit/persist from there.
/// Extract the fight duration (in seconds) from an EI / dps.report JSON payload.
///
/// `timeEnd - timeStart` is the *whole log/instance span* (includes the dead
/// time before the squad engages and after the boss dies) and is NOT what EI's
/// own UI shows. Elite Insights exposes the trimmed *fight* duration under
/// `durationMS` (milliseconds) and `duration` ("05m 57s 531ms"). Those match
/// the number dps.report / the local EI app display, so they are the source of
/// truth. Prefer `durationMS`; fall back to parsing the `duration` string; only
/// as a last resort diff timeStart/timeEnd (the log span).
pub fn ei_fight_duration(ei: &Value) -> Option<f64> {
    if let Some(ms) = ei.get("durationMS").and_then(|v| v.as_f64()) {
        if ms > 0.0 {
            return Some(ms / 1000.0);
        }
    }
    if let Some(s) = ei.get("duration").and_then(|v| v.as_str()) {
        if let Some(secs) = parse_duration_string(s) {
            if secs > 0.0 {
                return Some(secs);
            }
        }
    }
    // Last-resort fallback: log span (timeEnd - timeStart).
    fn parse(s: &str) -> Option<f64> {
        let core = s.trim().rsplit_once(' ').map(|(d, _tz)| d).unwrap_or(s);
        let dt = chrono::NaiveDateTime::parse_from_str(core, "%Y-%m-%d %H:%M:%S").ok()?;
        Some(dt.and_utc().timestamp() as f64)
    }
    let start = ei
        .get("timeStart")
        .and_then(|v| v.as_str())
        .and_then(parse)?;
    let end = ei.get("timeEnd").and_then(|v| v.as_str()).and_then(parse)?;
    let d = end - start;
    if d > 0.0 {
        Some(d)
    } else {
        None
    }
}

/// Parse EI's `duration` string ("05m 57s 531ms", "1h 02m 03s", "12s 345ms", …)
/// into seconds. Returns None if it can't find any time component.
fn parse_duration_string(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let mut total = 0.0_f64;
    let mut found = false;
    // hours
    if let Some(c) = s.split("h").next() {
        if let Ok(h) = c.trim().parse::<f64>() {
            total += h * 3600.0;
            found = true;
        }
    }
    // minutes (segment between 'h' and 'm', or leading if no 'h')
    let after_h = s.split("h").last().unwrap_or(s);
    if let Some(c) = after_h.split("m").next() {
        if let Ok(m) = c.trim().parse::<f64>() {
            total += m * 60.0;
            found = true;
        }
    }
    // seconds (segment between 'm' and 's', or leading if neither 'h' nor 'm')
    let after_m = after_h.split("m").last().unwrap_or(after_h);
    if let Some(c) = after_m.split("s").next() {
        if let Ok(sec) = c.trim().parse::<f64>() {
            total += sec;
            found = true;
        }
    }
    if found {
        Some(total)
    } else {
        None
    }
}

/// native path; under MSYS the `//c/...` form is rejected by the EI `.exe`, so
/// we normalize to `C:\...`. No-op safe on non-Windows.
fn path_to_windows(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    if s.starts_with("//") {
        // //c/Users/... -> C:\Users\...
        let rest = s.trim_start_matches('/');
        let drive = &rest[..1];
        let tail = &rest[2..];
        return format!("{}:\\{}", drive.to_uppercase(), tail.replace('/', "\\"));
    }
    s.replace('/', "\\")
}

fn dirs_local_data_dir() -> Option<PathBuf> {
    // %LOCALAPPDATA% (e.g. C:\Users\<user>\AppData\Local)
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

/// Frontend-facing runtime check. Returns whether the .NET 8 Desktop Runtime
/// (needed by the bundled EI) is present, plus the download URL when missing,
/// so the UI can show a one-time, friendly setup notice.
#[derive(serde::Serialize)]
pub struct EiRuntimeStatus {
    pub available: bool,
    pub download_url: String,
}

#[tauri::command]
/// Check the EI runtime status (installed, missing, or needs update).
pub fn check_ei_runtime() -> EiRuntimeStatus {
    EiRuntimeStatus {
        available: crate::ei_runner::check_dotnet_runtime().is_ok(),
        download_url: "https://dotnet.microsoft.com/en-us/download/dotnet/8.0/runtime".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ei_phases_populate_kaineng_phases() {
        let ei = json!({
            "bossName": "Kaineng Overlook",
            "phases": [
                {"name": "Phase 1", "success": true, "targets": [0]},
                {"name": "Split Phase 1", "success": false, "targets": [1, 2, 3]},
                {"name": "Phase 2", "success": false, "targets": [0]}
            ],
            "targets": [
                {"name": "Minister Li", "healthPercentBurned": 33.0},
                {"name": "The Enforcer", "healthPercentBurned": 100.0},
                {"name": "The Mindblade", "healthPercentBurned": 100.0},
                {"name": "The Ritualist", "healthPercentBurned": 50.0}
            ]
        });
        let mut record = crate::uploader::UploadRecord::default();
        record.boss_name = Some("Kaineng Overlook".to_string());
        enrich_record_from_ei(&mut record, &ei);
        let phases = record.kaineng_phases.expect("should have phases");
        assert_eq!(phases.len(), 3);
        assert_eq!(phases[0].phase_type, "boss");
        assert!(phases[0].success.unwrap()); // Phase 1 completed
        assert_eq!(phases[1].phase_type, "split");
        assert!(!phases[1].success.unwrap()); // Split Phase 1 failed
        assert_eq!(phases[1].targets.len(), 3);
        assert_eq!(phases[1].targets[2].key, "theritualist");
        assert_eq!(phases[1].targets[2].hp_left, Some(50.0));
    }
}
