use crate::uploader::UploadRecord;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Filters applied server-side to the history table.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct HistoryFilters {
    pub result: Option<String>,      // "all" | "success" | "failure"
    pub cm_mode: Option<String>,     // "all" | "cm" | "lcm" | "normal" | "quickplay"
    pub boss: Option<String>,       // "all" or cleaned boss key
    pub profession: Option<i64>,     // base profession id or elite spec id
    pub profession_kind: Option<String>, // "core" | "spec"
    pub has_notes: Option<bool>,
    pub is_favorite: Option<bool>,
    pub vl_rank: Option<String>,     // "all" | "none" | "any" | rank id
    pub date_from: Option<String>,   // "YYYY-MM-DD"
    pub date_to: Option<String>,
    pub time_from: Option<String>,   // "HH:MM"
    pub time_to: Option<String>,
    pub search: Option<String>,
    pub encounter_type: Option<String>, // "all" | ... (client-classified; handled client-side)
}

#[derive(Debug, Serialize)]
pub struct FilteredPage {
    pub rows: Vec<UploadRecord>,
    pub total: usize,
}
pub fn query_filtered(app: &AppHandle, f: &HistoryFilters, page: usize, limit: usize) -> Result<FilteredPage, String> {
    // Load all rows via the existing parsing path (single source of truth).
    let all = crate::config::load_history(app);
    // Apply filters in Rust (mirrors passesFilters for the simple/exact ones).
    let mut filtered: Vec<UploadRecord> = all
        .into_iter()
        .filter(|l| passes_filters(l, f))
        .collect();
    // Sort by timestamp desc (matches SQL ORDER BY timestamp DESC).
    filtered.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let total = filtered.len();
    let start = page * limit;
    let end = (start + limit).min(total);
    let rows = if start >= total { Vec::new() } else { filtered[start..end].to_vec() };
    Ok(FilteredPage { rows, total })
}

fn clean(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn encounter_type(log: &UploadRecord) -> &'static str {
    let boss = log.boss_name.as_deref().unwrap_or("");
    if boss.is_empty() {
        return "raid";
    }
    if log.is_convergence == Some(true) {
        return "convergence";
    }
    let c = clean(boss);
    if ["sorrow", "demonknight", "dreadwing", "hellsister", "umbriel", "convergenceouternayos"].contains(&c.as_str()) {
        return "convergence";
    }
    if ["greer", "greerthebightbringer", "greertheblightbringer", "decima", "decimathestormsinger", "ura", "urathesteamshrieker", "convergencemountbalrior"].contains(&c.as_str()) {
        if c == "convergencemountbalrior" || log.num_players.unwrap_or(0) > 10 {
            return "convergence";
        }
        return "raid";
    }
    if RAID_BOSSES.contains(&c.as_str()) {
        return "raid";
    }
    if ["captainmaitrin", "maitrin", "horrik"].contains(&c.as_str()) && log.num_players.unwrap_or(0) > 5 {
        return "strike";
    }
    if FRACTAL_BOSSES.contains(&c.as_str()) {
        return "fractal";
    }
    "strike"
}

const RAID_BOSSES: &[&str] = &[
    "valeguardian", "spiritrun", "spiritrace", "spiritwoods", "gorsevalthemultifarious", "gorseval",
    "sabethathesaboteur", "sabetha", "slothasor", "bandittrio", "banditescort", "escort",
    "matthiasgabrel", "matthias", "siegethestronghold", "escorttw", "mcleod", "mcleodthesilent",
    "keepconstruct", "twistedcastle", "xera", "cairntheindomitable", "cairn", "mursaatoverseer",
    "samarog", "deimos", "soullesshorror", "desmina", "riverofsouls", "statuegrenth", "statueofgrenth",
    "statues", "eyeoffate", "eyesoffate", "eyesofjudgment", "eyesofjudgement", "eyes", "brokenking",
    "statueofice", "souleater", "eaterofsouls", "statueofdeath", "dhuum", "conjuredamalgamate",
    "largostwins", "twinlargos", "nikare", "nikarerenut", "nikareandkenut", "qadim", "cardinalsabir",
    "cardinaladina", "qadimthepeerless", "gate", "keyofahdashimgate", "keyofahdashim", "greer",
    "greerthebightbringer", "greertheblightbringer", "decima", "decimathestormsinger", "ura",
    "urathesteamshrieker",
];

const FRACTAL_BOSSES: &[&str] = &[
    "mama", "siaxthecorrupted", "ensolyssoftheendlesstorment", "ensolyssofendlesstorment",
    "skorvaldtheshattered", "artsariiv", "arkk", "aikeeperofthepeak", "ai", "kanaxaiscytheofsouls",
    "kanaxai", "eparchthelonelyking", "eparch", "captainmaitrin", "maitrin", "horrik", "aetherbladelet",
    "frizz", "jellyfishbeast", "jellyfish", "archdiviner", "thevoice", "deepstonevoice",
];

fn passes_filters(log: &UploadRecord, f: &HistoryFilters) -> bool {
    if log.status == "Uploading" || log.boss_name.is_none() {
        return true;
    }
    if let Some(r) = f.result.as_deref() {
        if r == "success" && log.success != Some(true) {
            return false;
        }
        if r == "failure" && log.success != Some(false) {
            return false;
        }
    }
    if let Some(b) = f.boss.as_deref() {
        if b != "all" {
            let key = clean(&log.boss_name.clone().unwrap_or_default());
            if key != *b {
                return false;
            }
        }
    }
    if let Some(m) = f.cm_mode.as_deref() {
        match m {
            "cm" => {
                if log.is_cm != Some(true) {
                    return false;
                }
            }
            "lcm" => {
                if log.is_lcm != Some(true) {
                    return false;
                }
            }
            "normal" => {
                if log.is_cm == Some(true) || log.is_lcm == Some(true) || log.is_quick_play == Some(true) {
                    return false;
                }
            }
            "quickplay" => {
                if log.is_quick_play != Some(true) {
                    return false;
                }
            }
            _ => {}
        }
    }
    // Type filter
    if let Some(t) = f.encounter_type.as_deref() {
        if t != "all" {
            let enc = encounter_type(log);
            if enc != t {
                return false;
            }
        }
    }
    // Rank filter
    if let Some(vr) = f.vl_rank.as_deref() {
        if vr != "all" {
            let ranks = log.vl_rank.clone().unwrap_or_default();
            if vr == "none" && !ranks.is_empty() {
                return false;
            }
            if vr == "any" && ranks.is_empty() {
                return false;
            }
            if vr != "none" && vr != "any" && !ranks.iter().any(|r| r == vr) {
                return false;
            }
        }
    }
            if let Some(want) = f.profession {
        let kind = f.profession_kind.as_deref().unwrap_or("core");
        let has = log.players.as_ref().map(|ps| {
            ps.iter().any(|p| {
                if kind == "spec" {
                    p.elite_spec == want as u32
                } else {
                    p.profession == want as u32
                }
            })
        }).unwrap_or(false);
        if !has {
            return false;
        }
    }
if f.has_notes == Some(true) {
        if log.notes.is_empty() {
            return false;
        }
    }
    if f.is_favorite == Some(true) && log.is_favorite != Some(true) {
        return false;
    }
    // date range
    if f.date_from.is_some() || f.date_to.is_some() {
        let d = log.timestamp.chars().take(10).collect::<String>();
        if d.is_empty() {
            if f.date_from.is_some() || f.date_to.is_some() {
                // only fail if a bound is set
                if f.date_from.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
                    || f.date_to.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
                {
                    return false;
                }
            }
        } else {
            if let Some(df) = f.date_from.as_deref() {
                if !df.is_empty() && d < df.to_string() {
                    return false;
                }
            }
            if let Some(dt) = f.date_to.as_deref() {
                if !dt.is_empty() && d > dt.to_string() {
                    return false;
                }
            }
        }
    }
    // time range
    if f.time_from.is_some() || f.time_to.is_some() {
        let t_full = log.timestamp.as_str();
        let t = if t_full.len() >= 16 { &t_full[11..16] } else { "" };
        if t.is_empty() {
            if f.time_from.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
                || f.time_to.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
            {
                return false;
            }
        } else {
            if let Some(tf) = f.time_from.as_deref() {
                if !tf.is_empty() && t < tf {
                    return false;
                }
            }
            if let Some(tt) = f.time_to.as_deref() {
                if !tt.is_empty() && t > tt {
                    return false;
                }
            }
        }
    }
    if let Some(q) = f.search.as_deref() {
        let q = q.trim().to_lowercase();
        if !q.is_empty() {
            let boss_match = log.boss_name.as_deref().map(|b| b.to_lowercase().contains(&q)).unwrap_or(false);
            let player_match = log.players.as_ref().map(|ps| {
                ps.iter().any(|p| p.display_name.to_lowercase().contains(&q) || p.account.to_lowercase().contains(&q))
            }).unwrap_or(false);
            if !boss_match && !player_match {
                return false;
            }
        }
    }
    true
}
