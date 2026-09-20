// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct VlRankDef {
    pub id: &'static str,
    pub label: &'static str,
    /// Emoji glyph shown on the badge/modal card.
    pub icon: &'static str,
    /// Discord-role-accurate badge colors (text + background).
    pub text_color: &'static str,
    pub bg_color: &'static str,
    pub description: &'static str,
    /// Auto-award trigger: None = only via the context menu; "cm" = success + is_cm;
    /// "lcm" = success + is_lcm.
    pub auto: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VlEncounter {
    pub key: &'static str,
    pub display: &'static str,
    pub ranks: &'static [VlRankDef],
    /// Alternate normalized boss-name keys this encounter is also known by
    /// (e.g. dps.report reports Temple of Febe as "Cerus").
    pub aliases: &'static [&'static str],
}

/// Canonical encounters (normalized boss-name keys, lowercased + non-alphanumeric
/// stripped — must match how `is_cm`/`is_lcm` eligibility is computed).
pub fn catalog() -> &'static [VlEncounter] {
    &[
        VlEncounter {
            key: "templeoffebe",
            display: "Temple of Febe — Cerus",
            aliases: &["cerus"], // dps.report reports this strike as the boss name "Cerus"
            ranks: &[
                VlRankDef {
                    id: "petrified",
                    label: "Petrified",
                    icon: "\u{1fab5}", // 🪵
                    text_color: "#d68548",
                    bg_color: "#553e33",
                    description: "Players that have reached the 50% split phase (boss HP dropped to 50% or below) alive, with no more than 10 stacks of Empowered on Cerus. A pull that ends above 50% HP does NOT earn this rank, even in CM.",
                    auto: None,
                },
                VlRankDef {
                    id: "insatiable",
                    label: "Insatiable",
                    icon: "\u{1f7e1}", // 🟡 yellow circle
                    text_color: "#e9754b",
                    bg_color: "#4b3330",
                    description: "Players that have successfully reached the overlapping Rage and Gluttony mechanic in Phase 3 (100 seconds into the phase), with no more than 10 stacks of Empowered on Cerus.",
                    auto: None,
                },
                VlRankDef {
                    id: "empowered",
                    label: "Empowered",
                    icon: "\u{1f4aa}", // 💪
                    text_color: "#9e4b52",
                    bg_color: "#362a30",
                    description: "Players that have successfully reached the first green below 10% alive, with no more than 10 stacks of Empowered on Cerus at the 10% breakbar. Players must also not have failed any core mechanics for their strategy between 10% and the first green.",
                    auto: None,
                },
                VlRankDef {
                    id: "conqueror",
                    label: "Conqueror of Cerus",
                    icon: "\u{1f608}", // 😈 red demon
                    text_color: "#be380d",
                    bg_color: "#3a2725",
                    description: "Players that have successfully completed the Challenge Mode whilst being alive past the first green in the 10% phase.",
                    auto: Some("cm"),
                },
                VlRankDef {
                    id: "legendary",
                    label: "Legendary Conqueror of Cerus",
                    icon: "\u{1f47f}", // 👿 imp (purple demon stand-in)
                    text_color: "#c084fc",
                    bg_color: "#322344",
                    description: "Players that have successfully completed the Legendary Challenge Mode whilst being alive below 10%.",
                    auto: Some("lcm"),
                },
            ],
        },
        // Dragonvoid (Harvest Temple) and Mount Balrior (Greer/Decima/Ura) ranks
        // added here once their lists are provided — purely data, no code change.
    ]
}

/// Returns the index of the encounter in the catalog for a (pre-normalized) boss
/// name, if any. Returns an index (not a borrow) so callers don't hold a reference
/// into the freshly-built catalog Vec.
pub fn encounter_index(boss_key: &str) -> Option<usize> {
    catalog()
        .iter()
        .position(|e| e.key == boss_key || e.aliases.contains(&boss_key))
}

/// True if the encounter has VL ranks AND the log is a CM or LCM kill (ranks only
/// apply to challenge-mode runs).
#[allow(dead_code)] // reserved for UI gating of the VL Rank control on non-CM logs
pub fn vl_available(boss_key: &str, is_cm: Option<bool>, is_lcm: Option<bool>) -> bool {
    if encounter_index(boss_key).is_none() {
        return false;
    }
    is_cm == Some(true) || is_lcm == Some(true)
}

/// Auto-awarded rank id for a successful CM/LCM kill, if the encounter defines one.
/// LCM is a superset of CM (an LCM kill also reports is_cm == Some(true)), so we
/// must match the rank against the *highest* attained mode — otherwise a Legendary
/// CM kill would wrongly award the plain CM rank. Returns an owned String (the
/// catalog is built on the fly, so no borrow is held).
pub fn auto_rank_for(
    boss_key: &str,
    is_cm: Option<bool>,
    is_lcm: Option<bool>,
    success: Option<bool>,
) -> Option<String> {
    if success != Some(true) {
        return None;
    }
    let cat = catalog();
    let enc = cat.get(encounter_index(boss_key)?)?;
    // Honor the strictest mode first: a Legendary CM kill must win over a plain CM kill.
    if is_lcm == Some(true) {
        if let Some(rank) = enc.ranks.iter().find(|r| r.auto == Some("lcm")) {
            return Some(rank.id.to_string());
        }
    }
    if is_cm == Some(true) {
        if let Some(rank) = enc.ranks.iter().find(|r| r.auto == Some("cm")) {
            return Some(rank.id.to_string());
        }
    }
    None
}

/// Auto-eligibility for the **Petrified** mechanic rank.
///
/// Unlike Conqueror/Legendary (which require a successful CM/LCM *kill*), Petrified
/// is a mechanic rank: it's earned by reaching the 50% split phase alive with no
/// more than 10 Empowered stacks on Cerus. "Reached the split alive" is proven by
/// `cerus_empowered_stacks` being `Some(_)` (the parser only records a stack count
/// when it observes the boss cross 50%), so a `Some` count + the threshold check is
/// exactly the rank's definition. Notably this fires on **both kills and wipes** —
/// there is no `success` requirement here.
///
/// Gated to **CM only** (LCM intentionally excluded), matching how the VL rank UI
/// surfaces ranks.
pub fn auto_petrified_for(
    boss_key: &str,
    is_cm: Option<bool>,
    is_lcm: Option<bool>,
    stacks: Option<u32>,
) -> bool {
    if encounter_index(boss_key).is_none() {
        return false;
    }
    // CM-only. LCM Cerus logs are intentionally excluded: CM is the entry point to
    // the fight, LCM is a separate run for the kill. NOTE: an LCM kill also reports
    // `is_cm == Some(true)` (LCM is a superset of CM), so we must explicitly reject
    // `is_lcm == Some(true)` rather than just checking `is_cm`.
    if is_cm != Some(true) || is_lcm == Some(true) {
        return false;
    }
    match stacks {
        Some(n) => n <= 10,
        None => false,
    }
}

/// Validates a rank id belongs to the given encounter.
pub fn rank_is_valid(boss_key: &str, rank_id: &str) -> bool {
    match encounter_index(boss_key) {
        Some(i) => catalog()
            .get(i)
            .is_some_and(|e| e.ranks.iter().any(|r| r.id == rank_id)),
        None => false,
    }
}
