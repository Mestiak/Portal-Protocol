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
    pub num_players: usize,
    pub players: Vec<ExternalPlayer>,
    pub notes: Vec<ExternalNote>,
    pub created_at: String,
    pub last_checked: String,
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
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
            "{} returned HTTP {status}. The service may be down or rate-limiting requests.",
            service.label()
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
    Ok(ExternalLogRecord {
        id: row.get("id")?,
        source: row.get("source")?,
        link_id: row.get("link_id")?,
        url: row.get("url")?,
        boss_name: row.get::<_, Option<String>>("boss_name")?.unwrap_or_default(),
        success: row.get::<_, Option<i64>>("success")?.map(|v| v != 0),
        is_cm: row.get::<_, Option<i64>>("is_cm")?.unwrap_or(0) != 0,
        is_lcm: row.get::<_, Option<i64>>("is_lcm")?.unwrap_or(0) != 0,
        duration_sec: row.get::<_, Option<f64>>("duration_sec")?.unwrap_or(0.0),
        group_dps: row.get::<_, Option<f64>>("group_dps")?.unwrap_or(0.0),
        hp_left: row.get("hp_left")?,
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

fn build_record(service: Service, link_id: &str, url: &str, raw: &Value) -> Result<ExternalLogRecord, String> {
    let players = players_from(raw);
    let (boss_name, success, is_cm, is_lcm, duration_sec, group_dps, hp_left) = match service {
        Service::Wingman => {
            let trigger = raw.get("triggerID").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            let name = crate::evtc_parser::get_boss_name_from_id(trigger);
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
            (
                stats.boss_name,
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
            let raw = fetch_json(&format!("{DPS_BASE}/getJson?permalink={link_id}"), service).await?;
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
    let (service, link_id, canonical) = normalize_link(&url)?;
    let id = format!("{}:{}", service.key(), link_id);
    if let Some(existing) = get_record(&app, &id)? {
        return Ok(existing);
    }
    let rec = fetch_record(&app, service, &link_id, &canonical).await?;
    save_record(&app, &rec)?;
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
                let v = fetch_json(&format!("{DPS_BASE}/getJson?permalink={link_id}"), service).await?;
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

/// Lightweight probe used by the External tab's status banner. Each endpoint is
/// tiny: Wingman's patch table, dps.report's front page.
#[command]
pub async fn check_external_services() -> Result<Value, String> {
    let dps = client()
        .get(DPS_BASE)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    if dps {
        mark_ok(Service::DpsReport);
    } else {
        mark_fail(Service::DpsReport);
    }
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
