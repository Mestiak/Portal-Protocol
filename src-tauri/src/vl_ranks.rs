// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct VlRankDef {
    pub id: &'static str,
    pub label: &'static str,
    /// Path to the rank icon PNG shown on the badge/modal card.
    /// Cerus ranks use `/rank_icons/ToF_CM_LCM/<name>.png`;
    /// Harvest Temple ranks use `/rank_icons/HT_CM/<name>.png`.
    pub icon: &'static str,
    /// Discord-role-accurate badge colors (text + background).
    pub text_color: &'static str,
    pub bg_color: &'static str,
    pub description: &'static str,
    /// Optional hyperlink rendered below the description in the modal (e.g. further
    /// guidelines for a rank).
    pub url: Option<&'static str>,
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
    /// When true, this encounter's VL ranks only apply to CM kills — not LCM, not
    /// normal mode, and not convergences. Used for Ura where the CM rank set is
    /// distinct from the LCM rank set.
    pub cm_only: bool,
    /// When true, this encounter's VL ranks only apply to LCM kills — not CM, not
    /// normal mode, and not convergences.
    pub lcm_only: bool,
}

/// Canonical encounters (normalized boss-name keys, lowercased + non-alphanumeric
/// stripped — must match how `is_cm`/`is_lcm` eligibility is computed).
pub fn catalog() -> &'static [VlEncounter] {
    &[
        VlEncounter {
            key: "templeoffebe",
            display: "Temple of Febe — Cerus",
            aliases: &["cerus"], // dps.report reports this strike as the boss name "Cerus"
            cm_only: false,
            lcm_only: false,
            ranks: &[
                VlRankDef {
                    id: "petrified",
                    label: "Petrified",
                    icon: "/rank_icons/ToF_CM_LCM/petrified.png",
                    text_color: "#d68548",
                    bg_color: "#553e33",
                    description: "Players that have reached the 50% split phase (boss HP dropped to 50% or below) alive, with no more than 10 stacks of Empowered on Cerus. A pull that ends above 50% HP does NOT earn this rank, even in CM.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "insatiable",
                    label: "Insatiable",
                    icon: "/rank_icons/ToF_CM_LCM/insatiable.png",
                    text_color: "#e9754b",
                    bg_color: "#4b3330",
                    description: "Players that have successfully reached the overlapping Rage and Gluttony mechanic in Phase 3 (100 seconds into the phase), with no more than 10 stacks of Empowered on Cerus.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "empowered",
                    label: "Empowered",
                    icon: "/rank_icons/ToF_CM_LCM/empowered.png",
                    text_color: "#9e4b52",
                    bg_color: "#362a30",
                    description: "Players that have successfully reached the first green below 10% alive, with no more than 10 stacks of Empowered on Cerus at the 10% breakbar. Players must also not have failed any core mechanics for their strategy between 10% and the first green.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "conqueror",
                    label: "Conqueror of Cerus",
                    icon: "/rank_icons/ToF_CM_LCM/conquerorofcerus.png",
                    text_color: "#be380d",
                    bg_color: "#3a2725",
                    description: "Players that have successfully completed the Challenge Mode whilst being alive past the first green in the 10% phase.",
                    url: None,
                    auto: Some("cm"),
                },
                VlRankDef {
                    id: "legendary",
                    label: "Legendary Conqueror of Cerus",
                    icon: "/rank_icons/ToF_CM_LCM/legendaryconquerorofcerus.png",
                    text_color: "#c084fc",
                    bg_color: "#322344",
                    description: "Players that have successfully completed the Legendary Challenge Mode whilst being alive below 10%.",
                    url: None,
                    auto: Some("lcm"),
                },
            ],
        },
        VlEncounter {
            key: "dragonvoid",
            display: "The Dragonvoid — Harvest Temple",
            aliases: &[],
            cm_only: false,
            lcm_only: false,
            ranks: &[
                VlRankDef {
                    id: "adventurer",
                    label: "Adventurer",
                    icon: "/rank_icons/HT_CM/adventurer.png",
                    text_color: "#1bb980",
                    bg_color: "#233332",
                    description: "Players that have reached Zhaitan alive. This rank requires one Giants/Zhaitan log.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "experienced",
                    label: "Experienced",
                    icon: "/rank_icons/HT_CM/experienced.png",
                    text_color: "#5bcde1",
                    bg_color: "#2a373e",
                    description: "Players that have reached Soo Won 1 alive. This rank requires one Soo Won 1 log.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "solid",
                    label: "Solid",
                    icon: "/rank_icons/HT_CM/solid.png",
                    text_color: "#a04a8f",
                    bg_color: "#302834",
                    description: "Players that have proven their knowledge and skills until Soo Won 2 without mistakes. This rank requires exactly three Soo Won 2 logs without mechanic fails, one of these logs must be past the first green in Soo Won 2. These logs must be no more than six months old. You can find further guidelines here.",
                    url: Some("https://canva.link/5awxwr8ds3dqad9"),
                    auto: None,
                },
                VlRankDef {
                    id: "voidwalker",
                    label: "Voidwalker",
                    icon: "/rank_icons/HT_CM/voidwalker.png",
                    text_color: "#9b78d7",
                    bg_color: "#302c3b",
                    description: "Players that have completed HT CM. This rank requires one successful kill log, where you are alive into Soo Won 2.",
                    url: None,
                    auto: Some("cm"),
                },
            ],
        },
        VlEncounter {
            key: "greer",
            display: "Greer, the Blightbringer — Wing 8",
            aliases: &["greertheblightbringer"],
            cm_only: false,
            lcm_only: false,
            ranks: &[
                VlRankDef {
                    id: "withered",
                    label: "Withered",
                    icon: "/rank_icons/Wing_8/Greer_CM/withered.png",
                    text_color: "#fb7d90",
                    bg_color: "#3a2d34",
                    description: "Players that have reached 40% of Greer alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "plagueling",
                    label: "Plagueling",
                    icon: "/rank_icons/Wing_8/Greer_CM/plagueling.png",
                    text_color: "#ff77a2",
                    bg_color: "#3a2c36",
                    description: "Players that have reached 10% of Greer alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "theblightbringer",
                    label: "The Blightbringer",
                    icon: "/rank_icons/Wing_8/Greer_CM/theblightbringer.png",
                    text_color: "#f86cac",
                    bg_color: "#3a2b37",
                    description: "Players that have successfully completed Greer Challenge Mode whilst being alive after the final Proto-Greerling has died. The log can't exceed a fight length of 10 minutes and 30 seconds. This rank requires 1 log.",
                    url: None,
                    auto: Some("cm"),
                },
            ],
        },
        VlEncounter {
            key: "decimathestormsinger",
            display: "Decima, the Stormsinger — Wing 8",
            aliases: &["decima"],
            cm_only: false,
            lcm_only: false,
            ranks: &[
                VlRankDef {
                    id: "harmonic",
                    label: "Harmonic",
                    icon: "/rank_icons/Wing_8/Decima_CM/harmonic.png",
                    text_color: "#ce7b5d",
                    bg_color: "#3a2f30",
                    description: "Players that have reached the end of the second split phase of Decima alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "thestormsinger",
                    label: "The Stormsinger",
                    icon: "/rank_icons/Wing_8/Decima_CM/thestormsinger.png",
                    text_color: "#ff8e76",
                    bg_color: "#3a2f30",
                    description: "Players that have successfully completed Decima Challenge Mode whilst being alive in the final phase. This rank requires 1 log.",
                    url: None,
                    auto: Some("cm"),
                },
            ],
        },
        VlEncounter {
            key: "urathesteamshrieker",
            display: "Ura, the Steamshrieker — Wing 8",
            aliases: &["ura"],
            cm_only: true,
            lcm_only: false,
            ranks: &[
                VlRankDef {
                    id: "seared",
                    label: "Seared",
                    icon: "/rank_icons/Wing_8/Ura_CM/seared.png",
                    text_color: "#ecbe7c",
                    bg_color: "#645545",
                    description: "Players that have reached 25% of Ura CM alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "thesteamshrieker",
                    label: "The Steamshrieker",
                    icon: "/rank_icons/Wing_8/Ura_CM/thesteamshrieker.png",
                    text_color: "#feac3b",
                    bg_color: "#3a322b",
                    description: "Players that have successfully completed Ura Challenge Mode whilst being alive in the final phase. This rank requires 1 log.",
                    url: None,
                    auto: Some("cm"),
                },
            ],
        },
        VlEncounter {
            key: "urathelcm",
            display: "Ura, the Steamshrieker — Wing 8 (Legendary CM)",
            aliases: &["urathesteamshrieker", "ura"],
            cm_only: false,
            lcm_only: true,
            ranks: &[
                VlRankDef {
                    id: "scalded",
                    label: "Scalded",
                    icon: "/rank_icons/Wing_8/Ura_LCM/scalded.png",
                    text_color: "#8b7314",
                    bg_color: "#2f2c27",
                    description: "Players that have reached 50% of Ura LCM alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "radiated",
                    label: "Radiated",
                    icon: "/rank_icons/Wing_8/Ura_LCM/radiated.png",
                    text_color: "#8b7314",
                    bg_color: "#2f2c27",
                    description: "Players that have reached 25% of Ura LCM alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "vented",
                    label: "Vented",
                    icon: "/rank_icons/Wing_8/Ura_LCM/vented.png",
                    text_color: "#9b7c04",
                    bg_color: "#312e25",
                    description: "Players that have reached 15% after health reset of Ura LCM alive.",
                    url: None,
                    auto: None,
                },
                VlRankDef {
                    id: "legendaryconquerorofura",
                    label: "Legendary Conqueror of Ura",
                    icon: "/rank_icons/Wing_8/Ura_LCM/legendaryconquerorofura.png",
                    text_color: "#f6c401",
                    bg_color: "#3a3524",
                    description: "Players that have successfully completed the Legendary Challenge Mode. This rank requires 1 log.",
                    url: None,
                    auto: Some("lcm"),
                },
            ],
        },
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
pub fn vl_available(boss_key: &str, is_cm: Option<bool>, is_lcm: Option<bool>, lcm_only: bool) -> bool {
    if encounter_index(boss_key).is_none() {
        return false;
    }
    if lcm_only {
        return is_lcm == Some(true);
    }
    is_cm == Some(true) || is_lcm == Some(true)
}

/// Auto-awarded rank id for a successful CM/LCM kill, if the encounter defines one.
/// For mode-specific encounters (cm_only / lcm_only), the rank is gated to the
/// matching mode. For mode-agnostic encounters, LCM takes priority over CM (an LCM
/// kill also reports is_cm == true, so we must match the strictest mode first).
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
    let enc = match cat.get(encounter_index(boss_key)?) {
        Some(e) => e,
        None => return None,
    };
    // LCM-only encounter: award the LCM auto rank only on LCM logs.
    if enc.lcm_only && is_lcm == Some(true) {
        return enc
            .ranks
            .iter()
            .find(|r| r.auto == Some("lcm"))
            .map(|r| r.id.to_string());
    }
    // CM-only encounter: award the CM auto rank only on CM logs (not LCM).
    if enc.cm_only && is_cm == Some(true) && is_lcm != Some(true) {
        return enc
            .ranks
            .iter()
            .find(|r| r.auto == Some("cm"))
            .map(|r| r.id.to_string());
    }
    // Mode-agnostic encounter: LCM takes priority over CM.
    if is_lcm == Some(true) {
        return enc
            .ranks
            .iter()
            .find(|r| r.auto == Some("lcm"))
            .map(|r| r.id.to_string());
    }
    if is_cm == Some(true) {
        return enc
            .ranks
            .iter()
            .find(|r| r.auto == Some("cm"))
            .map(|r| r.id.to_string());
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

/// Validates a rank id belongs to any encounter matching the given boss key.
/// For mode-specific encounters (e.g. Ura CM vs Ura LCM sharing the same boss),
/// checks all matching encounters so LCM ranks validate on LCM logs and vice versa.
pub fn rank_is_valid(boss_key: &str, rank_id: &str) -> bool {
    catalog()
        .iter()
        .any(|e| (e.key == boss_key || e.aliases.contains(&boss_key)) && e.ranks.iter().any(|r| r.id == rank_id))
}
