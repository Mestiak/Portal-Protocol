// Portal Protocol — external log links (dps.report / GW2 Wingman).
//
// Owns everything for the External tab: link validation, the two services'
// fetch endpoints, a disk cache for full EI JSON, and a separate SQLite table.
// Nothing here writes to upload history — external logs are their own workspace.

use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use chrono::Utc;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use rusqlite::OptionalExtension;
use tauri::{command, AppHandle, Manager};

use crate::db;

const WINGMAN_BASE: &str = "https://gw2wingman.nevermindcreations.de";
const DPS_BASE: &str = "https://dps.report";
const MAX_JSON_BYTES: u64 = 120 * 1024 * 1024;

static DPS_DOWN: AtomicBool = AtomicBool::new(false);
static WINGMAN_DOWN: AtomicBool = AtomicBool::new(false);
static DPS_CHECKED: AtomicBool = AtomicBool::new(false);
static WINGMAN_CHECKED: AtomicBool = AtomicBool::new(false);
static DPS_FAILS: AtomicU32 = AtomicU32::new(0);
static WINGMAN_FAILS: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Service {
    DpsReport,
    Wingman,
}

impl Service {
    fn key(self) -> &'static str {
        match self {
            Service::DpsReport => "dpsreport",
            Service::Wingman => "wingman",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Service::DpsReport => "dps.report",
            Service::Wingman => "GW2 Wingman",
        }
    }
    fn down(self) -> &'static AtomicBool {
        match self {
            Service::DpsReport => &DPS_DOWN,
            Service::Wingman => &WINGMAN_DOWN,
        }
    }
    fn checked(self) -> &'static AtomicBool {
        match self {
            Service::DpsReport => &DPS_CHECKED,
            Service::Wingman => &WINGMAN_CHECKED,
        }
    }
    fn fails(self) -> &'static AtomicU32 {
        match self {
            Service::DpsReport => &DPS_FAILS,
            Service::Wingman => &WINGMAN_FAILS,
        }
    }
}

fn mark_ok(service: Service) {
    service.fails().store(0, Ordering::Relaxed);
    service.down().store(false, Ordering::Relaxed);
    service.checked().store(true, Ordering::Relaxed);
}

fn mark_fail(service: Service) {
    let n = service.fails().fetch_add(1, Ordering::Relaxed) + 1;
    if n >= 2 {
        service.down().store(true, Ordering::Relaxed);
    }
    service.checked().store(true, Ordering::Relaxed);
}

fn service_state(service: Service) -> &'static str {
    if !service.checked().load(Ordering::Relaxed) {
        "unknown"
    } else if service.down().load(Ordering::Relaxed) {
        "offline"
    } else {
        "online"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlayer {
    pub name: String,
    pub account: String,
    pub profession: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalNote {
    pub id: String,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLogRecord {
    pub id: String,
    pub source: String,
    pub link_id: String,
    pub url: String,
    pub boss_name: String,
    pub success: Option<bool>,
    pub is_cm: bool,
    pub is_lcm: bool,
    pub duration_sec: f64,
    pub group_dps: f64,
    pub hp_left: Option<f64>,
    pub multi_boss: bool,
    pub num_players: usize,
    pub players: Vec<ExternalPlayer>,
    pub notes: Vec<ExternalNote>,
    pub created_at: String,
    pub last_checked: String,
}

fn client_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json,text/plain,*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .default_headers(client_headers())
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(4)
            .build()
            .expect("external client build")
    })
}

/// Full EI JSON can be tens of megabytes and take 30–40 seconds to stream.
/// The shared 30-second client timeout cuts the body off mid-download, which
/// reqwest surfaces as "error decoding response body". This client keeps a
/// short connect timeout but allows long downloads to finish.
fn download_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .default_headers(client_headers())
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(4)
            .build()
            .expect("external download client build")
    })
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Returns (service, link id, canonical url). Only allowlisted hosts are accepted.
fn normalize_link(input: &str) -> Result<(Service, String, String), String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("Paste a dps.report or GW2 Wingman log link first.".to_string());
    }
    let url = Url::parse(raw).map_err(|_| "That does not look like a full link (include https://).".to_string())?;
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let parts: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();

    if matches!(host.as_str(), "dps.report" | "b.dps.report" | "a.dps.report") {
        let id = if parts.first().copied() == Some("getJson") {
            url.query_pairs()
                .find(|(k, _)| k == "permalink")
                .map(|(_, v)| v.to_string())
        } else {
            parts
                .first()
                .map(|p| p.split('_').next().unwrap_or(p).to_string())
        }
        .ok_or_else(|| "No dps.report log id found in that link.".to_string())?;
        if !valid_id(&id) {
            return Err("Invalid dps.report log id.".to_string());
        }
        return Ok((Service::DpsReport, id.clone(), format!("{DPS_BASE}/{id}")));
    }

    if matches!(host.as_str(), "gw2wingman.nevermindcreations.de" | "www.gw2wingman.nevermindcreations.de") {
        let id = parts.last().copied().unwrap_or("").to_string();
        if !valid_id(&id) {
            return Err("Invalid Wingman log id.".to_string());
        }
        return Ok((Service::Wingman, id.clone(), format!("{WINGMAN_BASE}/log/{id}")));
    }

    Err("Unsupported link. Paste a dps.report or GW2 Wingman log link.".to_string())
}

async fn fetch_json(url: &str, service: Service) -> Result<Value, String> {
    let resp = download_client()
        .get(url)
        .send()
        .await
        .map_err(|e| {
            mark_fail(service);
            format!("{} request failed ({e}). The service may be down or unreachable.", service.label())
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        mark_fail(service);
        return Err(format!(
            "{} returned HTTP {}{}",
            service.label(),
            status,
            if status.as_u16() == 403 { " (access blocked)" } else if status.as_u16() >= 500 { " (server error)" } else { "" }
        ));
    }
    let mut buf: Vec<u8> = Vec::with_capacity(4 * 1024 * 1024);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            mark_fail(service);
            if e.is_timeout() {
                format!("{} download timed out while reading the response. Try again in a moment.", service.label())
            } else {
                format!("{} download failed ({e}).", service.label())
            }
        })?;
        buf.extend_from_slice(&chunk);
        if buf.len() as u64 > MAX_JSON_BYTES {
            return Err(format!("{} response is too large (>120 MB).", service.label()));
        }
    }
    let value: Value = serde_json::from_slice(&buf)
        .map_err(|e| format!("{} returned invalid JSON ({e}).", service.label()))?;
    drop(buf);
    if let Some(msg) = value.get("error").and_then(|v| v.as_str()) {
        return Err(format!("{}: {msg}", service.label()));
    }
    mark_ok(service);
    Ok(value)
}

/// dps.report's primary domain is blocked in some regions (Cloudflare 403).
/// Its docs list three service domains, so try all of them in order before
/// surfacing a failure. Errors name every attempt.
async fn fetch_dps_json(link_id: &str) -> Result<Value, String> {
    let domains = [DPS_BASE, "https://b.dps.report", "http://a.dps.report"];
    let mut failures: Vec<String> = Vec::new();
    for domain in domains {
        let url = format!("{domain}/getJson?permalink={link_id}");
        match fetch_json(&url, Service::DpsReport).await {
            Ok(value) => return Ok(value),
            Err(err) => failures.push(format!("{domain}: {err}")),
        }
    }
    Err(failures.join(" | "))
}

fn cache_path(app: &AppHandle, service: Service, link_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("external_cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = link_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    Ok(dir.join(format!("{}_{}.json.gz", service.key(), safe)))
}

fn cache_get(app: &AppHandle, service: Service, link_id: &str) -> Option<Value> {
    let file = File::open(cache_path(app, service, link_id).ok()?).ok()?;
    let mut decoder = GzDecoder::new(file);
    let mut text = String::new();
    decoder.read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

fn cache_put(app: &AppHandle, service: Service, link_id: &str, value: &Value) {
    if let Ok(path) = cache_path(app, service, link_id) {
        if let Ok(file) = File::create(path) {
            let mut encoder = GzEncoder::new(file, Compression::fast());
            let _ = serde_json::to_writer(&mut encoder, value);
            let _ = encoder.finish();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalCouncil {
    pub phases: Vec<crate::evtc_parser::DragonPhase>,
    pub hp: Vec<crate::evtc_parser::DragonHp>,
}

fn council_cache_path(app: &AppHandle, service: Service, link_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("external_cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = link_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    Ok(dir.join(format!("{}_{}_multi.json.gz", service.key(), safe)))
}

fn council_cache_get(app: &AppHandle, service: Service, link_id: &str) -> Option<ExternalCouncil> {
    let file = File::open(council_cache_path(app, service, link_id).ok()?).ok()?;
    let mut decoder = GzDecoder::new(file);
    let mut text = String::new();
    decoder.read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

fn council_cache_put(app: &AppHandle, service: Service, link_id: &str, value: &ExternalCouncil) {
    if let Ok(path) = council_cache_path(app, service, link_id) {
        if let Ok(file) = File::create(path) {
            let mut encoder = GzEncoder::new(file, Compression::fast());
            let _ = serde_json::to_writer(&mut encoder, value);
            let _ = encoder.finish();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTargetRow {
    pub label: String,
    pub hp: Option<f64>,
    pub icon: String,
    pub icon_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalTargets {
    pub rows: Vec<ExternalTargetRow>,
}

fn targets_cache_path(app: &AppHandle, service: Service, link_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("external_cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = link_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    Ok(dir.join(format!("{}_{}_targets.json.gz", service.key(), safe)))
}

fn targets_cache_get(app: &AppHandle, service: Service, link_id: &str) -> Option<ExternalTargets> {
    let file = File::open(targets_cache_path(app, service, link_id).ok()?).ok()?;
    let mut decoder = GzDecoder::new(file);
    let mut text = String::new();
    decoder.read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

fn targets_cache_put(app: &AppHandle, service: Service, link_id: &str, value: &ExternalTargets) {
    if let Ok(path) = targets_cache_path(app, service, link_id) {
        if let Ok(file) = File::create(path) {
            let mut encoder = GzEncoder::new(file, Compression::fast());
            let _ = serde_json::to_writer(&mut encoder, value);
            let _ = encoder.finish();
        }
    }
}

fn push_target(
    rows: &mut Vec<ExternalTargetRow>,
    label: &str,
    hp: Option<f64>,
    icon: &str,
    color: Option<&str>,
) {
    if let Some(value) = hp {
        rows.push(ExternalTargetRow {
            label: label.to_string(),
            hp: Some(value),
            icon: icon.to_string(),
            icon_color: color.map(|c| c.to_string()),
        });
    }
}

fn compute_targets(raw: &Value) -> Option<ExternalTargets> {
    let mut record = crate::uploader::UploadRecord::default();
    crate::ei_runner::enrich_record_from_ei(&mut record, raw);
    let mut rows: Vec<ExternalTargetRow> = Vec::new();

    if let Some(v) = &record.twin_largos {
        push_target(&mut rows, "Nikare", v.nikare_hp_left, "fa-person", None);
        push_target(&mut rows, "Kenut", v.kenut_hp_left, "fa-person", None);
    }
    if let Some(v) = &record.eyes {
        push_target(&mut rows, "Eye of Darkness", v.darkness_hp_left, "fa-eye", None);
        push_target(&mut rows, "Eye of Despair", v.despair_hp_left, "fa-eye", None);
    }
    if let Some(v) = &record.voice_claw {
        push_target(&mut rows, "Voice", v.voice_hp_left, "fa-person", None);
        push_target(&mut rows, "Claw", v.claw_hp_left, "fa-person", None);
    }
    if let Some(v) = &record.aetherblade {
        push_target(&mut rows, "Mai Trin", v.maitrin_hp_left, "fa-skull", None);
        push_target(&mut rows, "Echo of Scarlet", v.scarlet_hp_left, "fa-person", None);
    }
    if let Some(v) = &record.ca_arms {
        push_target(&mut rows, "Right Arm", Some(v.right_arm_hp_left), "fa-hand-fist", None);
        push_target(&mut rows, "Left Arm", Some(v.left_arm_hp_left), "fa-hand-fist", None);
    }
    if let Some(v) = &record.old_lions_court {
        if let Some(phase) = v.phase {
            rows.push(ExternalTargetRow {
                label: format!("Phase {}", phase),
                hp: None,
                icon: "fa-tower-observation".to_string(),
                icon_color: None,
            });
        }
        if v.cc_wipe {
            rows.push(ExternalTargetRow {
                label: "CC Wipe".to_string(),
                hp: None,
                icon: "fa-puzzle-piece".to_string(),
                icon_color: None,
            });
        }
        push_target(&mut rows, "Prototype Vermilion", v.vermilion_hp_left, "fa-robot", Some("#ef4444"));
        push_target(&mut rows, "Prototype Arsenite", v.arsenite_hp_left, "fa-robot", Some("#22c55e"));
        push_target(&mut rows, "Prototype Indigo", v.indigo_hp_left, "fa-robot", Some("#3b82f6"));
    }

    if rows.is_empty() { None } else { Some(ExternalTargets { rows }) }
}

fn normalized_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn is_dragonvoid_name(name: &str) -> bool {
    let c = normalized_name(name);
    matches!(
        c.as_str(),
        "void" | "dragonvoid" | "thedragonvoid" | "harvesttemple" | "harvesttemplecm"
    )
}

/// Fights whose single-boss HP number is not meaningful: the regular log cards
/// suppress it and show a per-target pattern instead.
fn is_multi_boss_name(name: &str) -> bool {
    let c = normalized_name(name);
    is_dragonvoid_name(name)
        || matches!(
            c.as_str(),
            "twinlargos" | "nikare" | "kenut" | "eyes" | "eyesoffate" | "statueofdarkness"
                | "voiceandclaw" | "voiceandclawofthefallen" | "thevoiceandtheclaw"
                | "voice" | "claw" | "conjuredamalgamate" | "aetherbladehideout"
                | "oldlionscourt" | "prototypevermilion" | "prototypeindigo" | "prototypegold"
        )
}

fn compute_council(raw: &Value, success: bool) -> Option<ExternalCouncil> {
    Some(ExternalCouncil {
        phases: crate::evtc_parser::dragon_phase_full_with_adds(raw, success, None)?,
        hp: crate::evtc_parser::dragon_phase_state_with_success(raw, Some(success))?,
    })
}

async fn raw_json_for(app: &AppHandle, service: Service, link_id: &str) -> Result<Value, String> {
    if let Some(raw) = cache_get(app, service, link_id) {
        return Ok(raw);
    }
    let raw = match service {
        Service::Wingman => {
            fetch_json(&format!("{WINGMAN_BASE}/api/getFullJson/{link_id}"), service).await?
        }
        Service::DpsReport => fetch_dps_json(link_id).await?,
    };
    cache_put(app, service, link_id, &raw);
    Ok(raw)
}

async fn warm_external_breakdowns(app: &AppHandle, service: Service, link_id: &str) {
    let need_council = council_cache_get(app, service, link_id).is_none();
    let need_targets = targets_cache_get(app, service, link_id).is_none();
    if !need_council && !need_targets {
        return;
    }
    if let Ok(raw) = raw_json_for(app, service, link_id).await {
        if need_council {
            let success = raw.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if let Some(council) = compute_council(&raw, success) {
                council_cache_put(app, service, link_id, &council);
            }
        }
        if need_targets {
            if let Some(targets) = compute_targets(&raw) {
                targets_cache_put(app, service, link_id, &targets);
            }
        }
    }
}

fn players_from(raw: &Value) -> Vec<ExternalPlayer> {
    raw.get("players")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    let name = p.get("name").and_then(|v| v.as_str())?;
                    Some(ExternalPlayer {
                        name: name.to_string(),
                        account: p.get("account").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        profession: p
                            .get("profession")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_notes(text: &str) -> Vec<ExternalNote> {
    serde_json::from_str(text).unwrap_or_default()
}

fn record_from_row(row: &rusqlite::Row<'_>) -> Result<ExternalLogRecord, rusqlite::Error> {
    let raw_players: String = row.get("players")?;
    let raw_notes: String = row.get("notes")?;
    let players: Vec<ExternalPlayer> = serde_json::from_str(&raw_players).unwrap_or_default();
    let notes = parse_notes(&raw_notes);
    let boss_name: String = row.get::<_, Option<String>>("boss_name")?.unwrap_or_default();
    let multi_boss = is_multi_boss_name(&boss_name);
    Ok(ExternalLogRecord {
        id: row.get("id")?,
        source: row.get("source")?,
        link_id: row.get("link_id")?,
        url: row.get("url")?,
        boss_name,
        success: row.get::<_, Option<i64>>("success")?.map(|v| v != 0),
        is_cm: row.get::<_, Option<i64>>("is_cm")?.unwrap_or(0) != 0,
        is_lcm: row.get::<_, Option<i64>>("is_lcm")?.unwrap_or(0) != 0,
        duration_sec: row.get::<_, Option<f64>>("duration_sec")?.unwrap_or(0.0),
        group_dps: row.get::<_, Option<f64>>("group_dps")?.unwrap_or(0.0),
        hp_left: row.get("hp_left")?,
        multi_boss,
        num_players: players.len(),
        players,
        notes,
        created_at: row.get("created_at")?,
        last_checked: row.get("last_checked")?,
    })
}

fn get_record(app: &AppHandle, id: &str) -> Result<Option<ExternalLogRecord>, String> {
    let conn = db::open_db(app)?;
    let mut stmt = conn
        .prepare("SELECT id, source, link_id, url, boss_name, success, is_cm, is_lcm, duration_sec, group_dps, hp_left, players, notes, created_at, last_checked FROM external_logs WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let found = stmt
        .query_row([id], record_from_row)
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(found)
}

// Wingman's `triggerID` is a boss/event id from Wingman's own list, not an
// Elite Insights species id. The two namespaces overlap but differ (e.g. 21105
// is Nikare in EI and Twin Largos in Wingman). Source: /api/bosses.
fn wingman_boss_name(trigger: u64) -> Option<&'static str> {
    Some(match trigger {
        1 => "WvW",
        1527 => "Convergence: Outer Nayos",
        1562 => "Convergence: Mount Balrior",
        1571 => "Convergence: Mount Balrior",
        1629 => "Vloxx",
        15375 => "Sabetha the Saboteur",
        15415 => "Spirit Woods",
        15429 => "Gorseval the Multifarious",
        15438 => "Vale Guardian",
        16088 => "Bandit Trio",
        16115 => "Matthias Gabrel",
        16123 => "Slothasor",
        16177 => "Average Kitty Golem",
        16198 => "Vital Kitty Golem",
        16199 => "Standard Kitty Golem",
        16202 => "Massive Kitty Golem",
        16235 => "Keep Construct",
        16246 => "Xera",
        16247 => "Twisted Castle",
        16253 => "Siege the Stronghold",
        16948 => "Ensolyss of the Endless Torment",
        17021 => "M A M A",
        17028 => "Siax the Corrupted",
        17154 => "Deimos",
        17172 => "Mursaat Overseer",
        17188 => "Samarog",
        17194 => "Cairn the Indomitable",
        17632 => "Skorvald the Shattered",
        17759 => "Arkk",
        17949 => "Artsariiv",
        19450 => "Dhuum",
        19536 => "Eater of Souls",
        19645 => "Medium Kitty Golem",
        19651 => "Statue of Darkness",
        19676 => "Large Kitty Golem",
        19691 => "Broken King",
        19767 => "Soulless Horror",
        19828 => "River of Souls",
        20934 => "Qadim",
        21105 => "Twin Largos",
        21333 => "Freezie",
        21964 => "Cardinal Sabir",
        22000 => "Qadim the Peerless",
        22006 => "Cardinal Adina",
        22154 => "Icebrood Construct",
        22343 => "Voice and Claw of the Fallen",
        22492 => "Fraenir of Jormag",
        22521 => "Boneskinner",
        22711 => "Whisper of Jormag",
        23254 => "Elemental Ai, Keeper of the Peak",
        23957 => "Ankka",
        24033 => "Captain Mai Trin",
        24375 => "The Dragonvoid",
        24485 => "Minister Li",
        25357 => "Kanaxai, Scythe of Souls",
        25413 => "Old Lion's Court",
        25415 => "Old Lions Court",
        25419 => "Old Lions Court",
        25577 => "Kanaxai, Scythe of House Aurkus",
        25705 => "Dagda",
        25989 => "Cerus",
        26123 => "Ura",
        26228 => "Ura",
        26231 => "Eparch",
        26257 => "Greer",
        26309 => "Greer",
        26712 => "Ura",
        26725 => "Greer the Blightbringer",
        26774 => "Decima the Stormsinger",
        26867 => "Decima the Stormsinger",
        26889 => "Greer",
        27010 => "Legendary Whispering Shadow",
        27017 => "Ura",
        27124 => "Kela, Seneschal of Waves",
        28077 => "Vloxx",
        28106 => "Vloxx",
        43488 => "The Dragonvoid",
        43974 => "Conjured Amalgamate",
        232542 => "Dark Ai, Keeper of the Peak",
        232543 => "Ai, Keeper of the Peak",
        _ => return None,
    })
}

fn build_record(service: Service, link_id: &str, url: &str, raw: &Value) -> Result<ExternalLogRecord, String> {
    let players = players_from(raw);
    let (boss_name, success, is_cm, is_lcm, duration_sec, group_dps, hp_left) = match service {
        Service::Wingman => {
            let trigger = raw.get("triggerID").and_then(|v| v.as_u64()).unwrap_or(0);
            let fight_name = raw.get("fightName").and_then(|v| v.as_str()).unwrap_or("");
            let name = if trigger == 24375 || normalized_name(fight_name).contains("harvesttemple") {
                "The Dragonvoid".to_string()
            } else {
                match wingman_boss_name(trigger) {
                    Some(name) => name.to_string(),
                    None if trigger <= u16::MAX as u64 => {
                        crate::evtc_parser::get_boss_name_from_id(trigger as u16)
                    }
                    None => format!("Encounter {}", trigger),
                }
            };
            (
                if name.is_empty() {
                    link_id.replace('_', " ")
                } else {
                    name
                },
                raw.get("success").and_then(|v| v.as_bool()),
                raw.get("isCM").and_then(|v| v.as_bool()).unwrap_or(false),
                raw.get("isLegendaryCM").and_then(|v| v.as_bool()).unwrap_or(false),
                raw.get("durationMS").and_then(|v| v.as_f64()).unwrap_or(0.0) / 1000.0,
                raw.get("squadDmg").and_then(|v| v.as_f64()).unwrap_or(0.0),
                raw.get("hpLeft").and_then(|v| v.as_f64()),
            )
        }
        Service::DpsReport => {
            let stats = crate::uploader::shape_log_stats(raw);
            let fight_name = raw.get("fightName").and_then(|v| v.as_str()).unwrap_or("");
            let boss_name = if normalized_name(fight_name).contains("harvesttemple")
                || is_dragonvoid_name(&stats.boss_name)
            {
                "The Dragonvoid".to_string()
            } else {
                stats.boss_name
            };
            (
                boss_name,
                raw.get("success").and_then(|v| v.as_bool()),
                raw.get("isCM").and_then(|v| v.as_bool()).unwrap_or(false),
                raw.get("isLegendaryCM").and_then(|v| v.as_bool()).unwrap_or(false),
                raw.get("durationMS")
                    .and_then(|v| v.as_f64())
                    .map(|ms| ms / 1000.0)
                    .unwrap_or(stats.duration_sec),
                stats.total_dps,
                raw.get("hpLeft").and_then(|v| v.as_f64()),
            )
        }
    };
    let now = Utc::now().to_rfc3339();
    let multi_boss = is_multi_boss_name(&boss_name);
    Ok(ExternalLogRecord {
        id: format!("{}:{}", service.key(), link_id),
        source: service.key().to_string(),
        link_id: link_id.to_string(),
        url: url.to_string(),
        boss_name,
        success,
        is_cm,
        is_lcm,
        duration_sec,
        group_dps,
        hp_left,
        multi_boss,
        num_players: players.len(),
        players,
        notes: Vec::new(),
        created_at: now.clone(),
        last_checked: now,
    })
}

async fn fetch_record(app: &AppHandle, service: Service, link_id: &str, url: &str) -> Result<ExternalLogRecord, String> {
    match service {
        Service::Wingman => {
            let meta = fetch_json(&format!("{WINGMAN_BASE}/api/getMetadata/{link_id}"), service).await?;
            build_record(service, link_id, url, &meta)
        }
        Service::DpsReport => {
            let raw = fetch_dps_json(link_id).await?;
            cache_put(app, service, link_id, &raw);
            build_record(service, link_id, url, &raw)
        }
    }
}

fn save_record(app: &AppHandle, rec: &ExternalLogRecord) -> Result<(), String> {
    let conn = db::open_db(app)?;
    conn.execute(
        "INSERT INTO external_logs (id, source, link_id, url, boss_name, success, is_cm, is_lcm, duration_sec, group_dps, hp_left, num_players, players, notes, created_at, last_checked)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(id) DO UPDATE SET url=excluded.url, boss_name=excluded.boss_name, success=excluded.success,
           is_cm=excluded.is_cm, is_lcm=excluded.is_lcm, duration_sec=excluded.duration_sec,
           group_dps=excluded.group_dps, hp_left=excluded.hp_left, num_players=excluded.num_players,
           players=excluded.players, last_checked=excluded.last_checked",
        rusqlite::params![
            rec.id,
            rec.source,
            rec.link_id,
            rec.url,
            rec.boss_name,
            rec.success.map(|v| v as i64),
            rec.is_cm as i64,
            rec.is_lcm as i64,
            rec.duration_sec,
            rec.group_dps,
            rec.hp_left,
            rec.num_players as i64,
            serde_json::to_string(&rec.players).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&rec.notes).unwrap_or_else(|_| "[]".to_string()),
            rec.created_at,
            rec.last_checked,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn add_external_log(app: AppHandle, url: String) -> Result<ExternalLogRecord, String> {
    add_log_from_url(&app, &url).await
}

async fn add_log_from_url(app: &AppHandle, url: &str) -> Result<ExternalLogRecord, String> {
    let (service, link_id, canonical) = normalize_link(url)?;
    let id = format!("{}:{}", service.key(), link_id);
    if let Some(existing) = get_record(app, &id)? {
        return Ok(existing);
    }
    let rec = fetch_record(app, service, &link_id, &canonical).await?;
    save_record(app, &rec)?;
    if rec.multi_boss {
        warm_external_breakdowns(app, service, &link_id).await;
    }
    Ok(rec)
}

/// Wingman indexes the full dps.report permalink including the boss suffix;
/// `normalize_link` strips that suffix for cache ids, so lookups need the
/// original full id.
fn full_dps_report_link(input: &str) -> Result<String, String> {
    let url = Url::parse(input.trim()).map_err(|_| "That does not look like a full link (include https://).".to_string())?;
    let host = url.host_str().unwrap_or_default().to_lowercase();
    if !matches!(host.as_str(), "dps.report" | "b.dps.report" | "a.dps.report") {
        return Err("Paste a dps.report link to find it on Wingman.".to_string());
    }
    let parts: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    let id = if parts.first().copied() == Some("getJson") {
        url.query_pairs()
            .find(|(key, _)| key == "permalink")
            .map(|(_, value)| value.to_string())
    } else {
        parts.first().map(|p| p.to_string())
    }
    .ok_or_else(|| "No dps.report log id found in that link.".to_string())?;
    if !valid_id(&id) {
        return Err("Invalid dps.report log id.".to_string());
    }
    Ok(format!("{DPS_BASE}/{id}"))
}

fn wingman_query_url(endpoint: &str, link: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(&format!("{WINGMAN_BASE}{endpoint}"))
        .map_err(|e| format!("Invalid Wingman endpoint: {e}"))?;
    url.query_pairs_mut().append_pair("link", link);
    Ok(url.to_string())
}

fn parse_wingman_lookup(value: &Value) -> Result<Value, String> {
    let in_db = value.get("inDB").and_then(|v| v.as_bool()).unwrap_or(false);
    let in_queue = value.get("inQueue").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut out = serde_json::json!({ "found": false, "inQueue": in_queue });
    if in_db {
        if let Some(target) = value.get("targetURL").and_then(|v| v.as_str()) {
            let (service, link_id, url) = normalize_link(target)?;
            if !matches!(service, Service::Wingman) {
                return Err("Wingman returned a target that is not a Wingman log.".to_string());
            }
            out["found"] = Value::Bool(true);
            out["targetURL"] = Value::String(url);
            out["linkId"] = Value::String(link_id);
        }
    }
    Ok(out)
}

/// Looks up an already-imported Wingman log for a dps.report link. Read-only.
#[command]
pub async fn find_wingman_log_for_dps(link: String) -> Result<Value, String> {
    let full = full_dps_report_link(&link)?;
    let url = wingman_query_url("/api/checkLogQueuedOrDB", &full)?;
    let response = fetch_json(&url, Service::Wingman).await?;
    parse_wingman_lookup(&response)
}

/// Explicitly queues a dps.report log for import into Wingman.
#[command]
pub async fn import_wingman_log_from_dps(link: String) -> Result<Value, String> {
    let full = full_dps_report_link(&link)?;
    let url = wingman_query_url("/api/importLogQueued", &full)?;
    let response = fetch_json(&url, Service::Wingman).await?;
    let success = response.get("success").and_then(|v| v.as_i64()).unwrap_or(0) == 1;
    let note = response
        .get("note")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if !success {
        return Err(if note.is_empty() {
            "Wingman could not queue the log.".to_string()
        } else {
            note
        });
    }
    Ok(serde_json::json!({ "queued": true, "note": note }))
}

/// Fetches dps.report JSON with curl.exe. On some Windows connections both the
/// native reqwest client and WebView2 are 403'd while curl succeeds, so this is
/// the primary path for dps.report links. The id is validated before use and
/// curl is spawned directly (no shell), off the async runtime.
async fn fetch_dps_json_via_curl(link_id: &str) -> Result<Value, String> {
    if !valid_id(link_id) {
        return Err("Invalid dps.report log id.".to_string());
    }
    let mut failures: Vec<String> = Vec::new();
    for base in [DPS_BASE, "https://b.dps.report", "http://a.dps.report"] {
        let url = format!("{base}/getJson?permalink={link_id}");
        #[cfg(windows)]
        let binaries: &[&str] = &[r"C:\Windows\System32\curl.exe", "curl.exe"];
        #[cfg(not(windows))]
        let binaries: &[&str] = &["curl", "curl.exe"];
        for binary in binaries {
            let binary_path = binary.to_string();
            let target = url.clone();
            let output = tokio::task::spawn_blocking(move || {
                let mut cmd = std::process::Command::new(&binary_path);
                cmd.args(["-f", "-sS", "--max-time", "180", &target]);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                }
                cmd.output()
            })
            .await
            .map_err(|e| e.to_string())?;
            match output {
                Ok(out) if out.status.success() => {
                    if out.stdout.len() as u64 > MAX_JSON_BYTES {
                        failures.push(format!("{base}: response too large"));
                        break;
                    }
                    match serde_json::from_slice::<Value>(&out.stdout) {
                        Ok(value) => {
                            if let Some(msg) = value.get("error").and_then(|v| v.as_str()) {
                                failures.push(format!("{base}: {msg}"));
                                break;
                            }
                            mark_ok(Service::DpsReport);
                            return Ok(value);
                        }
                        Err(e) => {
                            failures.push(format!("{base}: invalid JSON ({e})"));
                            break;
                        }
                    }
                }
                Ok(out) => {
                    let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
                    failures.push(format!("{base}: {}", if msg.is_empty() { "curl failed" } else { &msg }));
                    break;
                }
                Err(e) => {
                    failures.push(format!("{binary}: {e}"));
                    continue;
                }
            }
        }
    }
    Err(failures.join(" | "))
}

#[command]
pub async fn fetch_dps_report_json(link_id: String) -> Result<Value, String> {
    fetch_dps_json_via_curl(&link_id).await
}

/// Stores EI JSON fetched by the WebView. dps.report's bot protection rejects
/// the app's native HTTP client on some connections even with browser headers,
/// while the WebView fetch of the same URL succeeds. Rust still validates and
/// persists the payload.
#[command]
pub fn store_external_raw(
    app: AppHandle,
    source: String,
    link_id: String,
    url: String,
    raw: Value,
) -> Result<ExternalLogRecord, String> {
    if source != "dpsreport" {
        return Err("Only dps.report payloads can be stored from the frontend.".to_string());
    }
    if !raw
        .get("players")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false)
    {
        return Err("dps.report returned a log without player data.".to_string());
    }
    let mut rec = build_record(Service::DpsReport, &link_id, &url, &raw)?;
    if let Some(existing) = get_record(&app, &rec.id)? {
        rec.notes = existing.notes;
        rec.created_at = existing.created_at;
    }
    cache_put(&app, Service::DpsReport, &link_id, &raw);
    save_record(&app, &rec)?;
    mark_ok(Service::DpsReport);
    Ok(rec)
}

#[command]
pub async fn list_external_logs(app: AppHandle) -> Result<Vec<ExternalLogRecord>, String> {
    let conn = db::open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, source, link_id, url, boss_name, success, is_cm, is_lcm, duration_sec, group_dps, hp_left, players, notes, created_at, last_checked FROM external_logs ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], record_from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[command]
pub async fn refresh_external_log(app: AppHandle, id: String) -> Result<ExternalLogRecord, String> {
    let (source, link_id, service) = {
        let conn = db::open_db(&app)?;
        let row: (String, String, String) = conn
            .query_row(
                "SELECT source, link_id, url FROM external_logs WHERE id = ?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let service = match row.0.as_str() {
            "dpsreport" => Service::DpsReport,
            "wingman" => Service::Wingman,
            _ => return Err("Unknown external log source.".to_string()),
        };
        (row.0, row.1, service)
    };
    let _ = source;
    let mut rec = fetch_record(&app, service, &link_id, "").await?;
    if let Some(existing) = get_record(&app, &id)? {
        rec.id = existing.id;
        rec.notes = existing.notes;
        rec.created_at = existing.created_at;
        rec.url = existing.url;
    }
    save_record(&app, &rec)?;
    if rec.multi_boss {
        warm_external_breakdowns(&app, service, &link_id).await;
    }
    Ok(rec)
}

#[command]
pub fn delete_external_log(app: AppHandle, id: String) -> Result<(), String> {
    let conn = db::open_db(&app)?;
    conn.execute("DELETE FROM external_logs WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    if let Some((service, link_id)) = id.split_once(':') {
        let service = if service == "wingman" { Service::Wingman } else { Service::DpsReport };
        if let Ok(path) = cache_path(&app, service, link_id) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

#[command]
pub async fn get_external_multi_boss(
    app: AppHandle,
    id: String,
) -> Result<Option<ExternalCouncil>, String> {
    let (source, link_id) = {
        let conn = db::open_db(&app)?;
        conn.query_row(
            "SELECT source, link_id FROM external_logs WHERE id = ?1",
            [&id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    let service = match source.as_str() {
        "dpsreport" => Service::DpsReport,
        "wingman" => Service::Wingman,
        _ => return Err("Unknown external log source.".to_string()),
    };
    if let Some(cached) = council_cache_get(&app, service, &link_id) {
        return Ok(Some(cached));
    }
    let raw = raw_json_for(&app, service, &link_id).await?;
    let success = raw.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
    match compute_council(&raw, success) {
        Some(council) => {
            council_cache_put(&app, service, &link_id, &council);
            Ok(Some(council))
        }
        None => Ok(None),
    }
}

#[command]
pub async fn get_external_multi_targets(
    app: AppHandle,
    id: String,
) -> Result<Option<ExternalTargets>, String> {
    let (source, link_id) = {
        let conn = db::open_db(&app)?;
        conn.query_row(
            "SELECT source, link_id FROM external_logs WHERE id = ?1",
            [&id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    let service = match source.as_str() {
        "dpsreport" => Service::DpsReport,
        "wingman" => Service::Wingman,
        _ => return Err("Unknown external log source.".to_string()),
    };
    if let Some(cached) = targets_cache_get(&app, service, &link_id) {
        return Ok(Some(cached));
    }
    let raw = raw_json_for(&app, service, &link_id).await?;
    match compute_targets(&raw) {
        Some(targets) => {
            targets_cache_put(&app, service, &link_id, &targets);
            Ok(Some(targets))
        }
        None => Ok(None),
    }
}

#[command]
pub async fn get_external_log_full(app: AppHandle, id: String) -> Result<crate::uploader::LogFull, String> {
    let (source, link_id) = {
        let conn = db::open_db(&app)?;
        conn.query_row(
            "SELECT source, link_id FROM external_logs WHERE id = ?1",
            [&id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    let service = match source.as_str() {
        "dpsreport" => Service::DpsReport,
        "wingman" => Service::Wingman,
        _ => return Err("Unknown external log source.".to_string()),
    };
    let raw = match cache_get(&app, service, &link_id) {
        Some(v) => v,
        None => match service {
            Service::DpsReport => {
                let v = fetch_dps_json(&link_id).await?;
                cache_put(&app, service, &link_id, &v);
                v
            }
            Service::Wingman => {
                let v = fetch_json(&format!("{WINGMAN_BASE}/api/getFullJson/{link_id}"), service).await?;
                cache_put(&app, service, &link_id, &v);
                v
            }
        },
    };
    if !raw.get("players").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) {
        return Err(format!("{} returned a log without player data.", service.label()));
    }
    Ok(crate::uploader::LogFull {
        stats: crate::uploader::shape_log_stats(&raw),
        raw,
    })
}

#[command]
pub fn add_external_note(app: AppHandle, id: String, text: String) -> Result<(), String> {
    let mut rec = get_record(&app, &id)?.ok_or_else(|| "External log not found.".to_string())?;
    rec.notes.push(ExternalNote {
        id: format!("note-{}", Utc::now().timestamp_millis()),
        text,
        created_at: Utc::now().to_rfc3339(),
    });
    let conn = db::open_db(&app)?;
    conn.execute(
        "UPDATE external_logs SET notes = ?1 WHERE id = ?2",
        rusqlite::params![serde_json::to_string(&rec.notes).unwrap_or_else(|_| "[]".to_string()), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn delete_external_note(app: AppHandle, id: String, note_id: String) -> Result<(), String> {
    let mut rec = get_record(&app, &id)?.ok_or_else(|| "External log not found.".to_string())?;
    rec.notes.retain(|n| n.id != note_id);
    let conn = db::open_db(&app)?;
    conn.execute(
        "UPDATE external_logs SET notes = ?1 WHERE id = ?2",
        rusqlite::params![serde_json::to_string(&rec.notes).unwrap_or_else(|_| "[]".to_string()), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn external_service_status() -> Value {
    json!({
        "dpsReport": service_state(Service::DpsReport),
        "wingman": service_state(Service::Wingman),
    })
}

/// Lightweight probe used by the External tab's status banner. Wingman is
/// probed here. dps.report is fetched through the WebView, so its status is
/// learned from real link fetches instead of a native-client probe that some
/// connections get 403'd on.
#[command]
pub async fn check_external_services() -> Result<Value, String> {
    let wing = client()
        .get(format!("{WINGMAN_BASE}/api/patches"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    if wing {
        mark_ok(Service::Wingman);
    } else {
        mark_fail(Service::Wingman);
    }
    Ok(external_service_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_dps_report_links() {
        let (s, id, url) = normalize_link("https://dps.report/PshH-20261125-231515_adina").unwrap();
        assert_eq!(s, Service::DpsReport);
        assert_eq!(id, "PshH-20261125-231515");
        assert_eq!(url, "https://dps.report/PshH-20261125-231515");
        let (_, id, _) = normalize_link("https://b.dps.report/getJson?permalink=abc123").unwrap();
        assert_eq!(id, "abc123");
    }

    #[test]
    fn normalizes_wingman_links() {
        let (s, id, url) = normalize_link("https://gw2wingman.nevermindcreations.de/log/20230102-202238_dhuum_kill").unwrap();
        assert_eq!(s, Service::Wingman);
        assert_eq!(id, "20230102-202238_dhuum_kill");
        assert_eq!(url, "https://gw2wingman.nevermindcreations.de/log/20230102-202238_dhuum_kill");
    }

    #[test]
    fn rejects_other_hosts_and_bad_ids() {
        assert!(normalize_link("https://example.com/log/abc").is_err());
        assert!(normalize_link("https://dps.report/").is_err());
        assert!(normalize_link("not a link").is_err());
    }

    #[test]
    fn builds_card_from_wingman_metadata() {
        let meta = json!({
            "triggerID": 19450,
            "success": true,
            "isCM": true,
            "durationMS": 310503.0,
            "hpLeft": 0.0,
            "squadDmg": 31865680.0,
            "players": [{"name": "Tester", "account": "Tester.1234", "profession": "Mechanist"}]
        });
        let rec = build_record(Service::Wingman, "log-id", "https://gw2wingman.nevermindcreations.de/log/log-id", &meta).unwrap();
        assert_eq!(rec.boss_name, "Dhuum");
        assert_eq!(rec.success, Some(true));
        assert!(rec.is_cm);
        assert_eq!(rec.duration_sec, 310.503);
        assert_eq!(rec.num_players, 1);
        assert_eq!(rec.players[0].profession, "Mechanist");
    }

    #[test]
    fn computes_external_target_rows() {
        let raw = json!({
            "targets": [
                { "name": "Nikare", "healthPercentBurned": 80.0 },
                { "name": "Kenut", "healthPercentBurned": 100.0 }
            ]
        });
        let targets = compute_targets(&raw).unwrap();
        assert_eq!(targets.rows.len(), 2);
        assert_eq!(targets.rows[0].label, "Nikare");
        assert_eq!(targets.rows[0].hp, Some(20.0));
        assert_eq!(targets.rows[1].label, "Kenut");
        assert_eq!(targets.rows[1].hp, Some(0.0));
    }

    #[test]
    fn wingman_boss_ids_use_wingman_namespace() {
        assert_eq!(wingman_boss_name(21105), Some("Twin Largos"));
        assert_eq!(wingman_boss_name(22343), Some("Voice and Claw of the Fallen"));
        assert_eq!(wingman_boss_name(22521), Some("Boneskinner"));
        assert_eq!(wingman_boss_name(232542), Some("Dark Ai, Keeper of the Peak"));
        assert_eq!(wingman_boss_name(28106), Some("Vloxx"));
    }

    #[test]
    fn maps_wingman_twin_largos_name() {
        let raw = json!({
            "triggerID": 21105,
            "fightName": "Twin Largos CM",
            "success": false,
            "players": []
        });
        let rec = build_record(
            Service::Wingman,
            "yqfD-20261125-224048_twins",
            "https://gw2wingman.nevermindcreations.de/log/yqfD-20261125-224048_twins",
            &raw,
        )
        .unwrap();
        assert_eq!(rec.boss_name, "Twin Largos");
        assert!(rec.multi_boss);
    }

    #[test]
    fn maps_wingman_harvest_temple_name() {
        let raw = json!({
            "triggerID": 24375,
            "fightName": "Harvest Temple CM",
            "success": false,
            "players": []
        });
        let rec = build_record(
            Service::Wingman,
            "SwWf-20261126-000925_void",
            "https://gw2wingman.nevermindcreations.de/log/SwWf-20261126-000925_void",
            &raw,
        )
        .unwrap();
        assert_eq!(rec.boss_name, "The Dragonvoid");
        assert!(rec.multi_boss);
    }

    #[test]
    #[ignore]
    fn probe_council_from_ei_json_file() {
        let Ok(path) = std::env::var("PROBE_EI_JSON") else { return; };
        let text = std::fs::read_to_string(path).unwrap();
        let raw: Value = serde_json::from_str(&text).unwrap();
        let success = raw.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        let council = compute_council(&raw, success).unwrap();
        for phase in &council.phases {
            println!("PROBE {}: cleared={}", phase.key, phase.cleared);
        }
        for hp in &council.hp {
            println!("PROBE hp {}: {} died={}", hp.key, hp.hp_left, hp.died);
        }
    }

    #[test]
    fn parses_wingman_lookup_response() {
        assert_eq!(
            full_dps_report_link("https://b.dps.report/getJson?permalink=abc_def").unwrap(),
            "https://dps.report/abc_def"
        );
        let found: Value = serde_json::from_str(
            r#"{"link":"https://dps.report/abc","inDB":true,"inQueue":false,"targetURL":"https://gw2wingman.nevermindcreations.de/log/abc"}"#,
        )
        .unwrap();
        let out = parse_wingman_lookup(&found).unwrap();
        assert_eq!(out["found"], true);
        assert_eq!(out["linkId"], "abc");
        assert_eq!(out["targetURL"], "https://gw2wingman.nevermindcreations.de/log/abc");

        let missing: Value = serde_json::from_str(
            r#"{"link":"https://dps.report/abc","inDB":false,"inQueue":true}"#,
        )
        .unwrap();
        let out = parse_wingman_lookup(&missing).unwrap();
        assert_eq!(out["found"], false);
        assert_eq!(out["inQueue"], true);
    }

    #[test]
    #[ignore]
    fn probe_wingman_lookup_for_dps_link() {
        let Ok(id) = std::env::var("PROBE_DPS_LINK") else { return; };
        let link = format!("https://dps.report/{id}");
        match tokio::runtime::Runtime::new().unwrap().block_on(find_wingman_log_for_dps(link)) {
            Ok(v) => println!("PROBE lookup: {v}"),
            Err(e) => panic!("PROBE failed: {e}"),
        }
    }

    #[test]
    #[ignore]
    fn probe_dps_curl_fetch() {
        let Ok(id) = std::env::var("PROBE_DPS_LINK") else { return; };
        match tokio::runtime::Runtime::new().unwrap().block_on(fetch_dps_json_via_curl(&id)) {
            Ok(v) => println!("PROBE ok: {} chars via curl", v.to_string().len()),
            Err(e) => panic!("PROBE failed: {e}"),
        }
    }

    #[test]
    #[ignore]
    fn probe_dps_http_domain_fetch() {
        let Ok(id) = std::env::var("PROBE_DPS_LINK") else { return; };
        let url = format!("http://a.dps.report/getJson?permalink={id}");
        match tokio::runtime::Runtime::new().unwrap().block_on(fetch_json(&url, Service::DpsReport)) {
            Ok(v) => println!("PROBE ok: {} chars from a.dps.report", v.to_string().len()),
            Err(e) => panic!("PROBE failed: {e}"),
        }
    }

    #[test]
    #[ignore]
    fn probe_dps_backup_fetch() {
        let Ok(id) = std::env::var("PROBE_DPS_LINK") else { return; };
        let url = format!("https://b.dps.report/getJson?permalink={id}");
        match tokio::runtime::Runtime::new().unwrap().block_on(fetch_json(&url, Service::DpsReport)) {
            Ok(v) => println!("PROBE ok: {} chars from b.dps.report", v.to_string().len()),
            Err(e) => panic!("PROBE failed: {e}"),
        }
    }

    #[test]
    #[ignore]
    fn probe_dps_report_fetch() {
        let Ok(id) = std::env::var("PROBE_DPS_LINK") else { return; };
        let url = format!("{DPS_BASE}/getJson?permalink={id}");
        match tokio::runtime::Runtime::new().unwrap().block_on(fetch_json(&url, Service::DpsReport)) {
            Ok(v) => println!("PROBE ok: {} chars of JSON", v.to_string().len()),
            Err(e) => panic!("PROBE failed: {e}"),
        }
    }

    #[test]
    #[ignore]
    fn probe_wingman_full_json_download() {
        let Ok(id) = std::env::var("PROBE_WINGMAN_LOG") else { return; };
        let url = format!("{WINGMAN_BASE}/api/getFullJson/{id}");
        match tokio::runtime::Runtime::new().unwrap().block_on(fetch_json(&url, Service::Wingman)) {
            Ok(v) => println!("PROBE ok: {} bytes of JSON", v.to_string().len()),
            Err(e) => panic!("PROBE failed: {e}"),
        }
    }
}
