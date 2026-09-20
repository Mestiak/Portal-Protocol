// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

use std::io::Read;

use serde::{Deserialize, Serialize};
/// dps.report `getJson` payload (used by `dragon_phase_state`).
use serde_json::Value;

/// table. Duplicated across every agent-scan pass, so centralised here.
const BOSS_IDS: &[u16] = &[
    26106, 26126, 26142, 26146, 26196, 26681, 26257, 26309, 26889, 26231, 26625, 26720, 26774,
    26123, 26228, 27017,
];

/// A local parse reports HP in 0.01% integer steps (0..10000), so a true death
/// is exactly 0.00% and the smallest live value is 0.01%. We treat hp <= 0.005
/// as a kill; anything above is a wipe. Mirrors `SUCCESS_HP_THRESHOLD` in
/// uploader.rs (kept local here so the parser has no cross-module dependency).
const SUCCESS_HP_THRESHOLD: f64 = 0.005;

/// A player extracted from the log binary.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LocalPlayer {
    pub character_name: String,
    pub account_name: String,
    /// GW2 profession enum: 1=Guardian … 9=Revenant
    pub profession: u32,
    /// Elite specialisation ID (0 = base class)
    pub elite_spec: u32,
    /// Raid sub-group (1-5); defaults to 1 when not found in events
    pub subgroup: u32,
}

/// Parse player information from raw `.evtc` or zip-compressed `.zevtc` bytes.
pub fn parse_players(bytes: &[u8]) -> Result<Vec<LocalPlayer>, String> {
    // .zevtc files are zip archives; detect by PK magic.
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes)?
    } else {
        bytes.to_vec()
    };

    parse_evtc(&data)
}

// ─── zip extraction ───────────────────────────────────────────────────────────

/// Extract a ZEVTC-compressed EVTC payload from raw zip bytes.
pub fn extract_zip(data: &[u8]) -> Result<Vec<u8>, String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    if archive.is_empty() {
        return Err("Empty zip archive".into());
    }
    let mut entry = archive.by_index(0).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

// ─── main parser ─────────────────────────────────────────────────────────────

fn parse_evtc(data: &[u8]) -> Result<Vec<LocalPlayer>, String> {
    // Minimum viable header check
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return Err("Not a valid EVTC file".into());
    }

    // data[4..12] = "YYYYMMDD" build date (ASCII, unused for parsing)
    let revision = data[12];

    // boss_id at [13..15]; for rev >= 1 there is a padding byte at [15]
    // → agent_count starts at offset 16 for rev >= 1, 15 for rev 0
    let header_end: usize = if revision == 0 { 15 } else { 16 };

    let agent_count = ru32(data, header_end)? as usize;
    let agents_base = header_end + 4;

    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return Err("File truncated in agent section".into());
    }

    // ── 1. Collect player agents ──────────────────────────────────────────────

    // Map from agent address → (index into players vec)
    let mut addr_index: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();
    let mut players: Vec<LocalPlayer> = Vec::new();

    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;

        let addr = ru64(data, base)?;
        let prof = ru32(data, base + 8)?;
        let is_elite = ru32(data, base + 12)?;

        // Gadgets and certain NPC types use these sentinel values.
        if is_elite == 0xFFFF_FFFF || is_elite == 0xFFFF_FFFE {
            continue;
        }

        // Name field: 64 bytes starting at offset 28 within the agent.
        // arcdps format: "CharacterName\0Account.XXXX\0:N\0"
        // where :N is the 1-indexed subgroup number encoded directly by arcdps.
        // This is the PRIMARY source for subgroups — more reliable than events.
        let name_bytes = &data[base + 28..base + 92];
        let (char_name, account, sg_hint) = split_name_parts(name_bytes);

        // Player accounts always contain a dot (e.g. "PlayerName.1234").
        if char_name.is_empty() || !account.contains('.') {
            continue;
        }

        // Guard against duplicate agents (can appear in some logs)
        if addr_index.contains_key(&addr) {
            continue;
        }

        // Parse subgroup from hint (e.g. "2" or ":2")
        let subgroup_from_name = sg_hint
            .trim_start_matches(':')
            .parse::<u32>()
            .ok()
            .filter(|&n| (1..=50).contains(&n))
            .unwrap_or(1); // default to subgroup 1 if missing

        addr_index.insert(addr, players.len());
        players.push(LocalPlayer {
            character_name: char_name,
            account_name: account,
            profession: prof,
            elite_spec: is_elite,
            subgroup: subgroup_from_name,
        });
    }

    if players.is_empty() {
        return Ok(players);
    }

    // Sort by subgroup then alphabetically
    players.sort_by(|a, b| {
        a.subgroup
            .cmp(&b.subgroup)
            .then(a.character_name.cmp(&b.character_name))
    });

    Ok(players)
}

// ─── byte-read helpers ────────────────────────────────────────────────────────

fn ru16(data: &[u8], off: usize) -> Result<u16, String> {
    data.get(off..off + 2)
        .and_then(|s| <[u8; 2]>::try_from(s).ok())
        .map(u16::from_le_bytes)
        .ok_or_else(|| format!("u16 read OOB at {}", off))
}

fn ru32(data: &[u8], off: usize) -> Result<u32, String> {
    data.get(off..off + 4)
        .and_then(|s| <[u8; 4]>::try_from(s).ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| format!("u32 read OOB at {}", off))
}

fn ru64(data: &[u8], off: usize) -> Result<u64, String> {
    data.get(off..off + 8)
        .and_then(|s| <[u8; 8]>::try_from(s).ok())
        .map(u64::from_le_bytes)
        .ok_or_else(|| format!("u64 read OOB at {}", off))
}

/// Extracts character name, account name, and subgroup hint from the name block.
/// Skips empty strings (consecutive nulls) so that padding doesn't shift indices.
/// Returns `(char_name, account_name, subgroup_hint)`.
fn split_name_parts(data: &[u8]) -> (String, String, String) {
    let mut parts = Vec::new();
    let mut start = 0;
    for (i, &b) in data.iter().enumerate() {
        if b == 0 {
            if i > start {
                parts.push(String::from_utf8_lossy(&data[start..i]).into_owned());
            }
            start = i + 1;
        }
    }
    // If there is any trailing non-null sequence
    if start < data.len() {
        let tail: Vec<u8> = data[start..]
            .iter()
            .take_while(|&&b| b != 0)
            .cloned()
            .collect();
        if !tail.is_empty() {
            parts.push(String::from_utf8_lossy(&tail).into_owned());
        }
    }

    let char_name = parts.first().cloned().unwrap_or_default();
    let account = parts.get(1).cloned().unwrap_or_default();
    let sg_hint = parts.get(2).cloned().unwrap_or_default();

    (char_name, account, sg_hint)
}

/// Extracts the remaining boss HP percentage from the combat events section.
pub fn parse_boss_hp(bytes: &[u8]) -> Option<f64> {
    // 1. Unzip if needed
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };

    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let revision = data[12];
    let mut boss_id = u16::from_le_bytes([data[13], data[14]]);
    let header_boss_id = boss_id;
    let is_convergence = header_boss_id == 1523
        || header_boss_id == 1527
        || header_boss_id == 1562
        || header_boss_id == 1571;
    let header_end: usize = if revision == 0 { 15 } else { 16 };

    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;

    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return None;
    }

    if boss_id == 1523 || boss_id == 1527 || boss_id == 1562 || boss_id == 1571 {
        for i in 0..agent_count {
            let base = agents_base + i * AGENT_SZ;
            if let Ok(prof) = ru32(&data, base + 8) {
                if BOSS_IDS.contains(&(prof as u16)) {
                    boss_id = prof as u16;
                    break;
                }
            }
        }
    }

    // Find the boss agent address(es)
    let mut boss_addrs = std::collections::HashSet::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let Ok(addr) = ru64(&data, base) {
            if let Ok(prof) = ru32(&data, base + 8) {
                let matches_id = if boss_id == 25413 || boss_id == 25415 || boss_id == 25419 {
                    prof == 25413 || prof == 25415 || prof == 25419
                } else if boss_id == 21105 || boss_id == 21085 {
                    prof == 21105 || prof == 21085
                } else if boss_id == 22343 || boss_id == 22484 {
                    prof == 22343 || prof == 22484
                } else if boss_id == 24033 || boss_id == 24375 || boss_id == 25247 {
                    prof == 24033 || prof == 24375 || prof == 25247
                } else {
                    prof == boss_id as u32
                };
                if matches_id {
                    boss_addrs.insert(addr);
                }
            }
        }
    }

    // Navigate to the events section
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let skills_end = skills_base + 4 + skill_count * skill_sz;
    let events_base = skills_end;

    if events_base >= data.len() {
        return None;
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;

    let mut boss_instids: std::collections::HashSet<u16> = std::collections::HashSet::new();

    // Map from boss_addr to its last known HP (0..10000)
    let mut last_boss_hps: std::collections::HashMap<u64, u32> = std::collections::HashMap::new();
    for &addr in &boss_addrs {
        last_boss_hps.insert(addr, 10000);
    }

    let statechange_offset = if revision == 0 { 54 } else { 56 };

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }

        let src_agent = match ru64(&data, base + 8) {
            Ok(val) => val,
            Err(_) => continue,
        };
        let dst_agent = match ru64(&data, base + 16) {
            Ok(val) => val,
            Err(_) => continue,
        };
        let src_instid = match ru16(&data, base + 40) {
            Ok(val) => val,
            Err(_) => continue,
        };
        let dst_instid = match ru16(&data, base + 42) {
            Ok(val) => val,
            Err(_) => continue,
        };
        let is_statechange = data[base + statechange_offset];

        // Match against any of the tracked boss addresses and track their instids
        for &addr in &boss_addrs {
            let src_match = src_agent != 0 && (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
            if src_match && src_instid != 0 {
                boss_instids.insert(src_instid);
            }

            if is_statechange != 8 {
                let dst_match = dst_agent != 0 && (dst_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                if dst_match && dst_instid != 0 {
                    boss_instids.insert(dst_instid);
                }
            }
        }

        // 2. Health update check (8 = CBTEVT_HEALTHUPDATE)
        if is_statechange == 8 {
            let mut final_matched_addr = None;
            for &addr in &boss_addrs {
                let matches_direct =
                    src_agent != 0 && (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                let matches_inst =
                    boss_instids.contains(&src_instid) || src_instid == (addr & 0xFFFF) as u16;
                if matches_direct || matches_inst {
                    final_matched_addr = Some(addr);
                    break;
                }
            }

            if let Some(addr) = final_matched_addr {
                if dst_agent <= 10000 {
                    last_boss_hps.insert(addr, dst_agent as u32);
                }
            }
        }
    }

    // Local HP parse reports the OBSERVED final boss HP only. It deliberately
    // does NOT try to decide Clear vs Fail: for multi-phase bosses (Cerus /
    // Temple of Febe, Conjured Amalgamate, ...) both TargetDied (9) and Reward
    // (14) fire on form transitions AND on wipes AND on real kills, so neither
    // is a reliable local kill signal. The authoritative Clear/Fail comes from
    // dps.report's `success` flag, which the uploader already trusts via
    // `api_success`. A local return of <= SUCCESS_HP_THRESHOLD would be treated
    // as a kill by the uploader, so we never return 0 here — a bottomed-out wipe
    // reports the last alive HP instead.
    let mut final_form_hp: Option<u32> = None;
    // Last NON-zero HP seen. Used as the wipe HP when the final tick bottoms out
    // at exactly 0, so it scores as a Failure, never as a false Clear.
    let mut last_nonzero_hp: Option<u32> = None;
    // Per-address last HP, retained as a fallback when no direct HP tick matched.
    let mut last_hp_by_addr: std::collections::HashMap<u64, u32> = std::collections::HashMap::new();
    for &addr in &boss_addrs {
        last_hp_by_addr.insert(addr, 10000);
    }

    // Set when any Reward event (statechange 14) is present. For convergences
    // EI's `ConvergenceLogic.CheckSuccess` treats a Convergence Reward as the clear.
    let mut reward_seen = false;

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }

        let src_agent = match ru64(&data, base + 8) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let dst_agent = match ru64(&data, base + 16) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let src_instid = match ru16(&data, base + 40) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let dst_instid = match ru16(&data, base + 42) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let is_statechange = data[base + statechange_offset];

        if is_statechange == 14 {
            reward_seen = true;
        }

        // Match against any tracked boss address; collect instids for later matching.
        for &addr in &boss_addrs {
            let src_match = src_agent != 0 && (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
            if src_match && src_instid != 0 {
                boss_instids.insert(src_instid);
            }
            if is_statechange != 8 {
                let dst_match = dst_agent != 0 && (dst_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                if dst_match && dst_instid != 0 {
                    boss_instids.insert(dst_instid);
                }
            }
        }

        // Correct instid match: compare the full instid, not the truncated address.
        let instid_match = boss_instids.contains(&src_instid);

        if is_statechange == 8 {
            // Health update: attribute to a boss via direct address match OR a
            // verified boss instid.
            let mut matched_addr = None;
            for &addr in &boss_addrs {
                let direct = src_agent != 0 && (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                if direct || instid_match {
                    matched_addr = Some(addr);
                    break;
                }
            }
            if let Some(addr) = matched_addr {
                if dst_agent <= 10000 {
                    let hp = dst_agent as u32;
                    last_hp_by_addr.insert(addr, hp);
                    final_form_hp = Some(hp);
                    if hp > 0 {
                        last_nonzero_hp = Some(hp);
                    }
                }
            }
        }
    }

    // Resolution: report the observed final boss HP as a 0..100 percentage.
    //
    // Convergence kill (MOUNT BALRIOR / OUTER NAYOS): Elite Insights'
    // `ConvergenceLogic.CheckSuccess` treats a Convergence Reward event as the clear.
    // arcDPS ends the log at raw HP 0 (or a tiny nonzero tick), so we must recognise
    // the kill BEFORE the generic wipe-recovery below (which would otherwise report
    // the last live HP and mislabel a cleared convergence as a Fail). A genuine wipe
    // leaves the boss at high HP (no reward) and is NOT caught by this branch.
    if is_convergence && reward_seen {
        return Some(0.0);
    }
    // The uploader treats <= SUCCESS_HP_THRESHOLD as a kill, so we must never
    // emit 0 for a wipe. If the final tick is exactly 0 with no further proof of
    // a kill, fall back to the last alive HP (or a small floor above threshold).
    if final_form_hp == Some(0) {
        if let Some(hp) = last_nonzero_hp {
            return Some(hp as f64 / 100.0);
        }
        return Some(SUCCESS_HP_THRESHOLD + 0.01);
    }
    if final_form_hp.is_none() {
        // No health updates seen at all — fall back to last-seen per-address value,
        // preferring the address with the most recent activity. If nothing, 100%.
        if last_hp_by_addr.values().any(|&v| v != 10000) {
            let min = last_hp_by_addr
                .values()
                .filter(|&&v| v != 10000)
                .min()
                .copied();
            if let Some(hp) = min {
                return Some(hp as f64 / 100.0);
            }
        }
        return Some(100.0);
    }
    Some(final_form_hp.unwrap() as f64 / 100.0)
}

/// One dragon of the Harvest Temple "Dragon Council" (End of Dragons strike
/// "The Dragonvoid", `boss_id` 43488). In dps.report's `getJson` each dragon is
/// a *phase*, not a separate EVTC boss agent — the combat log has no per-dragon
/// HP (its only HP-tracked entities are generic Void trash). So we read the
/// `phases[]` array: every dragon phase that came back `failed:false` was
/// defeated (reached + killed); one that is present but `failed:true` was
/// reached but the run wiped on it; anything absent means the group never got
/// that far. `order` is the canonical fight order for left→right layout.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DragonHp {
    /// Stable key (e.g. "jormag") used by the frontend to pick the PNG icon.
    pub key: String,
    /// Display name (e.g. "Jormag").
    pub name: String,
    /// HP left as a percentage (0..100). 0 when `died`, 100 when never touched.
    pub hp_left: f64,
    /// True when the dragon's agent emitted `TargetDied` (statechange 9).
    pub died: bool,
    /// Canonical fight order index (0 = first fought).
    pub order: u8,
    /// Optional override icon asset key (relative to /bosses, without extension).
    /// When set, the frontend renders `/bosses/{icon}.png` instead of the
    /// default `the{key}void.png` — used by interphase chips (Purification,
    /// Void Time Caster, etc.) that aren't one of the six elder dragons.
    #[serde(default)]
    pub icon: Option<String>,
}

/// One element of the full Harvest Temple fight timeline (The Dragonvoid,
/// `boss_id` 43488). dps.report `getJson` exposes every distinct step — elder
/// dragons, Purification/breakbar phases ("Heart"), and Void mini-bosses — as a
/// `phases[]` entry. We walk `phases[]` in order and classify each into one of
/// four kinds so the frontend can render a left→right strip that mirrors the
/// real flow (e.g. Heart 1 → Jormag → Primordus → … → Soo-Won 1 → Heart 4 →
/// Soo-Won 2 + Obliterator + Goliath). The EVTC carries no per-element HP, so a
/// cleared element is `failed:false`, a reached-but-not-cleared one `failed:true`,
/// and anything never reached is simply absent from `phases[]`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DragonPhase {
    /// Stable key (e.g. "jormag", "purification1", "timecaster").
    pub key: String,
    /// Display name (e.g. "Jormag", "Purification", "Void Time Caster").
    pub name: String,
    /// Icon asset key under /bosses (without extension). Defaults to
    /// `the{key}void` on the frontend when `None`.
    pub icon: Option<String>,
    /// "dragon" | "heart" | "miniboss".
    pub kind: String,
    /// True when the phase came back `failed:false` (cleared).
    pub cleared: bool,
    /// Canonical fight-order index (0 = first).
    pub order: u8,
    /// The dps.report phase name this element was derived from (for debugging).
    pub raw: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KainengPhase {
    pub phase_type: String, // "boss" or "split"
    pub name: String,       // "Minister Li", "Split Phase 1", etc.
    pub success: Option<bool>,
    pub targets: Vec<KainengTarget>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KainengTarget {
    pub key: String,          // "ministerli", "enforcer", "mindblade", etc.
    pub name: String,         // "Minister Li", "The Enforcer", etc.
    pub icon: String,         // icon filename without extension
    pub hp_left: Option<f64>, // None if killed
    pub killed: bool,
}

/// The six Harvest Temple dragon bosses, in the order the fight presents them.
/// CM inserts two Purification phases around them but the dragon order is fixed.
const HARVEST_DRAGONS: &[(&str, &str)] = &[
    ("jormag", "Jormag"),
    ("primordus", "Primordus"),
    ("kralkatorrik", "Kralkatorrik"),
    ("mordremoth", "Mordremoth"),
    ("zhaitan", "Zhaitan"),
    ("soowon", "Soo-Won"),
];

/// Substring fragments that identify each dragon's phase in dps.report's
/// `phases[].name`. The phase titles vary ("Breath of Jormag" vs
/// "Lightning of Jormag", "Soothing Stone" vs "Soo-Won") so we match on the
/// stable core token, not the exact title.
const DRAGON_PHASE_MATCH: &[(&str, &[&str])] = &[
    ("jormag", &["jormag"]),
    ("primordus", &["primordus"]),
    ("kralkatorrik", &["kralk", "kraka"]),
    ("zhaitan", &["zhaitan"]),
    ("soowon", &["soo", "soothing stone"]),
    ("mordremoth", &["mordremoth", "swarm"]),
];

/// Interphase elements of The Dragonvoid (Purification/breakbar "Hearts" and
/// Void mini-bosses). The dps.report `phases[]` schema (captured live) is:
///   Purification 1 · Heart 1 Breakbar 1 · Jormag · Primordus · Kralkatorrik
///   Void Time Caster Breakbar 1 · Purification 2 · Void Time Caster
///   Heart 2 Breakbar 1 · Mordremoth · Giants · Void Giant 3/2/1 Breakbar 1
///   Zhaitan · Purification 3 · Void Saltspray Dragon · Void Saltspray Dragon Breakbar 1
///   Heart 3 Breakbar 1 · Soo-Won · Soo-Won 1 · Purification 4
///   Void Obliterator · Void Obliterator Breakbar 1 · Void Goliath
///   Void Goliath Breakbar 1 · Soo-Won 2
/// Each row: (`key`, `display`, `icon`, `kind`, `fragments`). The `kind` is
/// "heart" for Purification/breakbar phases and "miniboss" for Void adds. The
/// icon key resolves to `/bosses/{icon}.png`. Non-"Breakbar" fragments are the
/// *primary* phase for that element; "Breakbar" fragments only attach to the
/// primary so we don't emit a second chip for the breakbar itself.
const INTERPHASE_MATCH: &[(&str, &str, &str, &str, &[&str])] = &[
    (
        "purification1",
        "Purification 1",
        "purification",
        "heart",
        &["purification 1"],
    ),
    (
        "purification2",
        "Purification 2",
        "purification",
        "heart",
        &["purification 2"],
    ),
    (
        "timecaster",
        "Void Time Caster",
        "timecaster",
        "miniboss",
        &["timecaster", "void timecaster"],
    ),
    (
        "purification3",
        "Purification 3",
        "purification",
        "heart",
        &["purification 3"],
    ),
    (
        "purification4",
        "Purification 4",
        "purification",
        "heart",
        &["purification 4"],
    ),
    ("giants", "Giants", "giants", "miniboss", &["giants"]),
    (
        "saltspray",
        "Void Saltspray Dragon",
        "voidsaltspraydragon",
        "miniboss",
        &["void saltspray"],
    ),
    (
        "obliterator",
        "Void Obliterator",
        "voidobliterator",
        "miniboss",
        &["void obliterator"],
    ),
    (
        "goliath",
        "Void Goliath",
        "voidgoliath",
        "miniboss",
        &["void goliath"],
    ),
    // Soo-Won's second phase (50%→0%). Matched BEFORE the dragon `soowon` key
    // (whose "soo" fragment would otherwise swallow "Soo-Won 2").
    (
        "soowon2",
        "Soo-Won 2",
        "thesoowonvoid",
        "dragon",
        &["soo-won 2"],
    ),
];

const DRAGONVOID_ADD_SPECIES: &[(&str, u32)] = &[
    ("timecaster", 25025),
    ("giants", 24450),
    ("saltspray", 23846),
    ("obliterator", 23995),
    ("goliath", 24761),
];

/// Optional add-evidence collected from a local `.zevtc` for Dragonvoid adds.
/// Keys match `INTERPHASE_MATCH` add keys (`timecaster`, `giants`, ...).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DragonvoidAddEvidence {
    pub died: std::collections::HashMap<String, bool>,
    pub hp_left: std::collections::HashMap<String, f64>,
}

/// Maps a dps.report `getJson` payload into the Harvest Temple Dragon Council.
///
/// dps.report models each elder dragon as a *phase* (not a separate EVTC boss
/// agent), so we read the `phases[]` array: a dragon phase whose `failed:false`
/// came back cleared (reached + killed); one present but `failed:true` was
/// reached but the run wiped on it; any dragon absent from `phases[]` means the
/// group never progressed that far. This is the authoritative per-dragon signal
/// (the combat log itself carries no per-dragon HP).
///
/// Returns `None` when the log has no dragon phases (i.e. not The Dragonvoid),
/// so callers fall back to the single-boss HP path. Pure: takes the already
/// parsed JSON — `fetch_dragon_phases` (uploader.rs) does the network fetch.
pub fn dragon_phase_state(json: &Value) -> Option<Vec<DragonHp>> {
    dragon_phase_state_with_success(json, None)
}

/// Dragon-phase state with success gate — only returns phases if the fight matches the success filter.
pub fn dragon_phase_state_with_success(
    json: &Value,
    success: Option<bool>,
) -> Option<Vec<DragonHp>> {
    let phases = json.get("phases")?.as_array()?;
    if phases.is_empty() {
        return None;
    }

    // key -> (reached, defeated)
    let mut seen: std::collections::HashMap<String, (bool, bool)> =
        std::collections::HashMap::new();
    let mut any_dragon = false;

    for phase in phases {
        let name = match phase.get("name").and_then(|v| v.as_str()) {
            Some(n) => n.to_lowercase(),
            None => continue,
        };
        // dps.report leaves `failed` as null on many wipe logs. In that case
        // we can't trust the default `false => defeated` interpretation; instead
        // we derive defeat from the real encounter outcome later.
        let failed = phase.get("failed").and_then(|v| v.as_bool());
        for (key, frags) in DRAGON_PHASE_MATCH {
            if frags.iter().any(|f| name.contains(f)) {
                any_dragon = true;
                let entry = seen.entry((*key).to_string()).or_insert((false, false));
                entry.0 = true; // reached
                                // `failed=false` means the phase completed → defeated.
                                // `failed=true` means the phase failed → not defeated.
                                // `failed=null` is ambiguous on wipe logs → not defeated until
                                // the authoritative encounter `success` flag resolves it below.
                entry.1 = failed == Some(false);
            }
        }
    }

    if !any_dragon {
        return None;
    }

    let success = success.or_else(|| json.get("success").and_then(|v| v.as_bool()));

    let out: Vec<DragonHp> = HARVEST_DRAGONS
        .iter()
        .enumerate()
        .map(|(order, (key, disp))| {
            let (reached, mut defeated) = seen.get(*key).copied().unwrap_or((false, false));
            // A dragon is defeated only if `failed=false` explicitly.
            // `failed=true` means it wiped on this dragon.
            // `failed=null` is ambiguous on wipes → conservative default is
            // not defeated, unless the overall run was a success (then every
            // reached dragon is defeated).
            if !reached {
                defeated = false;
            } else if success == Some(true) {
                defeated = true;
            }
            DragonHp {
                key: (*key).to_string(),
                name: (*disp).to_string(),
                hp_left: if defeated { 0.0 } else { 100.0 },
                died: defeated,
                order: order as u8,
                icon: None,
            }
        })
        .collect();
    Some(out)
}

/// Builds the full left→right Harvest Temple timeline from dps.report's
/// `phases[]`: elder dragons + interphases (Purification "Hearts" + Void
/// mini-bosses). We walk `phases[]` in order and, for each phase, append the
/// matching element (dragon or interphase) the *first* time we see its key.
/// This yields a strip that mirrors the real fight flow for both kills and
/// wipes, e.g. on a full kill:
///   Purification 1 → Jormag → Primordus → Kralkatorrik → Purification 2 →
///   Void Time Caster → Mordremoth → Giants → Zhaitan → Purification 3 →
///   Void Saltspray Dragon → Soo-Won 1 → Purification 4 → Void Obliterator →
///   Void Goliath → Soo-Won 2
/// Returns `None` when there are no dragon phases (i.e. not The Dragonvoid),
/// so callers fall back to the single-boss HP path. Pure: takes the parsed
/// Builds the full Harvest Temple timeline from `dps.report` JSON, with optional
/// local add-evidence for adds at/after the wipe point.
/// can be upgraded from uncleared→cleared if the local log shows the add died,
/// or supply an `hp_left` estimate for survived adds.
pub fn dragon_phase_full_with_adds(
    json: &Value,
    success: bool,
    add_evidence: Option<&DragonvoidAddEvidence>,
) -> Option<Vec<DragonPhase>> {
    let phases = json.get("phases")?.as_array()?;
    if phases.is_empty() {
        return None;
    }

    let mut out: Vec<DragonPhase> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let dragon_keys: std::collections::HashSet<&str> =
        HARVEST_DRAGONS.iter().map(|(k, _)| *k).collect();
    // Track ONLY explicitly failed dragons from phases[]. Missing/null `failed`
    // must NOT be treated as a wipe — on kill logs dps.report often omits the
    // field for defeated dragons, and the overall `success` flag is the
    // authoritative source for those.
    let mut explicit_failed: std::collections::HashSet<String> = std::collections::HashSet::new();

    for phase in phases {
        let name = match phase.get("name").and_then(|v| v.as_str()) {
            Some(n) => n.to_lowercase(),
            None => continue,
        };
        if name.contains("breakbar") {
            continue;
        }
        // Three-state: Some(true) = explicitly failed, Some(false) = explicitly
        // cleared, None = absent/null (common on wipe logs from dps.report).
        // We must NOT default to `false` here — that would incorrectly mark a
        // wipe-point dragon as cleared before the wipe-policy block runs.
        let failed: Option<bool> = phase.get("failed").and_then(|v| v.as_bool());

        let mut matched: Option<(&str, &str, &str, &str)> = None;
        for (key, disp, icon, kind, frags) in INTERPHASE_MATCH {
            if frags.iter().any(|f| name.contains(f)) {
                matched = Some((key, disp, icon, kind));
                break;
            }
        }
        if matched.is_none() {
            for (key, frags) in DRAGON_PHASE_MATCH {
                if frags.iter().any(|f| name.contains(f)) {
                    let disp = HARVEST_DRAGONS
                        .iter()
                        .find(|(k, _)| *k == *key)
                        .map(|(_, d)| *d)
                        .unwrap_or(*key);
                    matched = Some((key, disp, "", "dragon"));
                    break;
                }
            }
        }

        if let Some((key, disp, icon, kind)) = matched {
            if seen.insert(key.to_string()) {
                let order = out.len() as u8;
                if failed == Some(true) {
                    explicit_failed.insert(key.to_string());
                }
                // `cleared` is set conservatively:
                //   Some(false) = explicitly cleared by dps.report → true
                //   Some(true)  = explicitly failed               → false
                //   None        = absent/null (ambiguous wipe log) → false
                // The wipe-policy block below then upgrades earlier dragons
                // to cleared based on the authoritative wipe-point order.
                let initially_cleared = failed == Some(false);
                out.push(DragonPhase {
                    key: key.to_string(),
                    name: disp.to_string(),
                    icon: if icon.is_empty() {
                        None
                    } else {
                        Some(icon.to_string())
                    },
                    kind: kind.to_string(),
                    cleared: initially_cleared,
                    order,
                    raw: phase
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                });
            }
        }
    }

    if out.is_empty() {
        return None;
    }
    if !out.iter().any(|p| dragon_keys.contains(p.key.as_str())) {
        return None;
    }

    if success {
        // Encounter success means the instance finished. For Harvest Temple,
        // dps.report may still mark the last dragon as uncleared on a wipe,
        // or omit `failed` entirely. Derive the wipe point from the LAST
        // dragon's initial cleared state: if it was explicitly cleared
        // (`failed=false`), this is a kill and all dragons are cleared.
        // Otherwise the last dragon is the wipe point and stays uncleared.
        let last_dragon_order = out
            .iter()
            .rev()
            .find(|p| dragon_keys.contains(p.key.as_str()))
            .map(|p| p.order);
        if let Some(lo) = last_dragon_order {
            for p in out.iter_mut() {
                if dragon_keys.contains(p.key.as_str()) {
                    if p.order == lo {
                        if !p.cleared {
                            // Wipe point stays uncleared.
                            continue;
                        }
                    }
                }
                p.cleared = true;
            }
        }
    } else {
        // Wipe policy: on failure, do NOT blindly clear everything before the
        // last timeline element. dps.report may keep listing later phases after
        // a wipe, so an earlier dragon/add can appear before the final entry
        // even though the run actually failed there. Instead, derive the wipe
        // point as the FIRST dragon with `failed=true`. Dragons/adds before that
        // point were reached before the wipe and are cleared; anything at/after
        // stays uncleared unless local EVTC evidence says otherwise.
        // Wipe point: first dragon explicitly marked failed (failed=true). If no
        // dragon is explicitly failed, dps.report omitted the field for defeated
        // dragons — fall back to the last dragon in the timeline as the wipe point.
        let wipe_order = out
            .iter()
            .find(|p| {
                dragon_keys.contains(p.key.as_str()) && explicit_failed.contains(p.key.as_str())
            })
            .map(|p| p.order)
            .or_else(|| {
                out.iter()
                    .rev()
                    .find(|p| dragon_keys.contains(p.key.as_str()))
                    .map(|p| p.order)
            });

        if let Some(wipe_order) = wipe_order {
            for p in out.iter_mut() {
                if dragon_keys.contains(p.key.as_str()) {
                    // Elder dragons: preserve explicitly failed (failed=true). A dragon
                    // before the wipe point that was NOT explicitly failed was cleared —
                    // dps.report simply omitted the `failed` field (common on wipe logs).
                    if !explicit_failed.contains(p.key.as_str()) && p.order < wipe_order {
                        p.cleared = true;
                    }
                    continue;
                } else if p.order < wipe_order {
                    p.cleared = true;
                } else if let Some(evidence) = add_evidence {
                    if let Some(died) = evidence.died.get(p.key.as_str()) {
                        p.cleared = *died;
                    } else {
                        p.cleared = false;
                    }
                } else {
                    p.cleared = false;
                }
            }
        }
    }
    Some(out)
}

/// independent of Elite Insights / dps.report. This is the EI-independent fallback
/// used when dps.report has no EI JSON for an encounter (common for Convergences).
///
/// Signal: the boss agent's combat window, measured as the span between the first
/// and last health-update (`StateChange::HealthUpdate = 8`) events on the boss agent.
/// This starts when the boss first takes damage and ends at the death tick, so it
/// excludes pre-event navigation — unlike `parse_duration` (full log span).
///
/// Note: arcdps `EnterCombat`/`ExitCombat` (9/10) fire on the *squad* (src_agent == 1),
/// not the boss agent, so they are NOT a reliable boss-window signal.
pub fn parse_boss_fight_duration(bytes: &[u8]) -> Option<f64> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let revision = data[12];
    let mut boss_id = u16::from_le_bytes([data[13], data[14]]);
    let header_boss_id = boss_id;
    let _is_convergence = header_boss_id == 1523
        || header_boss_id == 1527
        || header_boss_id == 1562
        || header_boss_id == 1571;
    let header_end: usize = if revision == 0 { 15 } else { 16 };

    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return None;
    }

    // Resolve convergence boss prof id (same mapping as parse_boss_hp)
    if [1523u16, 1527, 1562, 1571].contains(&boss_id) {
        for i in 0..agent_count {
            let base = agents_base + i * AGENT_SZ;
            if let Ok(prof) = ru32(&data, base + 8) {
                if BOSS_IDS.contains(&(prof as u16)) {
                    boss_id = prof as u16;
                    break;
                }
            }
        }
    }

    let mut boss_addrs: std::collections::HashSet<u64> = std::collections::HashSet::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let (Ok(addr), Ok(prof)) = (ru64(&data, base), ru32(&data, base + 8)) {
            if prof == boss_id as u32 {
                boss_addrs.insert(addr);
            }
        }
    }
    if boss_addrs.is_empty() {
        return None;
    }

    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base >= data.len() {
        return None;
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let statechange_offset = if revision == 0 { 54 } else { 56 };

    let mut first_hp: Option<u64> = None;
    let mut first_combat_event: Option<u64> = None;
    let mut last_hp: Option<u64> = None;
    let mut boss_death_time: Option<u64> = None;
    let mut last_boss_event_time: Option<u64> = None;

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        let time = match ru64(&data, base) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let src_agent = match ru64(&data, base + 8) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let dst_agent = match ru64(&data, base + 16) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let is_statechange = data[base + statechange_offset];

        let on_boss = boss_addrs.iter().any(|&a| {
            (src_agent & 0xFFFF_FFFF) == (a & 0xFFFF_FFFF)
                || (dst_agent & 0xFFFF_FFFF) == (a & 0xFFFF_FFFF)
        });

        if on_boss {
            last_boss_event_time = Some(time);
            if is_statechange == 0 {
                // First normal combat event involving the boss = actual combat engagement start!
                if first_combat_event.is_none() {
                    first_combat_event = Some(time);
                }
            }
        }

        if is_statechange == 8 {
            if on_boss {
                if first_hp.is_none() {
                    first_hp = Some(time);
                }
                last_hp = Some(time);
            }
        } else if is_statechange == 9 {
            // TargetDied: emitted on the dead agent. If it belongs to a boss,
            // record the death tick as the authoritative end of the boss fight,
            // matching EI/dps.report's phase end timing.
            let on_boss_died = boss_addrs
                .iter()
                .any(|&a| (src_agent & 0xFFFF_FFFF) == (a & 0xFFFF_FFFF));
            if on_boss_died {
                boss_death_time = Some(time);
            }
        }
    }

    // Start-time hierarchy:
    // 1) first combat engagement event (most accurate to EI's active fight time)
    // 2) first observed boss HealthUpdate
    let start_time = first_combat_event.or(first_hp);

    // End-time hierarchy, mirroring EI's PhaseData.OverrideEndTime():
    // 1) explicit boss death tick
    // 2) last boss HealthUpdate when present
    // 3) last observed boss event (approximates LastAware / despawn fallback)
    let end_time = boss_death_time.or(last_hp).or(last_boss_event_time);
    match (start_time, end_time) {
        (Some(f), Some(l)) if l >= f => {
            let secs = (l - f) as f64 / 1000.0;
            if secs > 0.0 {
                Some(secs)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Full-encounter live duration: pre-event LogStart -> boss death-tick.
/// Counts the WHOLE encounter (incl. long pre-events like W3 Escort tower
/// capture) up to the boss's death, trimming only post-death loading padding.
/// Used for the provisional "while uploading" time; dps.report overwrites it.
pub fn parse_full_fight_duration(bytes: &[u8]) -> Option<f64> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }
    let revision = data[12];
    let mut boss_id = u16::from_le_bytes([data[13], data[14]]);
    let header_boss_id = boss_id;
    let _is_convergence = header_boss_id == 1523
        || header_boss_id == 1527
        || header_boss_id == 1562
        || header_boss_id == 1571;
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return parse_duration(bytes);
    }
    // Resolve convergence boss prof id (same mapping as parse_boss_hp)
    if [1523u16, 1527, 1562, 1571].contains(&boss_id) {
        for i in 0..agent_count {
            let base = agents_base + i * AGENT_SZ;
            if let Ok(prof) = ru32(&data, base + 8) {
                if BOSS_IDS.contains(&(prof as u16)) {
                    boss_id = prof as u16;
                    break;
                }
            }
        }
    }
    let mut boss_addrs: std::collections::HashSet<u64> = std::collections::HashSet::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let (Ok(addr), Ok(prof)) = (ru64(&data, base), ru32(&data, base + 8)) {
            if prof == boss_id as u32 {
                boss_addrs.insert(addr);
            }
        }
    }
    // Fall back to full-span parse if the boss agent isn't resolvable
    if boss_addrs.is_empty() {
        return parse_duration(bytes);
    }

    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base >= data.len() {
        return parse_duration(bytes);
    }
    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let statechange_offset = if revision == 0 { 54 } else { 56 };

    let mut pre_event_start: Option<u64> = None; // earliest LogStart (1)
    let mut boss_death: Option<u64> = None; // boss's last HealthUpdate (8)

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        let time = match ru64(&data, base) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let is_statechange = data[base + statechange_offset];
        if is_statechange == 1 {
            pre_event_start = Some(pre_event_start.map_or(time, |s| s.min(time)));
        } else if is_statechange == 8 {
            let src_agent = match ru64(&data, base + 8) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let dst_agent = match ru64(&data, base + 16) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let on_boss = boss_addrs.iter().any(|&a| {
                (src_agent & 0xFFFF_FFFF) == (a & 0xFFFF_FFFF)
                    || (dst_agent & 0xFFFF_FFFF) == (a & 0xFFFF_FFFF)
            });
            if on_boss {
                boss_death = Some(time);
            }
        }
    }

    match (pre_event_start, boss_death) {
        (Some(s), Some(e)) if e >= s => {
            let secs = (e - s) as f64 / 1000.0;
            if secs > 0.0 {
                Some(secs)
            } else {
                parse_duration(bytes)
            }
        }
        _ => parse_duration(bytes),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalLogMeta {
    pub boss_name: Option<String>,
    pub boss_icon: Option<String>,
    pub success: Option<bool>,
    pub duration: Option<f64>,
    pub boss_hp_left: Option<f64>,
    pub is_cm: Option<bool>,
    pub is_lcm: Option<bool>,
    pub num_players: Option<u32>,
    pub instance_name: Option<String>,
    pub dragonvoid_add_evidence: Option<DragonvoidAddEvidence>,
    pub cerus_empowered_stacks: Option<u32>,
}

/// Build conservative Dragonvoid add evidence from a local `.zevtc`.
///
/// Scans the agent table for known add species IDs (`DRAGONVOID_ADD_SPECIES`)
/// and then walks the events block recording:
///   * `died`  — set to `true` only when a `TargetDied` statechange (`9`) is
///               seen for that species' agent address;
///   * `hp_left` — the last observed HP% (`0..100`) from a `HealthUpdate`
///                 statechange (`8`) for that species, when present.
///
/// Absence from the returned map means “no local evidence seen”; the caller
/// should treat such adds as uncleared per the conservative wipe contract.
/// For non-Dragonvoid encounters this is a no-op (`None`).
pub fn parse_dragonvoid_add_evidence(
    data: &[u8],
    agents_base: usize,
    agent_count: usize,
) -> Option<DragonvoidAddEvidence> {
    let revision = data[12];
    let _header_end: usize = if revision == 0 { 15 } else { 16 };
    let skills_base = agents_base + agent_count * 96;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base + 64 > data.len() {
        return Some(DragonvoidAddEvidence::default());
    }
    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let statechange_offset = if revision == 0 { 54 } else { 56 };

    // Map add species key → agent address (only adds we actually have agents for).
    let mut addrs: std::collections::HashMap<&'static str, u64> = std::collections::HashMap::new();
    for i in 0..agent_count {
        let base = agents_base + i * 96;
        if let (Ok(addr), Ok(prof)) = (ru64(&data, base), ru32(&data, base + 8)) {
            for &(key, species_id) in DRAGONVOID_ADD_SPECIES {
                if prof == species_id as u32 {
                    addrs.insert(key, addr);
                    break;
                }
            }
        }
    }
    if addrs.is_empty() {
        return Some(DragonvoidAddEvidence::default());
    }

    let mut died: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    let mut hp_left: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for (key, _) in &addrs {
        died.insert((*key).to_string(), false);
    }

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        let src_agent = match ru64(&data, base + 8) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let dst_agent = match ru64(&data, base + 16) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let is_statechange = data[base + statechange_offset];

        for (key, &addr) in &addrs {
            let matches = (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF)
                || (dst_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
            if !matches {
                continue;
            }
            if is_statechange == 9 {
                died.insert((*key).to_string(), true);
            } else if is_statechange == 8 && dst_agent <= 10000 {
                hp_left.insert((*key).to_string(), dst_agent as f64 / 100.0);
            }
        }
    }

    Some(DragonvoidAddEvidence { died, hp_left })
}

/// Best-effort local fallback when dps.report enrichment is unavailable.
/// Reads encounter metadata directly from the EVTC binary.
pub fn parse_local_fallback(bytes: &[u8]) -> Option<LocalLogMeta> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let revision = data[12];
    let boss_id = u16::from_le_bytes([data[13], data[14]]);
    let header_end: usize = if revision == 0 { 15 } else { 16 };

    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return None;
    }

    let is_cm = parse_is_cm(bytes);
    let is_lcm = parse_is_lcm(bytes);

    let mut boss_name_str = get_boss_name_from_id(boss_id);
    if is_cm == Some(true) {
        match boss_id {
            26231 | 26625 | 26720 | 26774 => {
                boss_name_str = "Godsquall Decima".to_string();
            }
            26257 | 26309 | 26889 | 26725 => {
                boss_name_str = "Godspoil Greer".to_string();
            }
            26123 | 26228 | 27017 | 26712 => {
                boss_name_str = "Godscream Ura".to_string();
            }
            _ => {}
        }
    }
    let boss_name = Some(boss_name_str);

    let duration = parse_boss_fight_duration(bytes);
    // FIX: parse_boss_hp() already returns HP as a 0..100 percentage value.
    // Do NOT divide by 100 again. See line 485 for parse_boss_hp's return format.
    let boss_hp_left = parse_boss_hp(bytes);
    let dragonvoid_add_evidence = if boss_id == 43488 {
        parse_dragonvoid_add_evidence(&data, agents_base, agent_count)
    } else {
        None
    };

    let mut players = 0u32;
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let (Ok(prof), Ok(elite)) = (ru32(&data, base + 8), ru32(&data, base + 12)) {
            if elite != 0xFFFF_FFFF && elite != 0xFFFF_FFFE && (1..=9).contains(&prof) {
                players += 1;
            }
        }
    }
    let num_players = if players > 0 { Some(players) } else { None };

    // FIX: Use SUCCESS_HP_THRESHOLD for consistency with parse_boss_hp().
    // boss_hp_left is in 0..100 range (percentage), so:
    // - HP <= 0.005 (0.005%) → kill
    // - HP > 0.005 → wipe
    // This matches the semantic used throughout parse_boss_hp().
    let success = boss_hp_left.map(|hp| hp <= SUCCESS_HP_THRESHOLD);
    let boss_icon = if boss_id == 43488 {
        Some("dragonvoid".to_string())
    } else {
        None
    };
    let instance_name = None;
    let cerus_empowered_stacks = parse_cerus_empowered_stacks(bytes);

    Some(LocalLogMeta {
        boss_name,
        boss_icon,
        success,
        duration,
        boss_hp_left,
        is_cm,
        is_lcm,
        num_players,
        instance_name,
        dragonvoid_add_evidence,
        cerus_empowered_stacks,
    })
}

/// Return the boss display name for a given species/boss ID.
pub fn get_boss_name_from_id(boss_id: u16) -> String {
    match boss_id {
        // W1
        15438 => "Vale Guardian".to_string(),
        15429 => "Gorseval the Multifarious".to_string(),
        15375 => "Sabetha the Saboteur".to_string(),
        // W2
        16123 => "Slothasor".to_string(),
        16088 => "Berg".to_string(),
        16082 => "Zane".to_string(),
        16098 => "Narella".to_string(),
        16115 => "Matthias Gabrel".to_string(),
        // W3
        16253 => "Keep Construct".to_string(),
        16235 => "Keep Construct".to_string(),
        16246 => "Xera".to_string(),
        // W4
        17194 => "Cairn the Indomitable".to_string(),
        17172 => "Mursaat Overseer".to_string(),
        17188 => "Samarog".to_string(),
        17154 => "Deimos".to_string(),
        // W5
        19767 => "Soulless Horror".to_string(),
        19828 => "River of Souls".to_string(),
        19691 => "Statue of Ice".to_string(),
        19651 => "Statue of Death".to_string(),
        19844 => "Statue of Darkness".to_string(),
        19450 => "Dhuum".to_string(),
        // W6
        21105 | 21085 => "Conjured Amalgamate".to_string(),
        21189 => "Nikare".to_string(),
        21100 => "Kenut".to_string(),
        20934 => "Qadim".to_string(),
        // W7
        22006 => "Cardinal Adina".to_string(),
        22343 | 22484 | 21964 => "Cardinal Sabir".to_string(),
        22000 => "Qadim the Peerless".to_string(),
        // W8 / Janthir Syntri
        26257 | 26309 | 26889 => "Greer".to_string(),
        26725 => "Greer, the Blightbringer".to_string(),
        26231 | 26625 | 26720 | 26774 => "Decima".to_string(),
        26867 => "Godsquall Decima".to_string(),
        26123 | 26228 | 27017 | 26712 => "Ura".to_string(),
        // SotO Convergences
        26142 => "Demon Knight".to_string(),
        26126 => "Sorrow".to_string(),
        26106 => "Dreadwing".to_string(),
        26146 => "Hell Sister".to_string(),
        26196 | 26681 => "Umbriel".to_string(),
        // IBS Strikes
        22154 => "Icebrood Construct".to_string(),
        22611 => "Kodan Brothers".to_string(),
        22521 => "Fraenir of Jormag".to_string(),
        22582 => "Boneskinner".to_string(),
        22711 => "Whisper of Jormag".to_string(),
        22836 => "Varinia Stormsounder".to_string(),
        // EoD Strikes
        24033 => "Captain Mai Trin".to_string(),
        23957 => "Ankka".to_string(),
        24266 | 24485 => "Minister Li".to_string(),
        24375 => "Void".to_string(),
        25413 | 25415 | 25419 => "Old Kaineng Prototype".to_string(),
        // SotO Strikes
        25705 => "Dagda".to_string(),
        25989 => "Cerus".to_string(),
        // Harvest Temple
        43488 => "The Dragonvoid".to_string(),
        // Janthir Wilds Strikes
        27124 => "Kela, Seneschal of Waves".to_string(),
        // Fractals
        17021 => "M.A.M.A.".to_string(),
        17028 => "Siax the Corrupted".to_string(),
        16948 => "Ensolyss of the Endless Torment".to_string(),
        17613 => "Skorvald the Shattered".to_string(),
        17949 => "Artsariiv".to_string(),
        17759 => "Arkk".to_string(),
        23254 => "Ai, Keeper of the Peak".to_string(),
        25357 => "Kanaxai, Scythe of Souls".to_string(),
        26239 | 26262 => "Eparch, The Lonely King".to_string(),
        27010 => "Whispering Shadow".to_string(),

        // Convergences
        1523 | 1527 => "Convergence: Outer Nayos".to_string(),
        1562 | 1571 => "Convergence: Mount Balrior".to_string(),

        // Personal Story instance maps (story logs carry the map id as the "boss id").
        579 => "The Snaff Prize".to_string(),
        584 => "Taking Credit Back".to_string(),
        581 => "A Sparkling Rescue".to_string(),
        594 => "Stand By Your Krewe".to_string(),
        587 => "Here, There, Everywhere".to_string(),

        _ => format!("Encounter {}", boss_id),
    }
}

/// Parse the boss species ID and optional display name from an EVTC header.
pub fn parse_boss_id(bytes: &[u8]) -> Option<(u16, Option<String>)> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 15 || !data.starts_with(b"EVTC") {
        return None;
    }
    let mut boss_id = u16::from_le_bytes([data[13], data[14]]);
    let revision = data[12];
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return None;
    }

    if [1523u16, 1527, 1562, 1571].contains(&boss_id) {
        for i in 0..agent_count {
            let base = agents_base + i * AGENT_SZ;
            if let Ok(prof) = ru32(&data, base + 8) {
                if BOSS_IDS.contains(&(prof as u16)) {
                    boss_id = prof as u16;
                    break;
                }
            }
        }
    }

    // Resolve the real boss agent(s) and read their actual in-game name. arcDPS
    // reuses the same header `boss_id` across multiple encounters in a strike
    // (e.g. Icebrood Saga: 22521 = both Fraenir of Jormag AND Boneskinner), so the
    // id alone can't pick the right one. dps.report reads the boss NPC's name string
    // from the agent table — we do the same so the live preview shows the correct
    // boss (and icon) before upload, instead of the static id->name fallback.
    let mut boss_addrs: std::collections::HashSet<u64> = std::collections::HashSet::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let (Ok(addr), Ok(prof)) = (ru64(&data, base), ru32(&data, base + 8)) {
            let matches_id = if boss_id == 25413 || boss_id == 25415 || boss_id == 25419 {
                prof == 25413 || prof == 25415 || prof == 25419
            } else if boss_id == 21105 || boss_id == 21085 {
                prof == 21105 || prof == 21085
            } else if boss_id == 22343 || boss_id == 22484 {
                prof == 22343 || prof == 22484
            } else {
                prof == boss_id as u32
            };
            if matches_id {
                boss_addrs.insert(addr);
            }
        }
    }

    let mut boss_name: Option<String> = None;
    if !boss_addrs.is_empty() {
        // The boss agent's name lives at +28 in the arcdps agent struct; the first
        // non-empty one wins. Fall back to the id->name map only if none is found.
        let mut first_addr: Option<u64> = None;
        for i in 0..agent_count {
            let base = agents_base + i * AGENT_SZ;
            if let (Ok(addr), Ok(prof)) = (ru64(&data, base), ru32(&data, base + 8)) {
                let is_boss = boss_addrs.contains(&addr)
                    || (prof == boss_id as u32
                        && (prof == 22468
                            || prof == 22521
                            || prof == 22154
                            || prof == 22582
                            || prof == 22611
                            || prof == 22711
                            || prof == 22836));
                if is_boss {
                    if first_addr.is_none() {
                        first_addr = Some(addr);
                    }
                    let name_bytes = &data[base + 28..base + 92];
                    let n = name_bytes.split(|&b| b == 0).next().unwrap_or(&[]);
                    if let Ok(s) = String::from_utf8(n.to_vec()) {
                        let t = s.trim();
                        if !t.is_empty() && !t.chars().all(|c| c.is_ascii_digit()) {
                            boss_name = Some(t.to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    Some((boss_id, boss_name))
}

/// Parse the total fight duration (ms) from an EVTC header.
pub fn parse_duration(bytes: &[u8]) -> Option<f64> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }
    let revision = data[12];
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let skills_end = skills_base + 4 + skill_count * skill_sz;
    let events_base = skills_end;

    if events_base >= data.len() {
        return None;
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    if event_count < 2 {
        return None;
    }

    let statechange_offset = if revision == 0 { 54 } else { 56 };

    let mut log_start: Option<u64> = None;
    let mut log_end: Option<u64> = None;
    let mut first_evt: Option<u64> = None;
    let mut last_evt: Option<u64> = None;

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        let t = match ru64(&data, base) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if first_evt.is_none() {
            first_evt = Some(t);
        }
        last_evt = Some(t);
        let sc = data[base + statechange_offset];
        if sc == 1 {
            log_start = Some(log_start.map_or(t, |s| s.min(t)));
        } else if sc == 2 {
            log_end = Some(log_end.map_or(t, |e| e.max(e)));
        }
    }

    if let (Some(s), Some(e)) = (log_start, log_end) {
        if e >= s {
            return Some((e - s) as f64 / 1000.0);
        }
    }
    if let (Some(s), Some(e)) = (first_evt, last_evt) {
        if e >= s {
            return Some((e - s) as f64 / 1000.0);
        }
    }
    None
}

/// Scans the agent table for an NPC with the given species ID and returns
/// its memory address. Then walks the event list for a MaxHealthUpdate
/// (statechange 12) event from that agent and returns the max-HP value
/// stored in dst_agent. Returns None if the agent is not found or has no
/// MaxHealthUpdate event.
fn parse_boss_max_hp(
    data: &[u8],
    agents_base: usize,
    agent_count: usize,
    revision: u8,
    species_id: u32,
) -> Option<u64> {
    const AGENT_SZ: usize = 96;

    // Collect all agent addresses matching this species ID
    let mut boss_addrs = Vec::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if base + AGENT_SZ > data.len() {
            break;
        }
        let prof = ru32(data, base + 8).unwrap_or(0);
        if prof == species_id {
            if let Ok(addr) = ru64(data, base) {
                boss_addrs.push(addr);
            }
        }
    }
    if boss_addrs.is_empty() {
        return None;
    }

    // Navigate to the events section
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(data, skills_base).ok()? as usize;
    let skill_sz: usize = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base + 64 > data.len() {
        return None;
    }

    let event_sz = 64usize;
    let event_count = (data.len() - events_base) / event_sz;
    let sc_offset = if revision == 0 { 54usize } else { 56 };

    // Find the highest MaxHealthUpdate (statechange 12) among any of the boss agents
    let mut max_hp = 0u64;
    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        if data[base + sc_offset] == 12 {
            // MaxHealthUpdate
            let src_agent = ru64(data, base + 8).unwrap_or(0);
            if boss_addrs.contains(&src_agent) {
                let hp = ru64(data, base + 16).unwrap_or(0);
                if hp > max_hp {
                    max_hp = hp;
                }
            }
        }
    }

    if max_hp > 0 {
        Some(max_hp)
    } else {
        None
    }
}

/// Mount Balrior convergences (EVTC header ids 1562 / 1571) flag Challenge Mode
/// via the `UnstableAttunementJW` buff (skill id 74860) being applied to a
/// player. This mirrors Elite Insights' `MountBalriorConvergenceInstance.GetLogMode`,
/// which returns `Mode.CM` whenever that buff is present on any player. arcDPS
/// emits it as a *buff* event (is_buff == 1) keyed on the skill-id field, NOT as
/// a statechange-17 BuffApply and NOT via the generic statechange-35 scan.
fn detect_mount_balrior_cm(
    data: &[u8],
    agents_base: usize,
    agent_count: usize,
    revision: u8,
) -> Option<bool> {
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base + 64 > data.len() {
        return None;
    }
    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let sc_off = if revision == 0 { 54 } else { 56 };
    let is_buff_off = sc_off - 7; // empirical: isBuff byte sits 7 before statechange
    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        if ru32(&data, base + 36).unwrap_or(0) == 74860 && data[base + is_buff_off] == 1 {
            return Some(true);
        }
    }
    Some(false)
}

/// Outer Nayos convergences (EVTC header ids 1523 / 1527) flag Challenge Mode
/// via the `UnstableAttunementSotO` buff (skill id 72730) being applied to a
/// player. This mirrors Elite Insights' `OuterNayosConvergenceInstance.GetLogMode`,
/// which returns `Mode.CM` whenever that buff is present on any player. Same
/// arcDPS encoding as Mount Balrior's 74860 — a *buff* event (is_buff == 1)
/// keyed on the skill-id field.
fn detect_outer_nayos_cm(
    data: &[u8],
    agents_base: usize,
    agent_count: usize,
    revision: u8,
) -> Option<bool> {
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base + 64 > data.len() {
        return None;
    }
    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let sc_off = if revision == 0 { 54 } else { 56 };
    let is_buff_off = sc_off - 7; // empirical: isBuff byte sits 7 before statechange
    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        if ru32(&data, base + 36).unwrap_or(0) == 72730 && data[base + is_buff_off] == 1 {
            return Some(true);
        }
    }
    Some(false)
}

/// Quick Play raids/strikes are flagged in Elite Insights by the presence of
/// the instance buffs `QuickplayBoost` (skill id `77676`) or `QuickplayMorale`
/// (skill id `79492`) on any player for the entire fight. This mirrors
/// `GW2EIEvtcParser/LogLogic/LogLogic.cs`:
///
///     // Quickplay
///     if (log.PlayerList.Any(x => x.HasBuff(log, SkillIDs.QuickplayBoost, ...)))
///         instanceBuffs.Add(new(log.Buffs.BuffsByIDs[SkillIDs.QuickplayBoost], 1, mainPhase));
///     else if (log.PlayerList.Any(x => x.HasBuff(log, SkillIDs.QuickplayMorale, ...)))
///         instanceBuffs.Add(new(log.Buffs.BuffsByIDs[SkillIDs.QuickplayMorale], 1, mainPhase));
///
/// arcDPS emits these as normal buff events (`is_buff == 1`) keyed on the
/// skill-id field, so we scan raw events the same way as the convergence CM
/// buff detectors below.
pub fn parse_is_quick_play(bytes: &[u8]) -> Option<bool> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let revision = data[12];
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;
    if events_base + 64 > data.len() {
        return None;
    }
    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let sc_off = if revision == 0 { 54 } else { 56 };
    let is_buff_off = sc_off - 7;

    // Build a set of player agent addresses so we only credit buffs applied
    // to actual players, not to pets / minions / NPCs.
    let mut player_addrs: std::collections::HashSet<u64> = std::collections::HashSet::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if base + AGENT_SZ > data.len() {
            break;
        }
        let addr = ru64(&data, base).ok()?;
        let prof = ru32(&data, base + 8).unwrap_or(0);
        let name_bytes = &data[base + 28..base + 92];
        let mut parts = Vec::new();
        let mut start = 0usize;
        for (idx, &b) in name_bytes.iter().enumerate() {
            if b == 0 {
                if idx > start {
                    parts.push(String::from_utf8_lossy(&name_bytes[start..idx]).into_owned());
                }
                start = idx + 1;
            }
        }
        if start < name_bytes.len() {
            let tail: Vec<u8> = name_bytes[start..]
                .iter()
                .take_while(|&&b| b != 0)
                .cloned()
                .collect();
            if !tail.is_empty() {
                parts.push(String::from_utf8_lossy(&tail).into_owned());
            }
        }
        // Players have a non-zero profession and a non-empty char name.
        if prof != 0 && parts.first().map(|s| !s.is_empty()).unwrap_or(false) {
            player_addrs.insert(addr);
        }
    }

    let quickplay_buffs = [77676u32, 79492];
    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        if data[base + is_buff_off] != 1 {
            continue;
        }
        let dst_agent = ru64(&data, base + 16).unwrap_or(0);
        if !player_addrs.contains(&dst_agent) {
            continue;
        }
        let skill_id = ru32(&data, base + 36).unwrap_or(0);
        if quickplay_buffs.contains(&skill_id) {
            return Some(true);
        }
    }
    Some(false)
}

/// Parse the CM flag from an EVTC header (statechange 35/36).
pub fn parse_is_cm(bytes: &[u8]) -> Option<bool> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let header_boss_id = u16::from_le_bytes([data[13], data[14]]);
    let boss_id = header_boss_id;
    let revision = data[12];
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;

    // Mount Balrior convergences (header ids 1562 / 1571) flag CM via the
    // `UnstableAttunementJW` buff (74860) on a player — see `detect_mount_balrior_cm`.
    if header_boss_id == 1562 || header_boss_id == 1571 {
        return detect_mount_balrior_cm(&data, agents_base, agent_count, revision);
    }

    // Outer Nayos convergences (header ids 1523 / 1527) flag CM via the
    // `UnstableAttunementSotO` buff (72730) on a player — see `detect_outer_nayos_cm`.
    if header_boss_id == 1523 || header_boss_id == 1527 {
        return detect_outer_nayos_cm(&data, agents_base, agent_count, revision);
    }

    // ── Special cases: CM detected without health or statechange events ─────────

    // Decima the Stormsinger (MbW): CM and Normal are recorded as two completely
    // different species IDs. If the boss_id is the CM variant, it is always CM.
    if boss_id == 26867 {
        // DecimaCM
        return Some(true);
    }

    // Greer the Blightbringer (MbW): CM is indicated by the presence of the
    // add "Ereg" (species 26859) in the agent table. Normal runs have no Ereg.
    if boss_id == 26725 {
        // Greer
        const AGENT_SZ: usize = 96;
        let ereg_present = (0..agent_count).any(|i| {
            let base = agents_base + i * AGENT_SZ;
            if base + AGENT_SZ > data.len() {
                return false;
            }
            ru32(&data, base + 8).unwrap_or(0) == 26859 // Ereg species ID
        });
        return Some(ereg_present);
    }

    // Cairn the Indomitable (W4): CM is determined by the application of
    // Countdown (buff 38098) or Petrified (buff 38235).
    if boss_id == 17194 {
        const AGENT_SZ: usize = 96;
        let skills_base = agents_base + agent_count * AGENT_SZ;
        let skill_count = ru32(&data, skills_base).unwrap_or(0) as usize;
        let skill_sz = if revision == 0 { 64 } else { 68 };
        let events_base = skills_base + 4 + skill_count * skill_sz;
        let event_sz = 64usize;
        let event_count = (data.len().saturating_sub(events_base)) / event_sz;
        let mut is_cm = false;
        for i in 0..event_count {
            let base = events_base + i * event_sz;
            if base + 40 > data.len() {
                break;
            }
            let skillid = ru32(&data, base + 36).unwrap_or(0);
            if skillid == 38098 || skillid == 38235 {
                is_cm = true;
                break;
            }
        }
        return Some(is_cm);
    }

    // ── Health-based CM detection ─────────────────────────────────────────────
    // Bosses that do not emit statechange 35 but have a larger HP pool in CM.
    // Thresholds mirror Elite Insights' GetLogMode implementations exactly.
    //
    // W4  — Bastion of the Penitent
    // W5  — Hall of Chains
    // W6  — Mythwright Gambit
    // W7  — The Key of Ahdashim
    // W8  — Guardian's Glade (Kela)
    // SotO — Secrets of the Obscure (Temple of Febe)
    // MbW  — Mount Balrior (Ura)
    let cm_threshold: Option<u64> = match boss_id {
        17154 => Some(40_000_000), // Deimos              (W4)
        17172 => Some(25_000_000), // Mursaat Overseer    (W4)
        17188 => Some(30_000_000), // Samarog             (W4)
        19450 => Some(35_000_000), // Dhuum               (W5)
        20934 => Some(21_000_000), // Qadim               (W5)
        43974 => Some(0),          // Conjured Amalgamate (W6)
        21105 => Some(18_000_000), // Nikare / Twin Largos (W6)
        21089 => Some(16_000_000), // Kenut  / Twin Largos (W6)
        22006 => Some(23_000_000), // Adina               (W7)
        21964 => Some(32_000_000), // Sabir               (W7)
        22000 => Some(48_000_000), // Qadim the Peerless  (W7)
        26774 => Some(60_000_000), // Decima / Stormsinger (W8) — checks health because ArcDPS emits statechange 35 for both modes
        27124 => Some(55_000_000), // Kela Seneschal of Waves (W8)
        25989 => Some(80_000_000), // Cerus / Temple of Febe (SotO)
        26712 => Some(70_000_000), // Ura the Steamshrieker  (MbW)
        _ => None,
    };

    if let Some(threshold) = cm_threshold {
        let max_hp = parse_boss_max_hp(&data, agents_base, agent_count, revision, boss_id as u32)
            .unwrap_or(0);
        return Some(max_hp > threshold);
    }

    // Generic fallback: look for statechange 35 (CBTEVT_CHALLENGEMODE)
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;

    if events_base >= data.len() {
        return Some(false);
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let statechange_offset = if revision == 0 { 54 } else { 56 };

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }
        if data[base + statechange_offset] == 35 {
            // CBTEVT_CHALLENGEMODE
            let val = ru32(&data, base + 24).unwrap_or(0);
            return Some(val == 1 || val == 1065353216);
        }
    }
    Some(false)
}

/// Detects Legendary Challenge Mode locally from the EVTC binary.
///
/// For bosses that expose LCM via a distinct health pool (Cerus, Ura) the
/// threshold is checked directly. For all other bosses we fall back to
/// statechange 36 (CBTEVT_LEGENDARYCHALLENGEMODE).
pub fn parse_is_lcm(bytes: &[u8]) -> Option<bool> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let header_boss_id = u16::from_le_bytes([data[13], data[14]]);
    let boss_id = header_boss_id;
    let revision = data[12];
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;

    // Convergences (Mount Balrior 1562/1571 and Outer Nayos 1523/1527) have no
    // Legendary Challenge Mode in EI — LCM is only a raid/strike concept. Always
    // report false so the uploader never marks a convergence as LCM.
    if header_boss_id == 1562
        || header_boss_id == 1571
        || header_boss_id == 1523
        || header_boss_id == 1527
    {
        return Some(false);
    }

    // Only Cerus (SotO) and Ura (MbW) have health-based LCM detection.
    let lcm_threshold: Option<u64> = match boss_id {
        25989 => Some(115_000_000), // Cerus / Temple of Febe (SotO)
        26712 => Some(90_000_000),  // Ura the Steamshrieker  (MbW)
        _ => None,
    };

    if let Some(threshold) = lcm_threshold {
        let max_hp = parse_boss_max_hp(&data, agents_base, agent_count, revision, boss_id as u32)
            .unwrap_or(0);
        return Some(max_hp > threshold);
    }

    // Generic fallback: look for statechange 36 (CBTEVT_LEGENDARYCHALLENGEMODE)
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let events_base = skills_base + 4 + skill_count * skill_sz;

    if events_base + 64 > data.len() {
        return Some(false);
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let statechange_offset = if revision == 0 { 54 } else { 56 };

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 >= data.len() {
            break;
        }
        if data[base + statechange_offset] == 36 {
            // CBTEVT_LEGENDARYCHALLENGEMODE
            let val = ru32(&data, base + 24).unwrap_or(0);
            return Some(val == 1 || val == 1065353216);
        }
    }
    Some(false)
}

/// One Revealed-source event parsed from a raw buff-apply record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevealedSourceEvent {
    pub time: u64,
    pub dst_character: String,
    pub dst_account: String,
    pub dst_profession: u32,
    pub skill_id: u32,
    pub buff_id: u32,
    pub src_character: String,
    pub src_account: String,
    pub src_profession: u32,
}

/// EI-style Revealed source attribution from local EVTC.
///
/// Buff id `890` corresponds to the Revealed condition. arcDPS emits it as a
/// normal buff event with `buff=1` and `is_buffremove=0` on apply. The
/// `CreditedBy` semantic is exposed here via the event's `src_agent`:
/// - non-zero `src_agent` → the source agent's character/account name from
///   the agent table;
/// - zero `src_agent` with `skill_id!=0` → environment/self-application,
///   shown as the skill id;
/// - otherwise `Unknown`.
///
/// Returns `None` for non-EVTC inputs or logs too short to contain events.
pub fn parse_revealed_sources(bytes: &[u8]) -> Option<Vec<RevealedSourceEvent>> {
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };
    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let revision = data[12];
    let header_end: usize = if revision == 0 { 15 } else { 16 };
    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;
    const AGENT_SZ: usize = 96;
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let skills_end = skills_base + 4 + skill_count * skill_sz;
    let events_base = skills_end;

    if events_base + 64 > data.len() {
        return Some(Vec::new());
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;
    let _statechange_offset = if revision == 0 { 54 } else { 56 };

    let mut agents: std::collections::HashMap<u64, (String, String, u32)> =
        std::collections::HashMap::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let Ok(addr) = ru64(&data, base) {
            let prof = ru32(&data, base + 8).unwrap_or(0);
            let name_bytes = &data[base + 28..base + 92];
            let mut parts = Vec::new();
            let mut start = 0usize;
            for (idx, &b) in name_bytes.iter().enumerate() {
                if b == 0 {
                    if idx > start {
                        parts.push(String::from_utf8_lossy(&name_bytes[start..idx]).into_owned());
                    }
                    start = idx + 1;
                }
            }
            if start < name_bytes.len() {
                let tail: Vec<u8> = name_bytes[start..]
                    .iter()
                    .take_while(|&&b| b != 0)
                    .cloned()
                    .collect();
                if !tail.is_empty() {
                    parts.push(String::from_utf8_lossy(&tail).into_owned());
                }
            }
            let char_name = parts.first().cloned().unwrap_or_default();
            let account = parts.get(1).cloned().unwrap_or_default();
            agents.insert(addr, (char_name, account, prof));
        }
    }

    let mut out = Vec::new();
    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 >= data.len() {
            break;
        }
        let dst_agent = ru64(&data, base + 16).unwrap_or(0);
        let src_agent = ru64(&data, base + 8).unwrap_or(0);
        if dst_agent == 0 {
            continue;
        }
        let dst = agents.get(&dst_agent).cloned().unwrap_or_default();
        let source = if src_agent != 0 {
            agents.get(&src_agent).cloned().unwrap_or_default()
        } else {
            ("Unknown".to_string(), String::new(), 0)
        };
        out.push(RevealedSourceEvent {
            time: ru64(&data, base).unwrap_or(0),
            dst_character: dst.0,
            dst_account: dst.1,
            dst_profession: dst.2,
            skill_id: ru32(&data, base + 36).unwrap_or(0),
            buff_id: ru32(&data, base + 24).unwrap_or(0),
            src_character: source.0,
            src_account: source.1,
            src_profession: source.2,
        });
    }

    let start_time = out.first().map(|e| e.time).unwrap_or(0);
    let raw: Vec<_> = out
        .into_iter()
        .map(|mut e| {
            e.time = e.time.saturating_sub(start_time);
            e
        })
        .collect();

    // Prefer BuffApply events for the Revealed buff (buff_id / skill_id 890):
    // dps.report and EI both attribute reveals to the buff caster, not to
    // whatever transient agent happened to be the StealthChange trigger.
    // Fall back to unfiltered events only when no Revealed rows are present.
    let is_revealed_buff = |ev: &RevealedSourceEvent| ev.buff_id == 890 || ev.skill_id == 890;
    let mut filtered: Vec<RevealedSourceEvent> =
        raw.iter().cloned().filter(is_revealed_buff).collect();
    if filtered.is_empty() {
        filtered = raw
            .iter()
            .cloned()
            .filter(|ev| ev.buff_id == 0 && ev.skill_id == 0)
            .collect::<Vec<_>>();
    }
    // `filtered` already carries relative times from `raw`; no second subtraction.
    filtered.sort_by_key(|e| e.time);
    Some(filtered)
}

/// Extracts the number of Empowered stacks (buff ID 69550) on Cerus at the moment he reaches 50% HP.
pub fn parse_cerus_empowered_stacks(bytes: &[u8]) -> Option<u32> {
    // 1. Unzip if needed
    let data: Vec<u8> = if bytes.starts_with(b"PK\x03\x04") {
        extract_zip(bytes).ok()?
    } else {
        bytes.to_vec()
    };

    if data.len() < 20 || !data.starts_with(b"EVTC") {
        return None;
    }

    let revision = data[12];
    let mut boss_id = u16::from_le_bytes([data[13], data[14]]);
    let header_boss_id = boss_id;
    let _is_convergence = header_boss_id == 1523
        || header_boss_id == 1527
        || header_boss_id == 1562
        || header_boss_id == 1571;
    let header_end: usize = if revision == 0 { 15 } else { 16 };

    let agent_count = ru32(&data, header_end).ok()? as usize;
    let agents_base = header_end + 4;

    const AGENT_SZ: usize = 96;
    if agents_base + agent_count * AGENT_SZ > data.len() {
        return None;
    }

    // Resolve boss_id
    if boss_id == 1523 || boss_id == 1527 || boss_id == 1562 || boss_id == 1571 {
        for i in 0..agent_count {
            let base = agents_base + i * AGENT_SZ;
            if let Ok(prof) = ru32(&data, base + 8) {
                if BOSS_IDS.contains(&(prof as u16)) {
                    boss_id = prof as u16;
                    break;
                }
            }
        }
    }

    // We only care about Cerus (Species ID: 25989)
    if boss_id != 25989 {
        return None;
    }

    // Find the boss agent address(es)
    let mut boss_addrs = std::collections::HashSet::new();
    for i in 0..agent_count {
        let base = agents_base + i * AGENT_SZ;
        if let Ok(addr) = ru64(&data, base) {
            if let Ok(prof) = ru32(&data, base + 8) {
                if prof == 25989 {
                    boss_addrs.insert(addr);
                }
            }
        }
    }

    // Navigate to the events section
    let skills_base = agents_base + agent_count * AGENT_SZ;
    let skill_count = ru32(&data, skills_base).ok()? as usize;
    let skill_sz = if revision == 0 { 64 } else { 68 };
    let skills_end = skills_base + 4 + skill_count * skill_sz;
    let events_base = skills_end;

    if events_base >= data.len() {
        return None;
    }

    let event_sz = 64;
    let event_count = (data.len() - events_base) / event_sz;

    let mut boss_instids: std::collections::HashSet<u16> = std::collections::HashSet::new();
    let statechange_offset = if revision == 0 { 54 } else { 56 };

    // First, scan instids
    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }

        let src_agent = ru64(&data, base + 8).unwrap_or(0);
        let dst_agent = ru64(&data, base + 16).unwrap_or(0);
        let src_instid = ru16(&data, base + 40).unwrap_or(0);
        let dst_instid = ru16(&data, base + 42).unwrap_or(0);
        let is_statechange = data[base + statechange_offset];

        for &addr in &boss_addrs {
            let src_match = src_agent != 0 && (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
            if src_match && src_instid != 0 {
                boss_instids.insert(src_instid);
            }

            if is_statechange != 8 {
                let dst_match = dst_agent != 0 && (dst_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                if dst_match && dst_instid != 0 {
                    boss_instids.insert(dst_instid);
                }
            }
        }
    }

    // Track HP and buff transitions
    let mut fifty_percent_time: Option<u64> = None;
    let mut buff_history: Vec<(u64, u32)> = Vec::new(); // (time, stacks)
    let mut current_stacks = 0u32;
    let mut highest_hp_seen = 0u64;

    for i in 0..event_count {
        let base = events_base + i * event_sz;
        if base + 60 > data.len() {
            break;
        }

        let time = ru64(&data, base).unwrap_or(0);
        let src_agent = ru64(&data, base + 8).unwrap_or(0);
        let dst_agent = ru64(&data, base + 16).unwrap_or(0);
        let src_instid = ru16(&data, base + 40).unwrap_or(0);
        let dst_instid = ru16(&data, base + 42).unwrap_or(0);
        let is_statechange = data[base + statechange_offset];

        // 1. Health update check (8 = CBTEVT_HEALTHUPDATE)
        if is_statechange == 8 {
            let mut final_matched_addr = None;
            for &addr in &boss_addrs {
                let matches_direct =
                    src_agent != 0 && (src_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                let matches_inst =
                    boss_instids.contains(&src_instid) || src_instid == (addr & 0xFFFF) as u16;
                if matches_direct || matches_inst {
                    final_matched_addr = Some(addr);
                    break;
                }
            }

            if final_matched_addr.is_some() {
                if dst_agent <= 10000 {
                    let hp_pct = dst_agent; // 0..10000
                    if hp_pct > highest_hp_seen {
                        highest_hp_seen = hp_pct;
                    }
                    if hp_pct <= 5000 && fifty_percent_time.is_none() && highest_hp_seen > 5000 {
                        fifty_percent_time = Some(time);
                    }
                }
            }
        }

        // 2. Buff events check
        let is_buff = data[base + 49] != 0;
        if is_buff {
            let skill_id = ru32(&data, base + 36).unwrap_or(0);
            let buff_id = ru32(&data, base + 24).unwrap_or(0);
            if skill_id == 69550 || buff_id == 69550 {
                // Check if destination is Cerus
                let mut dest_matches_cerus = false;
                for &addr in &boss_addrs {
                    let matches_direct =
                        dst_agent != 0 && (dst_agent & 0xFFFF_FFFF) == (addr & 0xFFFF_FFFF);
                    let matches_inst =
                        boss_instids.contains(&dst_instid) || dst_instid == (addr & 0xFFFF) as u16;
                    if matches_direct || matches_inst {
                        dest_matches_cerus = true;
                        break;
                    }
                }

                if dest_matches_cerus {
                    let is_buffremove = data[base + 52];
                    if is_buffremove == 0 {
                        current_stacks += 1;
                        buff_history.push((time, current_stacks));
                    } else if is_buffremove == 1 || is_buffremove == 3 {
                        current_stacks = current_stacks.saturating_sub(1);
                        buff_history.push((time, current_stacks));
                    } else if is_buffremove == 2 {
                        current_stacks = 0;
                        buff_history.push((time, current_stacks));
                    }
                }
            }
        }
    }

    // Petrified requires the group to have REACHED the 50% split phase. We only
    // trust a stack count when the boss was actually observed crossing <=50% HP
    // (`fifty_percent_time.is_some()`). If the pull ended ABOVE 50% (e.g. a 51%+
    // wipe), the group never reached the split, so no Petrified — return None so
    // the auto-award gate cannot fire. A `Some` count therefore proves a genuine
    // <=50% reach AND the Empowered stacks at that moment.
    if let Some(target_time) = fifty_percent_time {
        let mut stacks_at_50 = 0u32;
        for &(t, s) in &buff_history {
            if t <= target_time {
                stacks_at_50 = s;
            } else {
                break;
            }
        }
        return Some(stacks_at_50);
    }

    // Wiped/stalled ABOVE 50% HP (never reached the split) — not Petrified-eligible.
    None
}

#[cfg(test)]
mod harvest_dragon_tests {
    use super::*;
    use serde_json::json;

    /// A dps.report `getJson` for a Harvest Temple WIPE.
    fn wipe_json() -> serde_json::Value {
        json!({
            "phases": [
                {"name": "Full Fight", "failed": true},
                {"name": "Purification 1", "failed": true},
                {"name": "Breath of Jormag", "failed": false},
                {"name": "Flames of Primordus", "failed": false},
                {"name": "Kralkatorrik's ...", "failed": false},
                {"name": "Purification 2", "failed": true},
                {"name": "Zhaitan's Reach", "failed": true}
            ]
        })
    }

    /// A dps.report `getJson` for a Harvest Temple KILL.
    fn kill_json() -> serde_json::Value {
        json!({
            "phases": [
                {"name": "Full Fight", "failed": false},
                {"name": "Purification 1", "failed": false},
                {"name": "Lightning of Jormag", "failed": false},
                {"name": "Flames of Primordus", "failed": false},
                {"name": "Kralkatorrik's ...", "failed": false},
                {"name": "Purification 2", "failed": false},
                {"name": "Void Time Caster", "failed": false},
                {"name": "Zhaitan's Reach", "failed": false},
                {"name": "Soothing Stone", "failed": false},
                {"name": "Mordremoth", "failed": false}
            ]
        })
    }

    #[test]
    fn wipe_marks_dragons_reached_vs_unreached() {
        let dragons = dragon_phase_state(&wipe_json()).expect("should detect dragon phases");
        assert_eq!(dragons.len(), 6);
        let by_key: std::collections::HashMap<_, _> =
            dragons.iter().map(|d| (d.key.as_str(), d)).collect();
        // Cleared dragons: died=true, hp_left 0
        for k in ["jormag", "primordus", "kralkatorrik"] {
            let d = by_key[k];
            assert!(d.died, "{} should be defeated", k);
            assert_eq!(d.hp_left, 0.0);
        }
        // Wiped-on dragon: present, NOT died, full HP (no per-dragon HP in EVTC)
        let z = by_key["zhaitan"];
        assert!(!z.died);
        assert_eq!(z.hp_left, 100.0);
        // Never reached: Soo-Won + Mordremoth still in council, full HP, not died
        assert!(!by_key["soowon"].died);
        assert!(!by_key["mordremoth"].died);
    }

    /// Adds at/after the wipe point stay uncleared when no local add-evidence is
    /// provided, but `dragon_phase_full_with_adds` can upgrade them if the local
    /// `.zevtc` shows the add died.
    #[test]
    fn add_evidence_upgrades_uncleared_adds_on_wipe() {
        let json = json!( {
            "phases": [
                {"name": "Purification 1", "failed": false},
                {"name": "Jormag", "failed": false},
                {"name": "Mordremoth", "failed": true},
                {"name": "Giants", "failed": false},
                {"name": "Zhaitan", "failed": false},
                {"name": "Void Saltspray Dragon", "failed": false},
            ]
        } );
        // Conservative wipe contract: once a dragon is failed, all later
        // dragons/adds are uncleared unless local add-evidence says otherwise.
        // `failed=false` alone does not clear a dragon after a wipe point.
        let tl = dragon_phase_full_with_adds(&json, false, None).expect("should build timeline");
        let by_key: std::collections::HashMap<_, _> =
            tl.iter().map(|p| (p.key.as_str(), p.cleared)).collect();
        assert!(by_key["purification1"]);
        assert!(by_key["jormag"]);
        assert!(
            !by_key["mordremoth"],
            "mordremoth is the first failed dragon"
        );
        assert!(!by_key["giants"], "giants is after the first failed dragon");
        // Zhaitan's own phase says `failed=false`, meaning it was actually
        // defeated before the wipe. The conservative wipe contract preserves
        // that explicit result instead of blanket-unclearing everything after
        // Mordremoth.
        assert!(
            by_key["zhaitan"],
            "zhaitan was defeated before the wipe point"
        );
        assert!(!by_key["saltspray"]);
        let mut evidence = DragonvoidAddEvidence::default();
        evidence.died.insert("saltspray".to_string(), true);
        let tl = dragon_phase_full_with_adds(&json, false, Some(&evidence))
            .expect("should build timeline");
        let by_key: std::collections::HashMap<_, _> =
            tl.iter().map(|p| (p.key.as_str(), p.cleared)).collect();
        assert!(
            by_key["saltspray"],
            "saltspray should be cleared with death evidence"
        );
    }
    #[test]
    fn kill_defeats_all_six() {
        let dragons = dragon_phase_state(&kill_json()).expect("should detect dragon phases");
        assert_eq!(dragons.len(), 6);
        for d in &dragons {
            assert!(d.died, "{} should be defeated on a kill", d.key);
            assert_eq!(d.hp_left, 0.0);
        }
    }

    #[test]
    fn non_dragon_log_yields_none() {
        let json = json!({ "phases": [ {"name": "Full Fight", "failed": true} ] });
        assert!(dragon_phase_state(&json).is_none());
    }

    /// The full left→right timeline (dragons + interphases) for a successful
    /// Dragonvoid CM kill, using the exact dps.report `phases[]` schema captured
    /// live. Asserts ordering, element coverage, and cleared flags.
    #[test]
    fn full_timeline_kill_orders_interphases() {
        let json = json!({
            "phases": [
                {"name": "Full Fight", "failed": false},
                {"name": "Purification 1", "failed": false},
                {"name": "Heart 1 Breakbar 1", "failed": false},
                {"name": "Jormag", "failed": false},
                {"name": "Primordus", "failed": false},
                {"name": "Kralkatorrik", "failed": false},
                {"name": "Void Time Caster Breakbar 1", "failed": false},
                {"name": "Purification 2", "failed": false},
                {"name": "Void Time Caster", "failed": false},
                {"name": "Heart 2 Breakbar 1", "failed": false},
                {"name": "Mordremoth", "failed": false},
                {"name": "Giants", "failed": false},
                {"name": "Void Giant 3 Breakbar 1", "failed": false},
                {"name": "Void Giant 2 Breakbar 1", "failed": false},
                {"name": "Void Giant 1 Breakbar 1", "failed": false},
                {"name": "Zhaitan", "failed": false},
                {"name": "Purification 3", "failed": false},
                {"name": "Void Saltspray Dragon", "failed": false},
                {"name": "Void Saltspray Dragon Breakbar 1", "failed": false},
                {"name": "Heart 3 Breakbar 1", "failed": false},
                {"name": "Soo-Won", "failed": false},
                {"name": "Soo-Won 1", "failed": false},
                {"name": "Purification 4", "failed": false},
                {"name": "Void Obliterator", "failed": false},
                {"name": "Void Obliterator Breakbar 1", "failed": false},
                {"name": "Void Goliath", "failed": false},
                {"name": "Void Goliath Breakbar 1", "failed": false},
                {"name": "Soo-Won 2", "failed": false}
            ]
        });
        let tl =
            dragon_phase_full_with_adds(&json, true, None).expect("should build full timeline");
        let seq: Vec<&str> = tl.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(
            seq,
            vec![
                "purification1",
                "jormag",
                "primordus",
                "kralkatorrik",
                "purification2",
                "mordremoth",
                "giants",
                "zhaitan",
                "purification3",
                "saltspray",
                "soowon",
                "purification4",
                "obliterator",
                "goliath",
                "soowon2",
            ]
        );
        // Breakbar-only phases must not appear as separate chips.
        assert!(!seq.contains(&"giant1"));
        assert!(!seq.contains(&"heart1breakbar"));
        // Every element cleared on a kill.
        assert!(tl.iter().all(|p| p.cleared));
        // Icons resolve to the user-provided PNGs.
        let by_key: std::collections::HashMap<_, _> = tl
            .iter()
            .map(|p| (p.key.as_str(), p.icon.as_deref()))
            .collect();
        assert_eq!(by_key["purification1"], Some("purification"));
        assert_eq!(by_key["giants"], Some("giants"));
        assert_eq!(by_key["saltspray"], Some("voidsaltspraydragon"));
        assert_eq!(by_key["obliterator"], Some("voidobliterator"));
        assert_eq!(by_key["goliath"], Some("voidgoliath"));
        assert_eq!(by_key["jormag"], None);
        // Dragon display names must be properly cased, never the raw lowercase key.
        let name_by_key: std::collections::HashMap<_, _> = tl
            .iter()
            .map(|p| (p.key.as_str(), p.name.as_str()))
            .collect();
        assert_eq!(name_by_key["jormag"], "Jormag");
        assert_eq!(name_by_key["soowon"], "Soo-Won");
        assert_eq!(name_by_key["kralkatorrik"], "Kralkatorrik");
    }

    /// A wipe: dps.report truncates `phases[]` at the boss you died on, so
    /// every element except the LAST reached one was genuinely cleared. Asserts
    /// only the final element is uncleared and ordering is preserved.
    #[test]
    fn full_timeline_wipe_marks_last_uncleared() {
        // Wipe on Zhaitan: fight reached Giants (interphase before Zhaitan) and
        // Zhaitan, but died on Zhaitan. Giants was cleared; Zhaitan was not.
        let json = json!({
            "phases": [
                {"name": "Purification 1", "failed": false},
                {"name": "Jormag", "failed": false},
                {"name": "Primordus", "failed": false},
                {"name": "Kralkatorrik", "failed": false},
                {"name": "Purification 2", "failed": false},
                {"name": "Mordremoth", "failed": true},
                {"name": "Giants", "failed": false},
                {"name": "Zhaitan", "failed": true}
            ]
        });
        let tl = dragon_phase_full_with_adds(&json, false, None).expect("should build timeline");
        let by_key: std::collections::HashMap<_, _> =
            tl.iter().map(|p| (p.key.as_str(), p.cleared)).collect();
        // Only dragons before Mordremoth were genuinely cleared. Mordremoth is
        // the failed wipe point, and Giants/Zhaitan after it stay uncleared.
        for k in [
            "purification1",
            "jormag",
            "primordus",
            "kralkatorrik",
            "purification2",
        ] {
            assert!(by_key[k], "{} should be cleared", k);
        }
        assert!(
            !by_key["mordremoth"],
            "mordremoth should be uncleared (wipe point)"
        );
        assert!(!by_key["giants"], "giants is after the wipe point");
        assert!(!by_key["zhaitan"], "zhaitan is after the wipe point");
    }

    #[test]
    fn full_timeline_mordremoth_wipe_marks_only_mordremoth_uncleared() {
        let json = json!({
            "phases": [
                {"name": "Purification 1", "failed": false},
                {"name": "Jormag", "failed": false},
                {"name": "Primordus", "failed": false},
                {"name": "Kralkatorrik", "failed": false},
                {"name": "Purification 2", "failed": false},
                {"name": "Mordremoth", "failed": true},
            ]
        });
        let tl = dragon_phase_full_with_adds(&json, false, None).expect("should build timeline");
        let by_key: std::collections::HashMap<_, _> =
            tl.iter().map(|p| (p.key.as_str(), p.cleared)).collect();

        // When Time Caster is absent from the timeline, the conservative wipe
        // contract still guarantees Purification 2 cleared and Mordremoth Uncleared.
        for k in [
            "purification1",
            "jormag",
            "primordus",
            "kralkatorrik",
            "purification2",
        ] {
            assert!(by_key[k], "{} should be cleared", k);
        }
        assert!(
            !by_key["mordremoth"],
            "mordremoth should be uncleared (wipe point)"
        );
    }

    #[test]
    fn cerus_multistage_wipe_scores_nonzero_hp() {
        // Regression: a multi-phase boss (Cerus / Temple of Febe) "dies" on each
        // sub-phase and respawns at full HP. The local parser must NOT score that
        // mid-fight death as a kill (HP 0%). It should report the boss alive at
        // the end (HP > 0) on a wipe. We verify against the real Cerus logs from
        // 2026-08-14 — every one of them was scored FAILED by dps.report, so the
        // local parser must NOT return 0.0% for any of them.
        // The real Cerus logs live on the ArcDPS capture drive. Try the common
        // native Windows mount points for the D: drive (git-bash mounts it as
        // /d, but the Rust test binary sees native paths, so prefer D:/).
        let candidates = [
            "D:/ArcLogs/arcdps.cbtlogs/Cerus (25989)",
            "/d/ArcLogs/arcdps.cbtlogs/Cerus (25989)",
            "C:/ArcLogs/arcdps.cbtlogs/Cerus (25989)",
        ];
        let dir = candidates
            .iter()
            .map(std::path::Path::new)
            .find(|p| p.exists());
        let dir = match dir {
            Some(d) => d,
            None => {
                eprintln!(
                    "skipping: real Cerus logs not present (tried {:?})",
                    candidates
                );
                return;
            }
        };
        let mut checked = 0;
        for entry in std::fs::read_dir(dir).expect("read Cerus dir") {
            let path = entry.expect("entry").path();
            if path.extension().and_then(|e| e.to_str()) != Some("zevtc") {
                continue;
            }
            eprintln!("READING {}", path.file_name().unwrap().to_string_lossy());
            let bytes = std::fs::read(&path).expect("read log");
            eprintln!("READ {} bytes", bytes.len());
            let hp = parse_boss_hp(&bytes);
            eprintln!(
                "{} hp={:?}",
                path.file_name().unwrap().to_string_lossy(),
                hp
            );
            // A failed Cerus log must never be scored 0.0% (kill) locally.
            if let Some(h) = hp {
                assert!(
                    h > 0.0,
                    "{} was falsely scored as a kill (0% HP)",
                    path.display()
                );
            }
            checked += 1;
        }
        assert!(checked > 0, "expected to find real Cerus logs to verify");
    }

    #[test]
    fn parse_revealed_sources_uses_revealed_buff() {
        let data = std::fs::read("testlog.zevtc").expect("local zevtc fixture");
        let events = parse_revealed_sources(&data).expect("should parse events");
        assert!(!events.is_empty(), "expected local fallback events");
        let buff_revealed: Vec<_> = events
            .iter()
            .filter(|ev| ev.buff_id == 890 || ev.skill_id == 890)
            .collect();
        assert!(
            !buff_revealed.is_empty(),
            "expected Revealed buff events, got {} raw events",
            events.len()
        );
        let first = buff_revealed[0];
        assert!(
            first.time < 10_000_000,
            "expected relative times, got absolute ms={}",
            first.time
        );
    }
}
